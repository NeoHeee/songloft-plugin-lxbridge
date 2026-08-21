import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAudioFileStatus } from '../../src/download/filesystem';

afterEach(() => vi.unstubAllGlobals());

function mockCommand(exec: (...args: any[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>) {
  vi.stubGlobal('songloft', { command: { exec } });
}

describe('本地音频文件验证', () => {
  it('文件可读时返回存在', async () => {
    mockCommand(async (_command, args) => ({ exitCode: args.at(-1) === '/app/music/LxBridge/song.flac' ? 0 : 1, stdout: '', stderr: '' }));
    await expect(localAudioFileStatus('/app/music/LxBridge/song.flac')).resolves.toBe('exists');
  });

  it('所有映射候选都不存在时返回缺失', async () => {
    mockCommand(async () => ({ exitCode: 1, stdout: '', stderr: '' }));
    await expect(localAudioFileStatus('/app/music/LxBridge/missing.flac')).resolves.toBe('missing');
  });

  it('容器命令不可用时返回未知而不是误判缺失', async () => {
    mockCommand(async () => { throw new Error('command unavailable'); });
    await expect(localAudioFileStatus('/app/music/LxBridge/song.flac')).resolves.toBe('unknown');
  });
});
