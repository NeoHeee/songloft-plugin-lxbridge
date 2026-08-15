import { describe, expect, it } from 'vitest';
import { parseMiguSong } from '../../src/musicSdk/mg';

describe('咪咕排行榜歌曲解析', () => {
  it('兼容排行榜 objectInfo 的歌手、封面和时长字段', () => {
    const song = parseMiguSong({
      songId: '1143066826',
      copyrightId: '69089302707',
      songName: '问爱 (Live)',
      singer: 'Yamy郭颖',
      album: '测试专辑',
      albumImgs: [{ img: 'http://example.com/cover.webp' }],
      length: '00:03:05',
    });

    expect(song).toMatchObject({
      name: '问爱 (Live)',
      singer: 'Yamy郭颖',
      duration: 185,
      interval: '03:05',
      img: 'https://example.com/cover.webp',
      copyrightId: '69089302707',
    });
  });
});
