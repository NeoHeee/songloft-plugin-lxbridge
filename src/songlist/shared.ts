import type { PlatformId } from '../types';
import { musicSdk } from '../musicSdk/facade';
import { httpFetch } from '../musicSdk/request';

export interface SharedPlaylistRef { source: PlatformId; id: string; url: string }

const SOURCE_HOSTS: Array<{ source: PlatformId; pattern: RegExp }> = [
  { source: 'wy', pattern: /(^|\.)(music\.163\.com|163cn\.tv)$/i },
  { source: 'tx', pattern: /(^|\.)(y\.qq\.com|qq\.com)$/i },
  { source: 'kg', pattern: /(^|\.)kugou\.com$/i },
  { source: 'kw', pattern: /(^|\.)kuwo\.cn$/i },
  { source: 'mg', pattern: /(^|\.)migu\.cn$/i },
];

function firstUrl(value: unknown): string {
  const text = String(value || '').trim();
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) throw new Error('请粘贴有效的 http 或 https 歌单分享链接');
  return match[0].replace(/[，。；、）》】]+$/u, '').replace(/&amp;/g, '&');
}

function sourceFromUrl(url: URL): PlatformId {
  const matched = SOURCE_HOSTS.find(item => item.pattern.test(url.hostname));
  if (!matched) throw new Error('仅支持酷我、酷狗、QQ 音乐、网易云和咪咕的官方歌单链接');
  return matched.source;
}

function firstParam(url: URL, keys: string[]): string {
  const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
  const hashParams = new URLSearchParams(hashQuery);
  for (const key of keys) {
    const value = url.searchParams.get(key) || hashParams.get(key);
    if (value && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  }
  return '';
}

function routedPath(url: URL): string {
  const hashPath = url.hash.replace(/^#/, '').split('?')[0];
  return `${url.pathname}${hashPath.startsWith('/') ? hashPath : ''}`;
}

export function parseSharedPlaylistUrl(value: unknown): SharedPlaylistRef {
  const raw = firstUrl(value);
  const url = new URL(raw);
  const source = sourceFromUrl(url);
  const path = routedPath(url);
  let id = '';
  if (source === 'wy') id = firstParam(url, ['id', 'playlistId']) || path.match(/\/playlist\/(\d+)/i)?.[1] || '';
  if (source === 'tx') id = firstParam(url, ['id', 'disstid', 'tid', 'playlistId']) || path.match(/\/(?:playlist|playsquare)\/(\d+)/i)?.[1] || '';
  if (source === 'kg') id = firstParam(url, ['id', 'specialid', 'specialId']) || path.match(/\/(?:special\/single|plist\/list)\/(\d+)/i)?.[1] || '';
  if (source === 'kw') id = firstParam(url, ['id', 'pid', 'playlistId']) || path.match(/\/(?:playlist_detail|playlist)\/(\d+)/i)?.[1] || '';
  if (source === 'mg') id = firstParam(url, ['id', 'playlistId', 'playlistid']) || path.match(/\/(?:playlist|musiclist)\/(\d+)/i)?.[1] || '';
  return { source, id, url: url.toString() };
}

function idFromPage(source: PlatformId, body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  const patterns: Record<PlatformId, RegExp[]> = {
    wy: [/playlist(?:Id)?["'\s:=]+["']?(\d{3,})/i, /[?&]id=(\d{3,})/i],
    tx: [/(?:disstid|playlistId|tid)["'\s:=]+["']?(\d{3,})/i],
    kg: [/(?:specialid|specialId)["'\s:=]+["']?(\d{2,})/i],
    kw: [/(?:playlistId|pid)["'\s:=]+["']?(\d{2,})/i],
    mg: [/(?:playlistId|playlistid)["'\s:=]+["']?(\d{2,})/i],
  };
  for (const pattern of patterns[source]) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export async function resolveSharedPlaylist(value: unknown): Promise<SharedPlaylistRef> {
  let parsed = parseSharedPlaylistUrl(value);
  if (parsed.id) return parsed;
  const response = await httpFetch(parsed.url, { timeout: 10000 }).promise;
  if (response.finalUrl && response.finalUrl !== parsed.url) {
    const redirected = parseSharedPlaylistUrl(response.finalUrl);
    if (redirected.source !== parsed.source) throw new Error('分享链接跳转到了不支持的平台');
    parsed = redirected;
  }
  const id = parsed.id || idFromPage(parsed.source, response.body);
  if (!id) throw new Error('未能从分享链接中识别歌单 ID，可能是私人歌单或链接格式暂不支持');
  return { ...parsed, id };
}

function songKey(source: PlatformId, song: Record<string, unknown>): string {
  const id = song.musicId || song.songmid || song.hash || song.copyrightId || song.id || song.rid || song.audio_id;
  return id ? `${source}:${String(id)}` : `${source}:${String(song.name || song.title || '')}:${String(song.artist || song.singer || '')}`;
}

export async function loadSharedPlaylist(value: unknown): Promise<Record<string, unknown>> {
  const ref = await resolveSharedPlaylist(value);
  const songs: unknown[] = [];
  const seen = new Set<string>();
  let name = '';
  let image = '';
  let total = 0;
  const limit = 100;
  for (let page = 1; page <= 50 && songs.length < 500; page += 1) {
    const result = await musicSdk[ref.source].songList.detail(ref.id, page, limit) as Record<string, unknown>;
    const batch = Array.isArray(result.list) ? result.list : [];
    if (page === 1) {
      name = String(result.name || '分享歌单');
      image = String(result.img || '');
      total = Math.max(0, Number(result.total || batch.length));
    }
    if (!batch.length) break;
    let added = 0;
    for (const entry of batch) {
      const song = entry as Record<string, unknown>;
      const key = songKey(ref.source, song);
      if (seen.has(key)) continue;
      seen.add(key);
      songs.push(song);
      added += 1;
      if (songs.length >= 500) break;
    }
    if (!added || batch.length < limit || (total > 0 && songs.length >= Math.min(total, 500))) break;
  }
  return { source: ref.source, id: ref.id, name, img: image, total, loaded: songs.length, truncated: total > songs.length, list: songs };
}
