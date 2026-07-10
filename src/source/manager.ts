import type { SourceMeta } from '../types';
import type { RuntimeManager } from '../engine/manager';
import { makeSourceMeta, parseSourceHeader, slugifySourceName } from './parser';
import { deleteSourceScript, loadSourceIndex, loadSourceRuntimeRevision, loadSourceScript, saveSourceIndex, saveSourceRuntimeRevision, saveSourceScript } from './storage';
import { parseZipScripts } from './zip';

export interface ImportScriptInput { filename: string; script: string }
export interface SourceListState {
  sources: SourceMeta[];
  loading: boolean;
  batch_current_id: string | null;
  batch_pending_ids: string[];
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

// 兼容层有实质变化时递增。失败过的音源会在升级后自动重试一次，
// 用户主动关闭且没有错误的音源不会被擅自启用。
const RUNTIME_COMPAT_REVISION = 2;

export class SourceManager {
  private items: SourceMeta[] = [];
  private runtimeManager: RuntimeManager;
  private queue: string[] = [];
  private draining = false;
  private currentId: string | null = null;

  constructor(runtimeManager: RuntimeManager) { this.runtimeManager = runtimeManager; }

  async init(): Promise<void> {
    this.items = await loadSourceIndex();
    const previousRevision = await loadSourceRuntimeRevision();
    const retryFailedAfterUpgrade = previousRevision < RUNTIME_COMPAT_REVISION;

    // 插件启动阶段只恢复索引，不在 onInit 内同步执行第三方脚本。
    // 社区音源初始化可能接近 30 秒；同步等待会让宿主把整个插件判定为
    // “plugin call failed / plugin unavailable”。改为后台队列后，插件页面和 API
    // 可以立即响应，初始化结果随后通过 /api/sources 轮询展示。
    for (const item of this.items) {
      item.loading = false;
      const shouldLoad = item.enabled || (retryFailedAfterUpgrade && Boolean(item.error));
      if (!shouldLoad) continue;
      item.enabled = false;
      item.loading = true;
      item.error = undefined;
      this.enqueue(item.id);
    }
    await saveSourceRuntimeRevision(RUNTIME_COMPAT_REVISION);
    await this.persist();
    this.startDrain();
  }

  list(): SourceListState {
    return {
      sources: this.items.map(item => ({ ...item })),
      loading: this.draining,
      batch_current_id: this.currentId,
      batch_pending_ids: [...this.queue],
    };
  }

  private async persist(): Promise<void> { await saveSourceIndex(this.items); }

  private allocateId(name: string, ignoreId?: string): string {
    const base = slugifySourceName(name);
    let id = base; let suffix = 2;
    while (this.items.some(item => item.id === id && item.id !== ignoreId)) { id = `${base}_${suffix}`; suffix += 1; }
    return id;
  }

  private async removeSameName(name: string): Promise<void> {
    const matches = this.items.filter(item => item.name === name);
    for (const item of matches) await this.remove(item.id);
  }

  async importScript(input: ImportScriptInput, enabled = true): Promise<SourceMeta> {
    const header = parseSourceHeader(input.script, input.filename);
    await this.removeSameName(header.name);
    const id = this.allocateId(header.name);

    // 单文件导入也必须走后台初始化。以前这里直接 await loadSource，第三方脚本
    // 若初始化慢或未及时发送 inited，会超过 Songloft 外层 HTTP 调用时限，前端只能
    // 看到笼统的 “plugin call failed”。现在先可靠保存，再异步执行。
    const meta = makeSourceMeta(id, input.filename, input.script, false);
    meta.loading = enabled;
    this.items.push(meta);
    await saveSourceScript(id, input.script);
    if (enabled) this.enqueue(id);
    await this.persist();
    this.startDrain();
    return { ...meta };
  }

  async importBatch(inputs: ImportScriptInput[]): Promise<SourceMeta[]> {
    const imported: SourceMeta[] = [];
    for (const input of inputs) {
      const header = parseSourceHeader(input.script, input.filename);
      await this.removeSameName(header.name);
      const id = this.allocateId(header.name);
      const meta = makeSourceMeta(id, input.filename, input.script, false);
      meta.loading = true;
      this.items.push(meta);
      await saveSourceScript(id, input.script);
      this.enqueue(id);
      imported.push({ ...meta });
    }
    await this.persist();
    this.startDrain();
    return imported;
  }

  async importZip(bytes: Uint8Array): Promise<SourceMeta[]> {
    const entries = parseZipScripts(bytes);
    return await this.importBatch(entries);
  }

  private enqueue(id: string): void {
    if (this.currentId === id || this.queue.includes(id)) return;
    this.queue.push(id);
  }

  private startDrain(): void {
    if (this.draining) return;
    this.draining = true;
    setTimeout(() => { void this.drainQueue(); }, 0);
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift() as string;
      this.currentId = id;
      const item = this.items.find(source => source.id === id);
      if (!item) continue;
      item.loading = true;
      item.error = undefined;
      await this.persist();
      const script = await loadSourceScript(id);
      if (!script) {
        item.loading = false;
        item.error = '持久化脚本丢失';
        await this.persist();
        continue;
      }
      try {
        await this.runtimeManager.loadSource(item, script);
        item.enabled = true;
        item.error = undefined;
      } catch (error) {
        item.enabled = false;
        item.error = String((error as Error)?.message || error);
        songloft.log.error(`初始化音源 ${item.name} 失败: ${item.error}`);
      } finally {
        item.loading = false;
        item.updatedAt = Date.now();
        await this.persist();
      }
      await sleep(1000);
    }
    this.currentId = null;
    this.draining = false;
    await this.persist();
  }

  async toggle(id: string, enabled: boolean): Promise<SourceMeta> {
    const item = this.items.find(source => source.id === id);
    if (!item) throw new Error('音源不存在');

    if (enabled) {
      // 启用也采用后台队列，避免慢音源拖垮 PUT 请求。
      item.enabled = false;
      item.loading = true;
      item.error = undefined;
      item.updatedAt = Date.now();
      this.enqueue(id);
      await this.persist();
      this.startDrain();
      return { ...item };
    }

    this.queue = this.queue.filter(itemId => itemId !== id);
    await this.runtimeManager.unloadSource(id);
    item.enabled = false;
    item.loading = false;
    item.updatedAt = Date.now();
    await this.persist();
    return { ...item };
  }

  async remove(id: string): Promise<void> {
    await this.runtimeManager.unloadSource(id);
    this.items = this.items.filter(item => item.id !== id);
    this.queue = this.queue.filter(item => item !== id);
    if (this.currentId === id) this.currentId = null;
    await deleteSourceScript(id);
    await this.persist();
  }

  async getScript(id: string): Promise<string | null> { return await loadSourceScript(id); }
}
