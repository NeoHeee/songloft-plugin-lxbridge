import { describe, expect, it } from 'vitest';
import { parseKugouPlaylistDetail } from '../../src/musicSdk/kg';

describe('酷狗歌单详情解析', () => {
  it('兼容移动歌单页内嵌的 var data 歌曲数组', () => {
    const html = `<script>var data=[{"hash":"abc","hash_flac":"sq","hash_320":"hq","songname":"测试 ] ; 歌曲","singername":"测试歌手","duration":215000,"audio_id":123}], specialData={};</script>`;
    const result = parseKugouPlaylistDetail(html);

    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      hash: 'abc',
      songname: '测试 ] ; 歌曲',
      singername: '测试歌手',
      audio_id: 123,
    });
  });

  it('继续兼容旧版 JSON 详情结构', () => {
    const result = parseKugouPlaylistDetail({ list: { info: { total: 2, list: [{ hash: 'a' }, { hash: 'b' }] } } });
    expect(result.total).toBe(2);
    expect(result.rows.map(item => item.hash)).toEqual(['a', 'b']);
  });
});
