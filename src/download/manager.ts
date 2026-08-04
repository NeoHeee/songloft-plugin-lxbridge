import { downloadDirectoryError, getRequestProtectionSettings } from './settings';

export type DownloadJobStatus = 'queued' | 'downloading' | 'completed' | 'failed';

export interface DownloadJob {
  id: string;
  song_id: number;
  title: string;
  artist?: string;
  status: DownloadJobStatus;
  path?: string;
  error?: string;
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
  created_at: number;
  updated_at: number;
}

function errorMessage(error: unknown): string {
  return String((error as Error)?.message || error || '下载失败');
}

export class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private activeBySong = new Map<number, string>();
  private queue: string[] = [];
  private draining = false;
  private counter = 0;
  private lastAttemptFinishedAt = 0;

  enqueue(song: { id: number; title?: string; artist?: string; type?: string; file_path?: string }, metadata: Partial<Pick<DownloadJob, 'total_bytes' | 'actual_quality' | 'content_type' | 'target_dir' | 'path_template' | 'upgrade_source_song_id' | 'upgrade_source_bitrate' | 'upgrade_target_quality'>> = {}): DownloadJob {
    if (!song.id) throw new Error('歌曲 ID 无效');

    if (song.type === 'local') {
      const completed: DownloadJob = {
        id: this.createId(song.id),
        song_id: song.id,
        title: song.title || '未知歌曲',
        artist: song.artist || '',
        status: 'completed',
        ...metadata,
        path: song.file_path || '',
        already_downloaded: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      this.jobs.set(completed.id, completed);
      this.cleanup();
      return { ...completed };
    }

    const existingId = this.activeBySong.get(song.id);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && (existing.status === 'queued' || existing.status === 'downloading')) return { ...existing };
    }

    const job: DownloadJob = {
      id: this.createId(song.id),
      song_id: song.id,
      title: song.title || '未知歌曲',
      artist: song.artist || '',
      status: 'queued',
      ...metadata,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.activeBySong.set(song.id, job.id);
    this.queue.push(job.id);
    this.startDrain();
    this.cleanup();
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
    if (job.status === 'queued' || job.status === 'downloading') return { ...job };
    job.status = 'queued';
    job.error = undefined;
    job.path = undefined;
    job.already_downloaded = false;
    job.updated_at = Date.now();
    this.activeBySong.set(job.song_id, job.id);
    this.queue.push(job.id);
    this.startDrain();
    return { ...job };
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === 'queued' || job.status === 'downloading') return false;
    return this.jobs.delete(id);
  }

  clearFinished(): number {
    let count = 0;
    for (const job of Array.from(this.jobs.values())) {
      if (job.status !== 'queued' && job.status !== 'downloading' && this.jobs.delete(job.id)) count += 1;
    }
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
      const id = this.queue.shift() as string;
      const job = this.jobs.get(id);
      if (!job) continue;

      const protection = await getRequestProtectionSettings();
      const waitMs = protection.enabled && this.lastAttemptFinishedAt
        ? Math.max(0, this.lastAttemptFinishedAt + protection.download_interval_ms - Date.now())
        : 0;
      if (waitMs > 0) {
        job.wait_until = Date.now() + waitMs;
        job.updated_at = Date.now();
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      job.wait_until = undefined;

      job.status = 'downloading';
      job.updated_at = Date.now();
      try {
        const current = await songloft.songs.getById(job.song_id);
        if (!current) throw new Error('歌曲记录不存在');

        if (current.type === 'local') {
          job.status = 'completed';
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
          job.status = 'completed';
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
        }
        job.error = undefined;
      } catch (error) {
        job.status = 'failed';
        const rawError = errorMessage(error);
        job.error = job.target_dir ? downloadDirectoryError(rawError, job.target_dir) : rawError;
        songloft.log.error(`[neo-lxbridge] 下载歌曲失败 (${job.title}): ${job.error}`);
      } finally {
        job.updated_at = Date.now();
        this.lastAttemptFinishedAt = job.updated_at;
        this.activeBySong.delete(job.song_id);
      }
    }
    this.draining = false;
  }

  private cleanup(): void {
    const now = Date.now();
    const expired = Array.from(this.jobs.values())
      .filter(job => job.status !== 'queued' && job.status !== 'downloading' && now - job.updated_at > 30 * 60 * 1000)
      .map(job => job.id);
    for (const id of expired) this.jobs.delete(id);

    if (this.jobs.size <= 100) return;
    const removable = Array.from(this.jobs.values())
      .filter(job => job.status !== 'queued' && job.status !== 'downloading')
      .sort((a, b) => a.updated_at - b.updated_at);
    while (this.jobs.size > 100 && removable.length) {
      this.jobs.delete((removable.shift() as DownloadJob).id);
    }
  }
}
