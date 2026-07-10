import type { MusicPlatform, MusicInfo } from '../../types';
import { httpFetch } from '../request';
import { arr, makeMusicInfo, normalizeCover, obj, page, staticSorts } from '../platform-common';

const headers={Referer:'https://music.migu.cn/','User-Agent':'Mozilla/5.0','By':'migu'};
function parseSong(raw:Record<string,any>):MusicInfo{const singers=raw.singers||raw.singerName||raw.singer;const id=raw.copyrightId||raw.copyrightid||raw.id||raw.songId;return makeMusicInfo('mg',raw,{name:raw.songName||raw.name,singer:singers,album:raw.albumName||raw.album,duration:raw.duration||raw.length,cover:normalizeCover(raw.cover||raw.coverUrl||raw.imgItems&&arr(raw.imgItems)[0]&&obj(arr(raw.imgItems)[0]).img),songmid:id,musicId:id,copyrightId:id,albumId:raw.albumId,extra:{types:[{type:'flac'},{type:'320k'},{type:'128k'}]}});}
async function search(keyword:string,pageNo=1,limit=30){const {body,statusCode}=await httpFetch(`https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=${limit}&type=2&keyword=${encodeURIComponent(keyword)}&pgc=${pageNo}`,{headers}).promise;if(statusCode>=400)throw new Error(`咪咕搜索失败: HTTP ${statusCode}`);const d=obj(body);const rows=arr(d.musics||obj(d.data).songs||d.songResultData);return page('mg',rows.map(x=>parseSong(obj(x))).filter(x=>x.name),pageNo,limit,Number(d.pgt||d.total||rows.length));}
async function getLyric(song:MusicInfo){const id=song.copyrightId||song.musicId||song.songmid;if(!id)throw new Error('咪咕歌曲缺少 copyrightId');const {body}=await httpFetch(`https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=${encodeURIComponent(id)}`,{headers}).promise;const d=obj(obj(body).data||body);return {lyric:String(d.lyric||d.lrc||''),tlyric:String(d.translatedLyric||''),raw:body};}
const boards=[{id:'jianjiao_newsong',name:'尖叫新歌榜'},{id:'jianjiao_hotsong',name:'尖叫热歌榜'},{id:'music_index',name:'音乐指数榜'}];
const mg:MusicPlatform={id:'mg',name:'咪咕音乐',musicSearch:{search},getLyric,
  songList:{
    async tags(){return {source:'mg',list:[{id:'1000001770',name:'推荐'},{id:'1000001749',name:'流行'},{id:'1000001754',name:'摇滚'}]};},
    async list(params){const pageNo=Number(params.page||1),limit=Number(params.limit||30),tag=String(params.tag||'1000001770');const {body}=await httpFetch(`https://m.music.migu.cn/migu/remoting/playlist_bycolumnid_tag?columnId=${encodeURIComponent(tag)}&tagId=&startIndex=${(pageNo-1)*limit}&count=${limit}`,{headers}).promise;const d=obj(body);const rows=arr(d.retMsg||d.playlist||obj(d.data).list);return {source:'mg',page:pageNo,limit,total:Number(d.totalCount||rows.length),list:rows};},
    async detail(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://music.migu.cn/v3/music/playlist/${encodeURIComponent(id)}`,{headers}).promise;const d=obj(obj(body).data||body);const rows=arr(d.songs||d.musicList);return {source:'mg',id,page:pageNo,limit,total:Number(d.total||rows.length),name:d.name||'',img:normalizeCover(d.cover),list:rows.slice((pageNo-1)*limit,pageNo*limit).map(x=>parseSong(obj(x)))};},
    async search(keyword,pageNo=1,limit=30){const {body}=await httpFetch(`https://m.music.migu.cn/migu/remoting/scr_search_tag?rows=${limit}&type=6&keyword=${encodeURIComponent(keyword)}&pgc=${pageNo}`,{headers}).promise;return {source:'mg',page:pageNo,limit,data:body};},
    async sorts(){return staticSorts('mg');},
  },
  leaderboard:{
    async boards(){return {source:'mg',list:boards};},
    async list(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://music.migu.cn/v3/music/top/${encodeURIComponent(id)}`,{headers}).promise;const d=obj(obj(body).data||body);const rows=arr(d.songs||d.musicList||d.list);return {source:'mg',id,page:pageNo,limit,total:Number(d.total||rows.length),list:rows.slice(0,limit).map(x=>parseSong(obj(x)))};},
  }
};
export default mg;
