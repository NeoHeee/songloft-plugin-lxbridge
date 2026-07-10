import type { MusicPlatform, MusicInfo } from '../../types';
import { httpFetch } from '../request';
import { arr, makeMusicInfo, normalizeCover, obj, page, staticSorts } from '../platform-common';

const headers = { Referer: 'https://www.kuwo.cn/', csrf: '0' };

function parseSong(raw: Record<string, any>): MusicInfo {
  const id = String(raw.MUSICRID || raw.rid || raw.musicrid || raw.id || '').replace(/^MUSIC_/, '');
  const nInfo = String(raw.N_MINFO || raw.n_minfo || '');
  const types: Array<{type:string;size?:string}> = [];
  if (/bitrate:4000/.test(nInfo)) types.push({ type: 'flac24bit' });
  if (/bitrate:2000/.test(nInfo)) types.push({ type: 'flac' });
  if (/bitrate:320/.test(nInfo)) types.push({ type: '320k' });
  types.push({ type: '128k' });
  return makeMusicInfo('kw', raw, {
    name: raw.SONGNAME ?? raw.name ?? raw.songName,
    singer: raw.ARTIST ?? raw.artist ?? raw.artistName,
    album: raw.ALBUM ?? raw.album ?? raw.albumName,
    duration: raw.DURATION ?? raw.duration,
    cover: normalizeCover(raw.prob_albumpic || raw.pic || raw.web_albumpic_short && `https://img4.kuwo.cn/star/albumcover/1000${raw.web_albumpic_short}`),
    songmid: id,
    musicId: id,
    albumId: raw.ALBUMID ?? raw.albumid,
    extra: { types },
  });
}

async function search(keyword: string, pageNo = 1, limit = 30) {
  const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${pageNo - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
  const { body, statusCode } = await httpFetch(url, { headers }).promise;
  if (statusCode >= 400) throw new Error(`酷我搜索失败: HTTP ${statusCode}`);
  const data = obj(body);
  const list = arr(data.abslist).map(item => parseSong(obj(item))).filter(item => item.name);
  return page('kw', list, pageNo, limit, Number(data.TOTAL || data.total || list.length));
}

async function getLyric(song: MusicInfo) {
  const id = song.musicId || song.songmid;
  if (!id) throw new Error('酷我歌曲缺少 musicId');
  const { body } = await httpFetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(id)}`, { headers }).promise;
  const data = obj(obj(body).data || body);
  const lines = arr(data.lrclist || data.lrcList).map(line => {
    const x = obj(line); const t = Number(x.time || x.startTime || 0);
    const m = Math.floor(t / 60); const s = (t % 60).toFixed(2).padStart(5, '0');
    return `[${String(m).padStart(2, '0')}:${s}]${String(x.lineLyric || x.line || '')}`;
  });
  return { lyric: lines.join('\n'), raw: body };
}

const boards = [
  { id: '16', name: '酷我热歌榜' }, { id: '17', name: '酷我新歌榜' },
  { id: '93', name: '酷我飙升榜' }, { id: '158', name: '抖音热歌榜' },
];

const kw: MusicPlatform = {
  id: 'kw', name: '酷我音乐', musicSearch: { search }, getLyric,
  songList: {
    async tags() { return { source: 'kw', list: [{ id: '全部', name: '全部' }, { id: '流行', name: '流行' }, { id: '摇滚', name: '摇滚' }, { id: '民谣', name: '民谣' }] }; },
    async list(params) {
      const pn = Math.max(1, Number(params.page || 1)); const rn = Math.max(1, Number(params.limit || 30));
      const { body } = await httpFetch(`https://www.kuwo.cn/api/www/classify/playlist/getRcmPlayList?pn=${pn}&rn=${rn}&order=${encodeURIComponent(params.sort || 'hot')}&httpsStatus=1`, { headers }).promise;
      const data = obj(obj(body).data || body); const rows = arr(data.data || data.list);
      return { source: 'kw', page: pn, limit: rn, total: Number(data.total || rows.length), list: rows.map(x => { const r=obj(x); return { id:String(r.id||r.pid||''), name:String(r.name||r.title||''), img:normalizeCover(r.img||r.pic), playCount:Number(r.listencnt||r.playCount||0), description:String(r.info||'') }; }) };
    },
    async detail(id, pageNo = 1, limit = 100) {
      const { body } = await httpFetch(`https://www.kuwo.cn/api/www/playlist/playListInfo?pid=${encodeURIComponent(id)}&pn=${pageNo}&rn=${limit}&httpsStatus=1`, { headers }).promise;
      const data = obj(obj(body).data || body); const rows = arr(data.musicList || data.list);
      return { source: 'kw', id, name: data.name || data.title || '', img: normalizeCover(data.img || data.pic), total: Number(data.total || rows.length), page: pageNo, limit, list: rows.map(x => parseSong(obj(x))) };
    },
    async search(keyword, pageNo = 1, limit = 30) {
      const { body } = await httpFetch(`https://www.kuwo.cn/api/www/search/searchPlayListBykeyWord?key=${encodeURIComponent(keyword)}&pn=${pageNo}&rn=${limit}&httpsStatus=1`, { headers }).promise;
      const data = obj(obj(body).data || body); const rows=arr(data.list || data.data);
      return { source:'kw', page:pageNo, limit, total:Number(data.total||rows.length), list:rows };
    },
    async sorts() { return staticSorts('kw'); },
  },
  leaderboard: {
    async boards() { return { source: 'kw', list: boards }; },
    async list(id, pageNo = 1, limit = 100) {
      const { body } = await httpFetch(`https://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${pageNo - 1}&rn=${limit}&type=bang&data=content&id=${encodeURIComponent(id)}&show_copyright_off=0&pcmp4=1&isbang=1`, { headers }).promise;
      const data = obj(body); const rows = arr(data.musiclist || data.musicList || data.list);
      return { source:'kw', id, page:pageNo, limit, total:Number(data.num||data.total||rows.length), list:rows.map(x=>parseSong(obj(x))) };
    },
  },
};
export default kw;
