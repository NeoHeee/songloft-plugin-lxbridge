import { describe, expect, it } from 'vitest';
import { DownloadManager } from '../../src/download/manager';

describe('批量下载任务阶段', () => {
  it('可以先创建全部任务，再逐条更新解析状态', () => {
    const manager = new DownloadManager();
    const jobs = [
      manager.reserve({ title: '歌曲一', artist: '歌手一' }),
      manager.reserve({ title: '歌曲二', artist: '歌手二' }),
      manager.reserve({ title: '歌曲三', artist: '歌手三' }),
    ];

    expect(manager.list()).toHaveLength(3);
    expect(jobs.every(job => job.status === 'pending' && job.progress === 0)).toBe(true);

    const resolving = manager.setStage(jobs[0].id, 'resolving', 20, '正在探测文件信息');
    expect(resolving).toMatchObject({ status: 'resolving', progress: 20, status_detail: '正在探测文件信息' });
    expect(manager.get(jobs[1].id)).toMatchObject({ status: 'pending', progress: 0 });
  });

  it('解析失败只影响对应任务并保留错误信息', () => {
    const manager = new DownloadManager();
    const first = manager.reserve({ title: '正常歌曲' });
    const second = manager.reserve({ title: '失败歌曲' });

    manager.setStage(first.id, 'resolving', 10, '正在解析播放地址');
    const failed = manager.fail(second.id, new Error('音源解析失败'));

    expect(failed).toMatchObject({ status: 'failed', error: '音源解析失败', status_detail: '处理失败' });
    expect(manager.get(first.id)?.status).toBe('resolving');
  });

  it('可以取消等待、解析或排队中的单条任务', () => {
    const manager = new DownloadManager();
    const pending = manager.reserve({ title: '等待歌曲' });
    const resolving = manager.reserve({ title: '解析歌曲' });
    manager.setStage(resolving.id, 'resolving', 10, '正在解析播放地址');

    expect(manager.remove(pending.id)).toBe(true);
    expect(manager.remove(resolving.id)).toBe(true);
    expect(manager.get(pending.id)).toBeNull();
    expect(manager.get(resolving.id)).toBeNull();
  });

  it('不允许把实际下载中的任务伪装成已取消', () => {
    const manager = new DownloadManager();
    const job = manager.reserve({ title: '下载歌曲' });
    const internalJob = (manager as unknown as { jobs: Map<string, { status: string }> }).jobs.get(job.id);
    if (internalJob) internalJob.status = 'downloading';

    expect(manager.remove(job.id)).toBe(false);
    expect(manager.get(job.id)?.status).toBe('downloading');
  });
});
