import type { MusicPlatform, MusicInfo } from '../../types';
import { httpFetch } from '../request';
import { arr, joinArtists, makeMusicInfo, normalizeCover, obj, page, staticSorts } from '../platform-common';

const headers={Referer:'https://y.qq.com/','User-Agent':'Mozilla/5.0'};

export function parseQQResponseObject(body:unknown):Record<string,any>{if(typeof body!=='string')return obj(body);const text=body.trim().replace(/^\uFEFF/,'');try{return obj(JSON.parse(text));}catch{const start=text.indexOf('{');const end=text.lastIndexOf('}');if(start>=0&&end>start){try{return obj(JSON.parse(text.slice(start,end+1)));}catch{/* handled below */}}return {};}}
export function parseQQPlaylistSearch(body:unknown,pageNo:number,limit:number){const root=parseQQResponseObject(body);const legacyData=obj(root.data);const request=obj(root.req_0||root['music.search.SearchCgiService']);const requestData=obj(request.data);const currentData=obj(obj(requestData.body).songlist);const data=arr(legacyData.list).length?legacyData:currentData;const rows=arr(data.list);const meta=obj(requestData.meta);return {source:'tx' as const,page:pageNo,limit,total:Number(data.sum||data.display_num||meta.sum||meta.estimate_sum||rows.length),list:rows.map(x=>{const r=obj(x);const creator=obj(r.creator);return {id:String(r.dissid||r.tid||r.id||''),name:String(r.dissname||r.title||r.name||''),img:normalizeCover(r.imgurl||r.logo||r.cover_url_big||r.cover),playCount:Number(r.listennum||r.listen_num||r.playCount||0),creator:String(creator.name||r.creator_name||r.nickname||''),description:String(r.introduction||r.desc||r.description||'')};}).filter(x=>x.id&&x.name)};}

function parseSong(raw:Record<string,any>):MusicInfo{
  const album=obj(raw.album); const file=obj(raw.file);
  const mid=String(raw.mid||raw.songmid||raw.songMid||'');
  const mediaMid=String(file.media_mid||raw.strMediaMid||mid);
  const albumMid=String(album.mid||raw.albummid||raw.albumMid||'');
  const types:Array<{type:string}>=[];
  if(Number(file.size_flac||raw.sizeflac)>0) types.push({type:'flac'});
  if(Number(file.size_320mp3||raw.size320)>0) types.push({type:'320k'});
  types.push({type:'128k'});
  return makeMusicInfo('tx',raw,{name:raw.name||raw.songname,singer:joinArtists(raw.singer)||raw.singername,album:album.name||raw.albumname,duration:raw.interval||raw.duration,cover:albumMid?`https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`:'',songmid:mid,musicId:raw.id||raw.songid||mid,strMediaMid:mediaMid,albumMid,albumId:album.id||raw.albumid,extra:{types}});
}

async function search(keyword:string,pageNo=1,limit=30){
  const payload={comm:{ct:'19',cv:'1859',uin:'0'},req:{module:'music.search.SearchCgiService',method:'DoSearchForQQMusicDesktop',param:{query:keyword,num_per_page:limit,page_num:pageNo,search_type:0}}};
  const {body,statusCode}=await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',headers,body:payload}).promise;
  if(statusCode>=400) throw new Error(`QQ音乐搜索失败: HTTP ${statusCode}`);
  const d=obj(obj(obj(obj(body).req).data).body); const song=obj(d.song); const rows=arr(song.list);
  return page('tx',rows.map(x=>parseSong(obj(x))).filter(x=>x.name),pageNo,limit,Number(song.total||rows.length));
}

async function getLyric(song:MusicInfo){const mid=song.songmid||song.musicId;if(!mid)throw new Error('QQ音乐歌曲缺少 songmid');const {body}=await httpFetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}&format=json&nobase64=1&g_tk=5381`,{headers}).promise;const d=obj(body);return {lyric:String(d.lyric||''),tlyric:String(d.trans||d.trans_lrc||''),raw:body};}

const boards=[{id:'4',name:'流行指数榜'},{id:'26',name:'热歌榜'},{id:'27',name:'新歌榜'},{id:'62',name:'飙升榜'}];
const tx:MusicPlatform={id:'tx',name:'QQ音乐',musicSearch:{search},getLyric,
  songList:{
    async tags(){return {source:'tx',list:[{id:'10000000',name:'全部'},{id:'165',name:'流行'},{id:'167',name:'摇滚'},{id:'59',name:'经典'}]};},
    async list(params){const pageNo=Number(params.page||1),limit=Number(params.limit||30);const category=Number(params.tag||10000000);const payload={comm:{cv:1602,ct:20},playlist:{method:'get_playlist_by_tag',param:{id:category,sin:(pageNo-1)*limit,size:limit,order:5,cur_page:pageNo},module:'playlist.PlayListPlazaServer'}};const url=`https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(payload))}`;const {body}=await httpFetch(url,{headers}).promise;const cd=obj(obj(body).playlist).data;const data=obj(cd);const rows=arr(data.v_playlist||data.list);if(!rows.length&&Number(obj(obj(body).playlist).code||0)!==0)throw new Error('QQ 音乐热门歌单接口返回异常');return {source:'tx',page:pageNo,limit,total:Number(data.total||data.sum||rows.length),list:rows.map(x=>{const r=obj(x);const creator=obj(r.creator_info||r.creator);return {id:String(r.tid||r.dissid||''),name:String(r.title||r.dissname||''),img:normalizeCover(r.cover_url_big||r.imgurl),playCount:Number(r.access_num||r.listennum||0),creator:String(creator.nick||creator.name||'')};}).filter(x=>x.id&&x.name)};},
    async detail(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}&format=json`,{headers}).promise;const info=obj(arr(obj(body).cdlist)[0]);const rows=arr(info.songlist);return {source:'tx',id,name:info.dissname||'',img:normalizeCover(info.logo),page:pageNo,limit,total:rows.length,list:rows.slice((pageNo-1)*limit,pageNo*limit).map(x=>parseSong(obj(x)))};},
    async search(keyword,pageNo=1,limit=30){let lastError='上游接口异常';let emptyResult:ReturnType<typeof parseQQPlaylistSearch>|null=null;const searchId=`${Date.now()}${Math.floor(Math.random()*100000).toString().padStart(5,'0')}`;const payload={comm:{g_tk:997034911,uin:'0',format:'json',inCharset:'utf-8',outCharset:'utf-8',notice:0,platform:'h5',needNewCode:1,ct:23,cv:0},req_0:{method:'DoSearchForQQMusicDesktop',module:'music.search.SearchCgiService',param:{remoteplace:'txt.mqq.all',searchid:searchId,search_type:3,query:keyword,page_num:pageNo,num_per_page:limit,highlight:1,grp:1}}};try{const {body,statusCode}=await httpFetch(`https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=DoSearchForQQMusicDesktop&_=${Date.now()}`,{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'application/json, text/plain, */*'},body:payload}).promise;const root=parseQQResponseObject(body);const request=obj(root.req_0);if(statusCode>=400)throw new Error(`HTTP ${statusCode}`);if(Number(root.code||0)!==0||Number(request.code||0)!==0)throw new Error(`上游错误码 ${Number(request.code||root.code||-1)}`);const result=parseQQPlaylistSearch(root,pageNo,limit);if(result.list.length)return result;emptyResult=result;}catch(error){lastError=String((error as Error)?.message||error);}for(const host of ['c6.y.qq.com','c.y.qq.com']){const url=`https://${host}/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&searchid=${searchId}&query=${encodeURIComponent(keyword)}&page_no=${Math.max(0,pageNo-1)}&num_per_page=${limit}&format=json`;try{const {body,statusCode}=await httpFetch(url,{headers:{...headers,Accept:'application/json, text/plain, */*'}}).promise;const root=parseQQResponseObject(body);const code=Number(root.code||0);if(statusCode>=400)throw new Error(`HTTP ${statusCode}`);if(!root.data)throw new Error(code?`上游错误码 ${code}`:'响应格式异常');if(code!==0)throw new Error(`上游错误码 ${code}`);const result=parseQQPlaylistSearch(root,pageNo,limit);if(result.list.length)return result;emptyResult=result;}catch(error){lastError=String((error as Error)?.message||error);}}if(emptyResult)return emptyResult;throw new Error(`QQ 音乐歌单搜索失败：${lastError}`);},
    async sorts(){return staticSorts('tx');},
  },
  leaderboard:{
    async boards(){return {source:'tx',list:boards};},
    async list(id,pageNo=1,limit=100){const {body}=await httpFetch(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?format=json&topid=${encodeURIComponent(id)}&page=${pageNo}`,{headers}).promise;const d=obj(body);const rows=arr(d.songlist).map(x=>obj(x).data||x);return {source:'tx',id,page:pageNo,limit,total:Number(d.total_song_num||rows.length),list:rows.slice(0,limit).map(x=>parseSong(obj(x)))};},
  }
};
export default tx;
