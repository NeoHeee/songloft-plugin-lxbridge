import type { MusicInfo, PlatformId, ResolvedUrl, SourceMeta, SourceRuntimeInfo } from '../types';
import { SourceRuntime } from './runtime';

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

  async getMusicUrl(platform: PlatformId, songInfo: MusicInfo, quality = '320k'): Promise<ResolvedUrl> {
    const candidates = [...(this.platformIndex.get(platform) || [])];
    if (!candidates.length) throw new Error(`没有已启用且支持 ${platform} 的洛雪音源`);
    candidates.sort((a, b) => {
      const ar = a.totalCalls ? a.successCalls / a.totalCalls : 1;
      const br = b.totalCalls ? b.successCalls / b.totalCalls : 1;
      return br - ar;
    });

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
}
