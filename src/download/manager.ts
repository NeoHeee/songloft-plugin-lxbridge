export type DownloadJobStatus = 'queued' | 'downloading' | 'completed' | 'failed';

export interface DownloadJob {
  id: string;
  song_id: number;
  title: string;
  status: DownloadJobStatus;
  path?: string;
  error?: string;
  already_downloaded?: boolean;
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

  enqueue(song: { id: number; title?: string; type?: string; file_path?: string }): DownloadJob {
    if (!song.id) throw new Error('歌曲 ID 无效');

    if (song.type === 'local') {
      const completed: DownloadJob = {
        id: this.createId(song.id),
        song_id: song.id,
        title: song.title || '未知歌曲',
        status: 'completed',
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
      status: 'queued',
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
          const result = await songloft.songs.download(job.song_id, { embed_metadata: true });
          if (result.error) throw new Error(result.error);
          job.status = 'completed';
          job.path = result.path || '';
          job.already_downloaded = false;
        }
        job.error = undefined;
      } catch (error) {
        job.status = 'failed';
        job.error = errorMessage(error);
        songloft.log.error(`[lxbridge] 下载歌曲失败 (${job.title}): ${job.error}`);
      } finally {
        job.updated_at = Date.now();
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
