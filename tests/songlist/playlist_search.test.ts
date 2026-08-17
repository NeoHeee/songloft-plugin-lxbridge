import { describe, expect, it } from 'vitest';
import { parseKuwoPlaylistSearch } from '../../src/musicSdk/kw';
import { parseMiguPlaylistSearch } from '../../src/musicSdk/mg';
import { parseQQPlaylistSearch, parseQQResponseObject } from '../../src/musicSdk/tx';

describe('歌单搜索解析', () => {
  it('解析酷我 legacy playlist 搜索结构', () => {
    const result = parseKuwoPlaylistSearch({ TOTAL: '1', abslist: [{ playlistid: '11', name: '经典', pic: 'http://img.test/a.jpg', playcnt: '9', nickname: '用户', intro: '简介' }] }, 1, 30);
    expect(result.list[0]).toMatchObject({ id: '11', name: '经典', img: 'https://img.test/a.jpg', playCount: 9, creator: '用户' });
  });

  it('解析 QQ client_music_search_songlist 结构', () => {
    const result = parseQQPlaylistSearch({ data: { sum: 1, list: [{ dissid: '22', dissname: '华语经典', imgurl: 'http://img.test/b.jpg', listennum: 18, creator: { name: '歌单作者' } }] } }, 1, 30);
    expect(result.list[0]).toMatchObject({ id: '22', name: '华语经典', img: 'https://img.test/b.jpg', playCount: 18, creator: '歌单作者' });
  });

  it('QQ 上游错误响应不会被解析成伪歌单', () => {
    const result = parseQQPlaylistSearch({ code: -2, subcode: -2 }, 1, 30);
    expect(result.list).toEqual([]);
  });

  it('兼容 QQ 返回字符串、BOM 和 JSONP 包装', () => {
    const payload = { code: 0, data: { sum: 1, list: [{ dissid: '80', dissname: '80 后经典' }] } };
    expect(parseQQPlaylistSearch(`\uFEFF${JSON.stringify(payload)}`, 1, 30).list[0]?.id).toBe('80');
    expect(parseQQPlaylistSearch(`MusicJsonCallback(${JSON.stringify(payload)})`, 1, 30).list[0]?.name).toBe('80 后经典');
    expect(parseQQResponseObject('not-json')).toEqual({});
  });

  it('解析 QQ musicu 当前歌单搜索结构', () => {
    const result = parseQQPlaylistSearch({ code: 0, req_0: { code: 0, data: { body: { songlist: { list: [{ dissid: '44', dissname: '百听不厌的周杰伦', creator: { name: '作者' } }] } }, meta: { sum: 300 } } } }, 1, 30);
    expect(result.total).toBe(300);
    expect(result.list[0]).toMatchObject({ id: '44', name: '百听不厌的周杰伦', creator: '作者' });
  });

  it('解析咪咕 search_all songListResultData 结构', () => {
    const result = parseMiguPlaylistSearch({ songListResultData: { totalCount: '1', result: [{ id: '33', name: '老歌时光', musicListPicUrl: 'http://img.test/c.jpg', playNum: '27', ts: ['经典', '怀旧'] }] } }, 1, 30);
    expect(result.list[0]).toMatchObject({ id: '33', name: '老歌时光', img: 'https://img.test/c.jpg', playCount: 27, description: '经典 · 怀旧' });
  });
});
