import type { MusicInfo, PlatformId, SearchResultPage } from '../types';
import { decodeName, durationSeconds, formatPlayTime } from './index';

export function obj(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function arr(value: unknown): any[] { return Array.isArray(value) ? value : []; }

export function first<T = unknown>(...values: T[]): T | undefined {
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
  return undefined;
}

export function joinArtists(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => decodeName(obj(item).name ?? item)).filter(Boolean).join('、');
  }
  return decodeName(value);
}

export function makeMusicInfo(platform: PlatformId, raw: Record<string, any>, mapping: {
  name: unknown; singer: unknown; album?: unknown; duration?: unknown; cover?: unknown;
  songmid?: unknown; musicId?: unknown; hash?: unknown; copyrightId?: unknown;
  strMediaMid?: unknown; albumMid?: unknown; albumId?: unknown;
  extra?: Record<string, unknown>;
}): MusicInfo {
  const duration = durationSeconds(mapping.duration);
  const info: MusicInfo = {
    source: platform,
    name: decodeName(mapping.name),
    singer: joinArtists(mapping.singer),
    albumName: decodeName(mapping.album),
    duration,
    interval: formatPlayTime(duration),
    img: mapping.cover ? String(mapping.cover) : '',
    songmid: mapping.songmid != null ? String(mapping.songmid) : undefined,
    musicId: mapping.musicId != null ? String(mapping.musicId) : undefined,
    hash: mapping.hash != null ? String(mapping.hash) : undefined,
    copyrightId: mapping.copyrightId != null ? String(mapping.copyrightId) : undefined,
    strMediaMid: mapping.strMediaMid != null ? String(mapping.strMediaMid) : undefined,
    albumMid: mapping.albumMid != null ? String(mapping.albumMid) : undefined,
    albumId: mapping.albumId != null ? String(mapping.albumId) : undefined,
    raw,
    ...(mapping.extra || {}),
  };
  if (!info.musicId && info.songmid) info.musicId = info.songmid;
  if (!info.songmid && info.musicId) info.songmid = info.musicId;
  return info;
}

export function page(platform: PlatformId, list: MusicInfo[], pageNo: number, limit: number, total?: number): SearchResultPage {
  const count = Number(total ?? list.length) || list.length;
  return { list, total: count, page: pageNo, limit, allPage: Math.max(1, Math.ceil(count / limit)), source: platform };
}

export function lrcLine(timeSeconds: unknown, text: unknown): string {
  const n = Number(timeSeconds) || 0;
  const minutes = Math.floor(n / 60);
  const seconds = (n % 60).toFixed(2).padStart(5, '0');
  return `[${String(minutes).padStart(2, '0')}:${seconds}]${decodeName(text)}`;
}

export function normalizeCover(url: unknown, size = 500): string {
  return String(url || '').replace(/\{size\}/g, String(size)).replace(/^http:/, 'https:');
}

export function queryString(params: Record<string, unknown>): string {
  return Object.keys(params).filter(k => params[k] != null).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
}

export function staticSorts(source: PlatformId): { source: PlatformId; list: Array<{id:string;name:string}> } {
  return { source, list: [{ id: 'hot', name: '最热' }, { id: 'new', name: '最新' }] };
}
