import { describe, expect, it } from 'vitest';
import { buildAudioPathCandidates } from '../../src/handlers/upgrade';

describe('upgrade audio path candidates', () => {
  it('maps Songloft relative music paths into container roots', () => {
    expect(buildAudioPathCandidates('music/downloads/周杰伦/红尘客栈.flac')).toEqual([
      '/app/music/downloads/周杰伦/红尘客栈.flac',
      '/music/downloads/周杰伦/红尘客栈.flac',
      'music/downloads/周杰伦/红尘客栈.flac',
    ]);
  });

  it('keeps absolute paths and adds the alternate music mount', () => {
    expect(buildAudioPathCandidates('/app/music/测试/周杰伦-红尘客栈.flac')).toEqual([
      '/app/music/测试/周杰伦-红尘客栈.flac',
      '/music/测试/周杰伦-红尘客栈.flac',
    ]);
  });

  it('normalizes Windows separators and encoded filenames', () => {
    expect(buildAudioPathCandidates('music\\测试\\%E7%BA%A2%E5%B0%98%E5%AE%A2%E6%A0%88.flac')[0])
      .toBe('/app/music/测试/红尘客栈.flac');
  });

  it('repairs duplicated music path prefixes', () => {
    expect(buildAudioPathCandidates('/app/music/music/downloads/song.mp3')).toContain('/app/music/downloads/song.mp3');
  });
});
