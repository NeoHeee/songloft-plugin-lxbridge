import type { MusicInfo, PlatformId, ResolvedUrl, SourceMeta, SourceRuntimeInfo } from '../types';
import { SourceRuntime } from './runtime';

const QUALITY_ORDER = ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'] as const;
const QUALITY_ALIASES: Record<string, string> = {
  '24bit': 'flac24bit',
  '24-bit': 'flac24bit',
  lossless: 'flac',
  high: '320k',
  standard: '128k',
};

function normalizeQuality(value: string): string {
  const quality = String(value || '320k').trim().toLowerCase();
  return QUALITY_ALIASES[quality] || quality;
}

function fallbackQualities(requested: string, allowDowngrade: boolean): string[] {
  const normalized = normalizeQuality(requested);
  if (!allowDowngrade) return [normalized];
  const index = QUALITY_ORDER.indexOf(normalized as typeof QUALITY_ORDER[number]);
  if (index >= 0) return [...QUALITY_ORDER.slice(index)];
  return [normalized, 'hires', 'flac24bit', 'flac', '320k', '128k'];
}

export class RuntimeManager {
  private runtimes = new Map<string, SourceRuntime>();
  private platformIndex = new Map<PlatformId, SourceRuntime[]>();

  private rebuildIndex(): void {
    this.platformIndex.clear();
    for (const platform of ['kw', 'kg', 'tx', 'wy', 'mg'] as PlatformId[]) this.platformIndex.set(platform, []);
    for (const runtime of this.runtimes.values()) {
      for (const platform of Object.keys(runtime.sources) as PlatformId[]) {
        const list = this.platformIndex.get(platform) || [];
        list.push(runtime);
        this.platformIndex.set(platform, list);
      }
    }
  }

  async loadSource(meta: SourceMeta, script: string): Promise<SourceRuntimeInfo> {
    await this.unloadSource(meta.id);
    const runtime = new SourceRuntime(meta, script);
    await runtime.init();
    this.runtimes.set(meta.id, runtime);
    this.rebuildIndex();
    return runtime.info();
  }

  async unloadSource(id: string): Promise<void> {
    const current = this.runtimes.get(id);
    if (current) await current.destroy();
    this.runtimes.delete(id);
    this.rebuildIndex();
  }

  async destroyAll(): Promise<void> {
    const all = Array.from(this.runtimes.values());
    this.runtimes.clear();
    this.rebuildIndex();
    for (const runtime of all) {
      try { await runtime.destroy(); } catch { /* best effort */ }
    }
  }

  hasPlatform(platform: PlatformId): boolean {
    return (this.platformIndex.get(platform) || []).length > 0;
  }

  getStatus(): SourceRuntimeInfo[] {
    return Array.from(this.runtimes.values()).map(runtime => runtime.info());
  }

  getSupportedQualities(platform?: PlatformId): string[] {
    const runtimes = platform
      ? this.platformIndex.get(platform) || []
      : Array.from(this.runtimes.values());
    const found = new Set<string>();
    for (const runtime of runtimes) {
      const platforms = platform ? [platform] : Object.keys(runtime.sources) as PlatformId[];
      for (const id of platforms) {
        for (const quality of runtime.supportedQualities(id)) found.add(normalizeQuality(quality));
      }
    }
    return Array.from(found).sort((a, b) => {
      const ai = QUALITY_ORDER.indexOf(a as typeof QUALITY_ORDER[number]);
      const bi = QUALITY_ORDER.indexOf(b as typeof QUALITY_ORDER[number]);
      if (ai < 0 && bi < 0) return a.localeCompare(b);
      if (ai < 0) return -1;
      if (bi < 0) return 1;
      return ai - bi;
    });
  }

  private candidatesForQuality(platform: PlatformId, quality: string): SourceRuntime[] {
    return [...(this.platformIndex.get(platform) || [])]
      .sort((a, b) => {
        const aq = a.supportedQualities(platform).map(normalizeQuality);
        const bq = b.supportedQualities(platform).map(normalizeQuality);
        const ad = !aq.length || aq.includes(quality) ? 1 : 0;
        const bd = !bq.length || bq.includes(quality) ? 1 : 0;
        if (ad !== bd) return bd - ad;
        const ar = a.totalCalls ? a.successCalls / a.totalCalls : 1;
        const br = b.totalCalls ? b.successCalls / b.totalCalls : 1;
        return br - ar;
      });
  }

  private async resolveAtQuality(platform: PlatformId, songInfo: MusicInfo, quality: string): Promise<ResolvedUrl> {
    const candidates = this.candidatesForQuality(platform, quality);
    if (!candidates.length) throw new Error(`没有已启用的 ${platform} 音源可尝试 ${quality} 音质`);

    if (candidates.length === 1) return await candidates[0].resolve(platform, songInfo, quality);

    const built = candidates.map(runtime => ({ runtime, built: runtime.buildDispatchCall(platform, songInfo, quality, false) }));
    for (const item of built) item.runtime.totalCalls += 1;
    const result = await songloft.jsenv.executeParallel(built.map(item => item.built.call), 3);
    if (result.successIndex >= 0 && result.result) {
      const winner = built[result.successIndex];
      try {
        const resolved = winner.runtime.extractResult(result.result, winner.built.requestId);
        winner.runtime.successCalls += 1;
        winner.runtime.lastError = '';
        return { ...resolved, runtimeId: winner.runtime.id };
      } catch (error) {
        winner.runtime.lastError = String((error as Error)?.message || error);
      }
    }
    const details = result.errors.filter(Boolean).join('; ');
    throw new Error(details ? `所有音源解析失败: ${details}` : '所有音源解析失败或超时');
  }

  async getMusicUrl(platform: PlatformId, songInfo: MusicInfo, quality = '320k', allowDowngrade = true): Promise<ResolvedUrl> {
    if (!this.hasPlatform(platform)) throw new Error(`没有已启用且支持 ${platform} 的洛雪音源`);
    const requestedQuality = normalizeQuality(quality);
    const attempts = fallbackQualities(requestedQuality, allowDowngrade);
    const errors: string[] = [];

    for (const actualQuality of attempts) {
      try {
        const resolved = await this.resolveAtQuality(platform, songInfo, actualQuality);
        const reportedQuality = normalizeQuality(resolved.actualQuality || actualQuality);
        return {
          ...resolved,
          requestedQuality,
          actualQuality: reportedQuality,
          downgraded: reportedQuality !== requestedQuality,
        };
      } catch (error) {
        errors.push(`${actualQuality}: ${String((error as Error)?.message || error)}`);
      }
    }

    const prefix = allowDowngrade ? '所有音质均解析失败' : `${requestedQuality} 解析失败，且已禁止自动降级`;
    throw new Error(`${prefix}（${errors.join('；')}）`);
  }
}
