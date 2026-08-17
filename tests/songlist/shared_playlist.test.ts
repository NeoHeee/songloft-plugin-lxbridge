import { describe, expect, it } from 'vitest';
import { parseSharedPlaylistUrl } from '../../src/songlist/shared';

describe('shared playlist URL parsing', () => {
  it.each([
    ['https://music.163.com/playlist?id=123456', 'wy', '123456'],
    ['https://music.163.com/#/playlist?id=3201302472', 'wy', '3201302472'],
    ['https://y.qq.com/n/ryqq/playlist/234567', 'tx', '234567'],
    ['https://www.kugou.com/yy/special/single/345678.html', 'kg', '345678'],
    ['https://www.kuwo.cn/playlist_detail/456789', 'kw', '456789'],
    ['https://music.migu.cn/v3/music/playlist/567890', 'mg', '567890'],
  ])('parses %s', (url, source, id) => {
    expect(parseSharedPlaylistUrl(url)).toMatchObject({ source, id });
  });

  it('extracts a link from copied share text', () => {
    expect(parseSharedPlaylistUrl('分享歌单：经典老歌 https://music.163.com/playlist?id=9988 点击打开').id).toBe('9988');
  });

  it('rejects non-music hosts before requesting them', () => {
    expect(() => parseSharedPlaylistUrl('https://example.com/playlist?id=1')).toThrow('仅支持');
  });
});
