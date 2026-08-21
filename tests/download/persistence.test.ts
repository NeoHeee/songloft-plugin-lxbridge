import { describe, expect, it } from 'vitest';
import { classifyDownloadFailure, DownloadManager } from '../../src/download/manager';

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  async get(key: string): Promise<unknown> { return this.values.get(key); }
  async set(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

describe('下载任务持久化', () => {
  it('插件重启后把未完成任务恢复为已中断，而不是自动下载', async () => {
    const storage = new MemoryStorage();
    storage.values.set('neo-lxbridge:download_jobs:v1', JSON.stringify({
      version: 1,
      jobs: [{
        id: 'dl_active', song_id: 42, title: '未完成歌曲', artist: '测试歌手',
        status: 'downloading', progress: 50, created_at: Date.now() - 1000, updated_at: Date.now() - 500,
      }],
    }));

    const manager = new DownloadManager(storage);
    await manager.init();
    const restored = manager.get('dl_active');

    expect(restored).toMatchObject({
      status: 'interrupted',
      error_category: 'interrupted',
      status_detail: '插件重启时任务尚未完成',
    });
    expect(manager.getPersistenceStatus()).toMatchObject({ ready: true, jobs: 1, recovered_jobs: 1, error: '' });
  });

  it('任务阶段变化会写入持久化快照', async () => {
    const storage = new MemoryStorage();
    const manager = new DownloadManager(storage);
    await manager.init();
    const job = manager.reserve({ title: '持久化歌曲' });
    manager.setStage(job.id, 'resolving', 20, '正在解析');
    await manager.flush();

    const saved = JSON.parse(String(storage.values.get('neo-lxbridge:download_jobs:v1')));
    expect(saved.jobs[0]).toMatchObject({ id: job.id, status: 'resolving', progress: 20 });
  });

  it('队列暂停状态会随快照恢复', async () => {
    const storage = new MemoryStorage();
    const first = new DownloadManager(storage);
    await first.init();
    first.pause();
    await first.flush();

    const second = new DownloadManager(storage);
    await second.init();
    expect(second.getQueueState().paused).toBe(true);
  });
});

describe('下载队列控制', () => {
  it('可以批量取消等待解析的任务', () => {
    const manager = new DownloadManager();
    const jobs = [manager.reserve({ title: '一' }), manager.reserve({ title: '二' }), manager.reserve({ title: '三' })];
    expect(manager.cancelMany([jobs[0].id, jobs[2].id])).toBe(2);
    expect(manager.list().map(job => job.title)).toEqual(['二']);
  });

  it('可以调整等待下载任务顺序', () => {
    const manager = new DownloadManager();
    const jobs = [manager.reserve({ title: '一' }), manager.reserve({ title: '二' }), manager.reserve({ title: '三' })];
    const internal = manager as unknown as { queue: string[] };
    internal.queue = jobs.map(job => job.id);
    manager.move(jobs[2].id, 'up');
    expect(manager.getQueueState().queued_ids).toEqual([jobs[0].id, jobs[2].id, jobs[1].id]);
  });

  it('不会取消已经从等待队列取出的当前任务', () => {
    const manager = new DownloadManager();
    const job = manager.reserve({ title: '安全间隔中的任务' });
    const internal = manager as unknown as { currentJobId: string };
    internal.currentJobId = job.id;

    expect(manager.remove(job.id)).toBe(false);
    expect(manager.get(job.id)?.title).toBe('安全间隔中的任务');
  });

  it('同一音源连续三次网络类失败后开启保护暂停', () => {
    const manager = new DownloadManager();
    const internal = manager as unknown as { registerSourceFailure(source: string, category: 'network_timeout', message: string): void };
    internal.registerSourceFailure('wy', 'network_timeout', 'timeout');
    internal.registerSourceFailure('wy', 'network_timeout', 'timeout');
    expect(manager.getQueueState().source_circuits).toHaveLength(0);
    internal.registerSourceFailure('wy', 'network_timeout', 'timeout');
    expect(manager.getQueueState().source_circuits[0]).toMatchObject({ source_id: 'wy', failure_count: 3 });
  });
});

describe('下载失败分类', () => {
  it('识别请求频率限制', () => {
    expect(classifyDownloadFailure(new Error('HTTP 429 Too Many Requests')).category).toBe('rate_limited');
  });

  it('识别目录权限错误', () => {
    expect(classifyDownloadFailure(new Error('permission denied'), '/app/music/LxBridge')).toMatchObject({ category: 'permission_denied' });
  });

  it('识别已过期的播放地址', () => {
    expect(classifyDownloadFailure(new Error('403 signature expired')).category).toBe('address_expired');
  });
});
