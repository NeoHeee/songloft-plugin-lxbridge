import type { MusicPlatform, MusicInfo } from '../../types';
import { httpFetch } from '../request';
import { base64Decode } from '../crypto-shim';
import { arr, makeMusicInfo, normalizeCover, obj, page, staticSorts } from '../platform-common';

const headers = { Referer: 'https://www.kugou.com/', 'User-Agent': 'Mozilla/5.0' };

function parseSong(raw: Record<string, any>): MusicInfo {
  const hash = String(raw.FileHash || raw.filehash || raw.hash || raw.HASH || '');
  const sq = String(raw.SQFileHash || raw.sqhash || '');
  const hq = String(raw.HQFileHash || raw.hqhash || '');
  const types: Array<{type:string}> = [];
  if (sq) types.push({type:'flac'}); if (hq) types.push({type:'320k'}); types.push({type:'128k'});
  return makeMusicInfo('kg', raw, {
    name: raw.SongName ?? raw.songname ?? raw.songName,
    singer: raw.SingerName ?? raw.AuthorName ?? raw.singername ?? raw.author_name,
    album: raw.AlbumName ?? raw.album_name ?? raw.albumName,
    duration: raw.Duration ?? raw.duration,
    cover: normalizeCover(raw.Image ?? raw.image ?? raw.img),
    songmid: raw.EMixSongID ?? raw.mixsongid ?? raw.audio_id ?? hash,
    musicId: raw.EMixSongID ?? raw.mixsongid ?? raw.audio_id,
    hash,
    albumId: raw.AlbumID ?? raw.album_id,
    extra: { hqHash: hq, sqHash: sq, types },
  });
}

async function search(keyword:string, pageNo=1, limit=30) {
  const qs = `keyword=${encodeURIComponent(keyword)}&page=${pageNo}&pagesize=${limit}&userid=-1&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0`;
  const {body,statusCode}=await httpFetch(`https://songsearch.kugou.com/song_search_v2?${qs}`,{headers}).promise;
  if(statusCode>=400) throw new Error(`酷狗搜索失败: HTTP ${statusCode}`);
  const data=obj(obj(body).data||body); const rows=arr(data.lists||data.list);
  return page('kg', rows.map(x=>parseSong(obj(x))).filter(x=>x.name), pageNo, limit, Number(data.total||rows.length));
}

async function getLyric(song:MusicInfo) {
  const hash=String(song.hash||song.songmid||''); if(!hash) throw new Error('酷狗歌曲缺少 hash');
  const searchResp=await httpFetch(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${encodeURIComponent(hash)}`,{headers}).promise;
  const candidates=arr(obj(searchResp.body).candidates); if(!candidates.length) return {lyric:'',raw:searchResp.body};
  const item=obj(candidates[0]);
  const dl=await httpFetch(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(item.id)}&accesskey=${encodeURIComponent(item.accesskey)}&fmt=lrc&charset=utf8`,{headers}).promise;
  const content=String(obj(dl.body).content||'');
  return {lyric: content ? base64Decode(content) : '', raw: dl.body};
}

const kg:MusicPlatform={
  id:'kg',name:'酷狗音乐',musicSearch:{search},getLyric,
  songList:{
    async tags(){return {source:'kg',list:[{id:'0',name:'热门'},{id:'1',name:'流行'},{id:'2',name:'经典'}]};},
    async list(params){const p=Number(params.page||1);const {body}=await httpFetch(`https://m.kugou.com/plist/index&json=true&page=${p}`,{headers}).promise;const d=obj(obj(body).plist||body);const info=obj(d.list||d);const rows=arr(info.info||info.list);return {source:'kg',page:p,total:Number(info.total||rows.length),list:rows.map(x=>{const r=obj(x);return {id:String(r.specialid||r.id||''),name:String(r.specialname||r.name||''),img:normalizeCover(r.imgurl||r.img),playCount:Number(r.playcount||0)};})};},
    async detail(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://m.kugou.com/plist/list/${encodeURIComponent(id)}?json=true&page=${pageNo}`,{headers}).promise;const d=obj(obj(body).list||body);const info=obj(d.info||d);const rows=arr(info.list||info.info);return {source:'kg',id,page:pageNo,limit,total:Number(info.total||rows.length),list:rows.slice(0,limit).map(x=>parseSong(obj(x)))};},
    async search(keyword,pageNo=1,limit=30){const {body}=await httpFetch(`https://specialsearch.kugou.com/special_search?keyword=${encodeURIComponent(keyword)}&page=${pageNo}&pagesize=${limit}&userid=-1&clientver=&platform=WebFilter&filter=2`,{headers}).promise;const d=obj(obj(body).data||body);const rows=arr(d.lists||d.list||d.info);return {source:'kg',page:pageNo,limit,total:Number(d.total||d.total_count||rows.length),list:rows.map(x=>{const r=obj(x);return {id:String(r.specialid||r.special_id||r.id||''),name:String(r.specialname||r.special_name||r.name||''),img:normalizeCover(r.imgurl||r.img||r.cover),playCount:Number(r.playcount||r.play_count||0),creator:String(r.nickname||r.username||r.creator||''),description:String(r.intro||r.description||'')};}).filter(x=>x.id&&x.name)};},
    async sorts(){return staticSorts('kg');},
  },
  leaderboard:{
    async boards(){const {body}=await httpFetch('https://m.kugou.com/rank/list&json=true',{headers}).promise;const rank=obj(obj(body).rank||body);const rows=arr(rank.list||rank.info);return {source:'kg',list:rows.map(x=>{const r=obj(x);return {id:String(r.rankid||r.id||''),name:String(r.rankname||r.name||''),img:normalizeCover(r.imgurl||r.img)};})};},
    async list(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://m.kugou.com/rank/info/?rankid=${encodeURIComponent(id)}&page=${pageNo}&json=true`,{headers}).promise;const songs=obj(obj(body).songs||body);const rows=arr(songs.list||songs.info);return {source:'kg',id,page:pageNo,limit,total:Number(songs.total||rows.length),list:rows.slice(0,limit).map(x=>parseSong(obj(x)))};},
  },
};
export default kg;
