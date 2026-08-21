import { downloadDirectoryError, getRequestProtectionSettings } from './settings';

export type DownloadJobStatus = 'pending' | 'resolving' | 'queued' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'interrupted';
export type DownloadFailureCategory = 'network_timeout' | 'rate_limited' | 'address_expired' | 'permission_denied' | 'directory_error' | 'source_error' | 'library_error' | 'interrupted' | 'unknown';

const DOWNLOAD_JOBS_KEY = 'neo-lxbridge:download_jobs:v1';
const ACTIVE_STATUSES: DownloadJobStatus[] = ['pending', 'resolving', 'queued', 'downloading', 'verifying'];
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_JOBS = 200;

type DownloadJobStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export interface DownloadJob {
  id: string;
  song_id: number;
  title: string;
  artist?: string;
  status: DownloadJobStatus;
  progress: number;
  status_detail?: string;
  client_key?: string;
  source_id?: string;
  path?: string;
  error?: string;
  error_category?: DownloadFailureCategory;
  error_suggestion?: string;
  already_downloaded?: boolean;
  total_bytes?: number | null;
  actual_quality?: string;
  content_type?: string;
  target_dir?: string;
  path_template?: string;
  upgrade_source_song_id?: number;
  upgrade_source_bitrate?: number;
  upgrade_target_quality?: string;
  verification_status?: 'passed' | 'warning';
  verification_message?: string;
  wait_until?: number;
  pause_reason?: 'safety_interval' | 'source_circuit';
  created_at: number;
  updated_at: number;
}

function errorMessage(error: unknown): string {
  return String((error as Error)?.message || error || '下载失败');
}

export function classifyDownloadFailure(error: unknown, targetDir = ''): { category: DownloadFailureCategory; message: string; suggestion: string } {
  const raw = errorMessage(error);
  const message = targetDir ? downloadDirectoryError(raw, targetDir) : raw;
  const lower = `${raw} ${message}`.toLowerCase();
  if (/permission denied|access is denied|read-only|eacces|eperm/.test(lower)) {
    return { category: 'permission_denied', message, suggestion: '请检查音乐目录的容器卷映射和读写权限。' };
  }
  if (/target_dir|music_path|invalid target dir|mkdir|目录|path template/.test(lower)) {
    return { category: 'directory_error', message, suggestion: '请在下载设置中重新选择 Songloft music_path 下的有效目录。' };
  }
  if (/429|too many requests|rate.?limit|请求过于频繁|封禁|频率限制/.test(lower)) {
    return { category: 'rate_limited', message, suggestion: '请暂停下载并稍后重试，同时增大批量下载保护间隔。' };
  }
  if (/401|403|signature|token.*expired|url.*expired|链接.*失效|地址.*失效/.test(lower)) {
    return { category: 'address_expired', message, suggestion: '播放地址可能已过期，请点击重试以重新解析地址。' };
  }
  if (/timeout|timed out|etimedout|econnreset|enotfound|network|fetch failed|网络/.test(lower)) {
    return { category: 'network_timeout', message, suggestion: '请检查网络连接，稍后重试；连续失败时建议暂停队列。' };
  }
  if (/source_data|没有已启用|音源|解析播放地址|music url/.test(lower)) {
    return { category: 'source_error', message, suggestion: '请检查音源运行状态，或更换音源后重新下载。' };
  }
  if (/歌曲记录|曲库|写入 songloft|song.*record/.test(lower)) {
    return { category: 'library_error', message, suggestion: '请运行诊断中心的音乐库检查，并确认 Songloft 曲库可读写。' };
  }
  return { category: 'unknown', message, suggestion: '请复制诊断报告并结合 Songloft 日志进一步排查。' };
}

export class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private activeBySong = new Map<number, string>();
  private queue: string[] = [];
  private draining = false;
  private counter = 0;
  private lastAttemptFinishedAt = 0;
  private paused = false;
  private currentJobId = '';
  private resumeWaiters: Array<() => void> = [];
  private sourceFailures = new Map<string, { count: number; paused_until: number; last_error: string }>();
  private persistenceReady = false;
  private persistenceError = '';
  private recoveredJobs = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly storageAdapter?: DownloadJobStorage) {}

  async init(): Promise<void> {
    try {
      const raw = await this.storage().get(DOWNLOAD_JOBS_KEY);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      this.paused = Boolean((parsed as { paused?: unknown } | null)?.paused);
      const sourceFailures = (parsed as { source_failures?: Record<string, { count?: number; paused_until?: number; last_error?: string }> } | null)?.source_failures || {};
      for (const [source, failure] of Object.entries(sourceFailures)) {
        if (Number(failure.paused_until || 0) > Date.now()) this.sourceFailures.set(source, { count: Number(failure.count || 0), paused_until: Number(failure.paused_until), last_error: String(failure.last_error || '') });
      }
      const rows = Array.isArray((parsed as { jobs?: unknown[] } | null)?.jobs) ? (parsed as { jobs: unknown[] }).jobs : [];
      const now = Date.now();
      for (const value of rows.slice(0, MAX_PERSISTED_JOBS)) {
        if (!value || typeof value !== 'object') continue;
        const row = value as Partial<DownloadJob>;
        if (!row.id || !row.title || !row.status || !row.created_at || !row.updated_at) continue;
        if (now - Number(row.updated_at) > RETENTION_MS) continue;
        const job = { ...row } as DownloadJob;
        if (ACTIVE_STATUSES.includes(job.status)) {
          job.status = 'interrupted';
          job.status_detail = '插件重启时任务尚未完成';
          job.error = '任务因插件重启而中断，未自动恢复以避免重复下载。';
          job.error_category = 'interrupted';
          job.error_suggestion = job.song_id ? '请确认文件尚未下载，然后点击“重新下载”。' : '该任务尚未完成歌曲入库，请从原歌曲或歌单重新发起下载。';
          job.wait_until = undefined;
          job.updated_at = now;
          this.recoveredJobs += 1;
        }
        this.jobs.set(job.id, job);
      }
      this.cleanup();
      this.persistenceReady = true;
      await this.flushPersistence();
    } catch (error) {
      this.persistenceError = errorMessage(error);
      this.persistenceReady = true;
      songloft.log.error(`[neo-lxbridge] 恢复下载任务失败: ${this.persistenceError}`);
    }
  }

  async flush(): Promise<void> {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    await this.flushPersistence();
    await this.persistChain;
  }

  getPersistenceStatus(): { ready: boolean; jobs: number; recovered_jobs: number; error: string } {
    return { ready: this.persistenceReady, jobs: this.jobs.size, recovered_jobs: this.recoveredJobs, error: this.persistenceError };
  }

  getQueueState(): { paused: boolean; current_job_id: string; queued_ids: string[]; source_circuits: Array<{ source_id: string; failure_count: number; paused_until: number; last_error: string }> } {
    this.clearExpiredCircuits();
    return {
      paused: this.paused,
      current_job_id: this.currentJobId,
      queued_ids: [...this.queue],
      source_circuits: Array.from(this.sourceFailures.entries())
        .filter(([, value]) => value.paused_until > Date.now())
        .map(([source_id, value]) => ({ source_id, failure_count: value.count, paused_until: value.paused_until, last_error: value.last_error })),
    };
  }

  pause(): ReturnType<DownloadManager['getQueueState']> {
    this.paused = true;
    for (const id of this.queue) {
      const job = this.jobs.get(id);
      if (job?.status === 'queued') job.status_detail = '队列已暂停，当前下载完成后不再启动新任务';
    }
    this.schedulePersist();
    return this.getQueueState();
  }

  resume(): ReturnType<DownloadManager['getQueueState']> {
    this.paused = false;
    for (const id of this.queue) {
      const job = this.jobs.get(id);
      if (job?.status === 'queued' && !job.wait_until) job.status_detail = '等待下载';
    }
    const waiters = this.resumeWaiters.splice(0);
    waiters.forEach(resolve => resolve());
    this.startDrain();
    this.schedulePersist();
    return this.getQueueState();
  }

  move(id: string, direction: 'up' | 'down'): ReturnType<DownloadManager['getQueueState']> {
    const index = this.queue.indexOf(id);
    if (index < 0) throw new Error('只有等待下载的任务可以调整顺序');
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= this.queue.length) return this.getQueueState();
    [this.queue[index], this.queue[target]] = [this.queue[target], this.queue[index]];
    this.schedulePersist();
    return this.getQueueState();
  }

  cancelMany(ids: string[]): number {
    let removed = 0;
    for (const id of Array.from(new Set(ids))) if (this.remove(id)) removed += 1;
    return removed;
  }

  reserve(song: { title?: string; artist?: string }, metadata: Partial<Pick<DownloadJob, 'target_dir' | 'path_template' | 'client_key' | 'source_id'>> = {}): DownloadJob {
    const now = Date.now();
    const job: DownloadJob = {
      id: this.createId(0), song_id: 0, title: song.title || '未知歌曲', artist: song.artist || '',
      status: 'pending', progress: 0, status_detail: '等待解析', ...metadata, created_at: now, updated_at: now,
    };
    this.jobs.set(job.id, job);
    this.cleanup();
    this.schedulePersist();
    return { ...job };
  }

  setStage(id: string, status: 'resolving' | 'verifying', progress: number, detail?: string): DownloadJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('下载任务不存在或已过期');
    job.status = status; job.progress = Math.max(0, Math.min(100, progress));
    job.status_detail = detail; job.updated_at = Date.now();
    this.schedulePersist();
    return { ...job };
  }

  activate(id: string, song: { id: number; title?: string; artist?: string; type?: string; file_path?: string }, metadata: Partial<Pick<DownloadJob, 'total_bytes' | 'actual_quality' | 'content_type'>> = {}): DownloadJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('下载任务不存在或已过期');
    if (!song.id) throw new Error('歌曲 ID 无效');
    job.song_id = song.id; job.title = song.title || job.title; job.artist = song.artist || job.artist;
    Object.assign(job, metadata); job.updated_at = Date.now();
    if (song.type === 'local') {
      job.status = 'completed'; job.progress = 100; job.status_detail = '文件已存在';
      job.path = song.file_path || ''; job.already_downloaded = true;
      this.schedulePersist();
      return { ...job };
    }
    job.status = 'queued'; job.progress = 35; job.status_detail = '等待下载';
    this.activeBySong.set(song.id, job.id); this.queue.push(job.id); this.startDrain();
    this.schedulePersist();
    return { ...job };
  }

  fail(id: string, error: unknown): DownloadJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('下载任务不存在或已过期');
    const failure = classifyDownloadFailure(error, job.target_dir);
    job.status = 'failed'; job.status_detail = '处理失败'; job.error = failure.message;
    job.error_category = failure.category; job.error_suggestion = failure.suggestion; job.updated_at = Date.now();
    this.schedulePersist();
    return { ...job };
  }

  enqueue(song: { id: number; title?: string; artist?: string; type?: string; file_path?: string }, metadata: Partial<Pick<DownloadJob, 'total_bytes' | 'actual_quality' | 'content_type' | 'target_dir' | 'path_template' | 'source_id' | 'upgrade_source_song_id' | 'upgrade_source_bitrate' | 'upgrade_target_quality'>> = {}): DownloadJob {
    if (!song.id) throw new Error('歌曲 ID 无效');

    if (song.type === 'local') {
      const completed: DownloadJob = {
        id: this.createId(song.id),
        song_id: song.id,
        title: song.title || '未知歌曲',
        artist: song.artist || '',
        status: 'completed',
        progress: 100,
        ...metadata,
        path: song.file_path || '',
        already_downloaded: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      this.jobs.set(completed.id, completed);
      this.cleanup();
      this.schedulePersist();
      return { ...completed };
    }

    const existingId = this.activeBySong.get(song.id);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && ['pending','resolving','queued','downloading','verifying'].includes(existing.status)) return { ...existing };
    }

    const job: DownloadJob = {
      id: this.createId(song.id),
      song_id: song.id,
      title: song.title || '未知歌曲',
      artist: song.artist || '',
      status: 'queued',
      progress: 35,
      ...metadata,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.activeBySong.set(song.id, job.id);
    this.queue.push(job.id);
    this.startDrain();
    this.cleanup();
    this.schedulePersist();
    return { ...job };
  }

  get(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  list(): DownloadJob[] {
    this.cleanup();
    return Array.from(this.jobs.values())
      .sort((a, b) => b.created_at - a.created_at)
      .map(job => ({ ...job }));
  }

  retry(id: string): DownloadJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('下载任务不存在或已过期');
    if (ACTIVE_STATUSES.includes(job.status)) return { ...job };
    if (!['failed', 'interrupted'].includes(job.status)) throw new Error('只有失败或已中断的任务可以重新下载');
    if (!job.song_id) throw new Error('解析失败的任务请重新发起下载');
    job.status = 'queued';
    job.progress = 35;
    job.status_detail = '等待下载';
    job.error = undefined;
    job.error_category = undefined;
    job.error_suggestion = undefined;
    job.path = undefined;
    job.already_downloaded = false;
    job.updated_at = Date.now();
    this.activeBySong.set(job.song_id, job.id);
    this.queue.push(job.id);
    this.startDrain();
    this.schedulePersist();
    return { ...job };
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || id === this.currentJobId || ['downloading','verifying'].includes(job.status)) return false;
    if (['pending','resolving','queued'].includes(job.status)) {
      this.queue = this.queue.filter(queuedId => queuedId !== id);
      if (job.song_id && this.activeBySong.get(job.song_id) === id) this.activeBySong.delete(job.song_id);
    }
    const removed = this.jobs.delete(id);
    if (removed) this.schedulePersist();
    return removed;
  }

  clearFinished(): number {
    let count = 0;
    for (const job of Array.from(this.jobs.values())) {
      if (!ACTIVE_STATUSES.includes(job.status) && this.jobs.delete(job.id)) count += 1;
    }
    if (count) this.schedulePersist();
    return count;
  }

  private createId(songId: number): string {
    this.counter += 1;
    return `dl_${Date.now().toString(36)}_${songId}_${this.counter.toString(36)}`;
  }

  private startDrain(): void {
    if (this.draining) return;
    this.draining = true;
    setTimeout(() => { void this.drain(); }, 0);
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      await this.waitWhilePaused();
      const runnable = this.findRunnableQueueIndex();
      if (runnable.index < 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(100, runnable.waitMs))));
        continue;
      }
      const id = this.queue.splice(runnable.index, 1)[0] as string;
      const job = this.jobs.get(id);
      if (!job) continue;
      this.currentJobId = id;

      const protection = await getRequestProtectionSettings();
      const waitMs = protection.enabled && this.lastAttemptFinishedAt
        ? Math.max(0, this.lastAttemptFinishedAt + protection.download_interval_ms - Date.now())
        : 0;
      if (waitMs > 0) {
        job.wait_until = Date.now() + waitMs;
        job.pause_reason = 'safety_interval';
        job.updated_at = Date.now();
        this.schedulePersist();
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      job.wait_until = undefined;
      job.pause_reason = undefined;
      await this.waitWhilePaused();

      job.status = 'downloading';
      job.progress = 50;
      job.status_detail = 'Songloft 正在下载文件';
      job.updated_at = Date.now();
      this.schedulePersist();
      try {
        const current = await songloft.songs.getById(job.song_id);
        if (!current) throw new Error('歌曲记录不存在');

        if (current.type === 'local') {
          job.status = 'completed';
          job.progress = 100;
          job.status_detail = '文件已存在';
          job.path = current.file_path || '';
          job.already_downloaded = true;
        } else {
          const result = await songloft.songs.download(job.song_id, {
            embed_metadata: true,
            ...(job.target_dir ? {
              target_dir: job.target_dir,
              path_template: job.path_template || '{title}-{artist}',
            } : {}),
          });
          if (result.error) throw new Error(result.error);
          job.status = 'verifying';
          job.progress = 90;
          job.status_detail = '正在校验下载结果';
          job.path = result.path || '';
          job.already_downloaded = false;
          if (job.upgrade_source_song_id) {
            try {
              const downloaded = await songloft.songs.getById(job.song_id);
              const rawBitrate = Number(downloaded?.bit_rate || 0);
              const actualBitrate = rawBitrate > 10000 ? Math.round(rawBitrate / 1000) : Math.round(rawBitrate);
              const oldBitrate = Number(job.upgrade_source_bitrate || 0);
              const format = String(downloaded?.format || '').toLowerCase();
              const target = String(job.upgrade_target_quality || '');
              const expectsFlac = ['flac', 'flac24bit', 'hires'].includes(target);
              const bitrateImproved = actualBitrate > 0 && (!oldBitrate || actualBitrate > oldBitrate);
              const formatMatches = !expectsFlac || format.includes('flac');
              job.verification_status = bitrateImproved && formatMatches ? 'passed' : 'warning';
              job.verification_message = job.verification_status === 'passed'
                ? `洗版验证通过：${format.toUpperCase() || '未知格式'}${actualBitrate ? ` · ${actualBitrate} kbps` : ''}，旧版已保留`
                : `洗版验证警告：实际 ${format.toUpperCase() || '未知格式'}${actualBitrate ? ` · ${actualBitrate} kbps` : ''}，未确认高于旧版 ${oldBitrate || '未知'} kbps；请试听检查，旧版已保留`;
            } catch (verificationError) {
              job.verification_status = 'warning';
              job.verification_message = `新版已下载，但无法读取实际音质进行验证：${errorMessage(verificationError)}；请试听检查，旧版已保留`;
            }
          }
          job.status = 'completed';
          job.progress = 100;
          job.status_detail = '下载完成';
        }
        job.error = undefined;
        job.error_category = undefined;
        job.error_suggestion = undefined;
        this.registerSourceSuccess(job.source_id);
      } catch (error) {
        job.status = 'failed';
        job.status_detail = '下载失败';
        const failure = classifyDownloadFailure(error, job.target_dir);
        job.error = failure.message;
        job.error_category = failure.category;
        job.error_suggestion = failure.suggestion;
        this.registerSourceFailure(job.source_id, failure.category, failure.message);
        songloft.log.error(`[neo-lxbridge] 下载歌曲失败 (${job.title}): ${job.error}`);
      } finally {
        job.updated_at = Date.now();
        this.lastAttemptFinishedAt = job.updated_at;
        this.activeBySong.delete(job.song_id);
        this.currentJobId = '';
        this.schedulePersist();
      }
    }
    this.currentJobId = '';
    this.draining = false;
  }

  private cleanup(): void {
    const now = Date.now();
    const expired = Array.from(this.jobs.values())
      .filter(job => !ACTIVE_STATUSES.includes(job.status) && now - job.updated_at > RETENTION_MS)
      .map(job => job.id);
    for (const id of expired) this.jobs.delete(id);

    if (this.jobs.size <= MAX_PERSISTED_JOBS) return;
    const removable = Array.from(this.jobs.values())
      .filter(job => !ACTIVE_STATUSES.includes(job.status))
      .sort((a, b) => a.updated_at - b.updated_at);
    while (this.jobs.size > MAX_PERSISTED_JOBS && removable.length) {
      this.jobs.delete((removable.shift() as DownloadJob).id);
    }
  }

  private storage(): DownloadJobStorage {
    return this.storageAdapter || songloft.persistentStorage;
  }

  private schedulePersist(): void {
    if (!this.persistenceReady || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersistence();
    }, 40);
  }

  private async flushPersistence(): Promise<void> {
    if (!this.persistenceReady) return;
    const snapshot = JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      paused: this.paused,
      source_failures: Object.fromEntries(this.sourceFailures.entries()),
      jobs: this.list().slice(0, MAX_PERSISTED_JOBS),
    });
    this.persistChain = this.persistChain.then(async () => {
      try {
        await this.storage().set(DOWNLOAD_JOBS_KEY, snapshot);
        this.persistenceError = '';
      } catch (error) {
        this.persistenceError = errorMessage(error);
        songloft.log.error(`[neo-lxbridge] 保存下载任务失败: ${this.persistenceError}`);
      }
    });
    await this.persistChain;
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused) await new Promise<void>(resolve => this.resumeWaiters.push(resolve));
  }

  private clearExpiredCircuits(): void {
    const now = Date.now();
    for (const [source, failure] of this.sourceFailures.entries()) {
      if (failure.paused_until && failure.paused_until <= now) this.sourceFailures.set(source, { ...failure, count: 0, paused_until: 0 });
    }
  }

  private findRunnableQueueIndex(): { index: number; waitMs: number } {
    this.clearExpiredCircuits();
    const now = Date.now();
    let earliest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.queue.length; index += 1) {
      const job = this.jobs.get(this.queue[index]);
      if (!job) return { index, waitMs: 0 };
      const circuit = job.source_id ? this.sourceFailures.get(job.source_id) : undefined;
      if (!circuit?.paused_until || circuit.paused_until <= now) {
        job.wait_until = undefined;
        job.pause_reason = undefined;
        return { index, waitMs: 0 };
      }
      earliest = Math.min(earliest, circuit.paused_until);
      job.wait_until = circuit.paused_until;
      job.pause_reason = 'source_circuit';
      job.status_detail = `音源 ${job.source_id} 连续失败，已临时暂停`;
    }
    this.schedulePersist();
    return { index: -1, waitMs: Number.isFinite(earliest) ? earliest - now : 1000 };
  }

  private registerSourceSuccess(sourceId?: string): void {
    if (!sourceId) return;
    this.sourceFailures.delete(sourceId);
  }

  private registerSourceFailure(sourceId: string | undefined, category: DownloadFailureCategory, message: string): void {
    if (!sourceId || !['network_timeout', 'rate_limited', 'address_expired', 'source_error'].includes(category)) return;
    const previous = this.sourceFailures.get(sourceId);
    const count = (previous?.count || 0) + 1;
    this.sourceFailures.set(sourceId, {
      count,
      paused_until: count >= 3 ? Date.now() + 15 * 60 * 1000 : 0,
      last_error: message,
    });
  }
}
