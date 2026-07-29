import type {
  FallbackMatch,
  HTTPRequest,
  HTTPResponse,
  MusicUrlFallbackHint,
  SearchResultItem,
} from '@songloft/plugin-sdk';
import { createMusicUrlHandler, createSearchHandler, jsonResponse } from '@songloft/plugin-sdk';
import type { MusicInfo, PlatformId } from '../types';
import { musicSdk, sources } from '../musicSdk/facade';
import type { RuntimeManager } from '../engine/manager';
import { bodyToText, parseJSONBody } from './request';

function isPlatform(value: unknown): value is PlatformId {
  return ['kw', 'kg', 'tx', 'wy', 'mg'].includes(String(value));
}

export function toSearchItem(song: MusicInfo, quality = '320k'): SearchResultItem {
  return {
    title: song.name || '',
    artist: song.singer || '',
    album: song.albumName || '',
    duration: Number(song.duration || 0),
    cover_url: song.img || '',
    source_data: { platform: song.source, quality, songInfo: song },
  };
}

export async function searchOne(platform: PlatformId, keyword: string, page = 1, pageSize = 30, quality = '320k'): Promise<SearchResultItem[]> {
  const result = await musicSdk[platform].musicSearch.search(keyword, page, pageSize);
  return result.list.map(song => toSearchItem(song, quality));
}

export async function searchAcross(keyword: string, page = 1, pageSize = 20, quality = '320k'): Promise<SearchResultItem[]> {
  const settled = await Promise.allSettled(sources.map(source => searchOne(source.id, keyword, page, pageSize, quality)));
  const result: SearchResultItem[] = [];
  for (const item of settled) if (item.status === 'fulfilled') result.push(...item.value);
  return result;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function matchScore(item: SearchResultItem, title: string, artist: string, duration?: number): number {
  const it = normalizeText(item.title);
  const ia = normalizeText(item.artist);
  const tt = normalizeText(title);
  const ta = normalizeText(artist);
  let score = 0;
  if (it === tt) score += 100;
  else if (it.includes(tt) || tt.includes(it)) score += 60;
  if (ta && ia === ta) score += 60;
  else if (ta && (ia.includes(ta) || ta.includes(ia))) score += 35;
  if (duration && item.duration) score += Math.max(0, 30 - Math.abs(duration - item.duration));
  return score;
}

export function createSearchRoute(): (req: HTTPRequest) => Promise<HTTPResponse> {
  return async (req: HTTPRequest): Promise<HTTPResponse> => {
    let body: Record<string, unknown>;
    try {
      body = parseJSONBody(req);
    } catch (error) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: String((error as Error).message) }),
      };
    }
    const sourceId = String(body.source_id || 'wy');
    const quality = String(body.quality || '320k');
    const allowDowngrade = body.allow_downgrade !== false;
    const handler = createSearchHandler({
      search: async (keyword, page, pageSize) => {
        const items = sourceId === 'all'
          ? await searchAcross(keyword, page || 1, pageSize || 30, quality)
          : (() => {
              if (!isPlatform(sourceId)) throw new Error(`unsupported source_id: ${sourceId}`);
              return searchOne(sourceId, keyword, page || 1, pageSize || 30, quality);
            })();
        const resolved = await items;
        for (const item of resolved) item.source_data.allow_downgrade = allowDowngrade;
        return resolved;
      },
    });
    const normalized = { ...req, body: JSON.stringify(body) } as unknown as HTTPRequest;
    return await handler(normalized, {});
  };
}

export function createMusicUrlRoute(runtimeManager: RuntimeManager): (req: HTTPRequest) => Promise<HTTPResponse> {
  const fallbackSearch = async (hint: MusicUrlFallbackHint): Promise<FallbackMatch | null> => {
    const keyword = `${hint.title} ${hint.artist}`.trim();
    const candidates = await searchAcross(keyword, 1, 10, '320k');
    const playable = candidates.filter(item => {
      const platform = String(item.source_data.platform || '');
      return isPlatform(platform) && runtimeManager.hasPlatform(platform);
    });
    playable.sort((a, b) => matchScore(b, hint.title, hint.artist, hint.duration) - matchScore(a, hint.title, hint.artist, hint.duration));
    const best = playable[0];
    return best ? { source_data: best.source_data, title: best.title, artist: best.artist } : null;
  };

  const handler = createMusicUrlHandler({
    resolveUrl: async sourceData => {
      const platform = sourceData.platform;
      const quality = String(sourceData.quality || '320k');
      const songInfo = sourceData.songInfo;
      if (!isPlatform(platform) || !songInfo || typeof songInfo !== 'object') throw new Error('source_data 格式无效');
      const resolved = await runtimeManager.getMusicUrl(
        platform,
        songInfo as MusicInfo,
        quality,
        sourceData.allow_downgrade !== false,
      );
      return resolved.headers ? { url: resolved.url, headers: resolved.headers } : resolved.url;
    },
    fallbackSearch,
  });

  return async (req: HTTPRequest): Promise<HTTPResponse> => {
    const normalized = { ...req, body: bodyToText(req.body) } as unknown as HTTPRequest;
    return await handler(normalized, {});
  };
}

interface ExternalSearchHint {
  title?: string;
  artist?: string;
  duration?: number;
}

interface ExternalSearchRequest {
  keyword?: string;
  source_id?: string;
  quality?: string;
  limit?: number;
  page_size?: number;
  page?: number;
  hint?: ExternalSearchHint;
}

function normalizeLimit(value: unknown, fallback = 10): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.min(20, Math.floor(num)));
}

function describeError(error: unknown): string {
  return String((error as Error)?.message || error || 'unknown error');
}

async function resolveExternalItem(runtimeManager: RuntimeManager, item: SearchResultItem): Promise<Record<string, unknown>> {
  const sourceData = item.source_data || {};
  const platform = String(sourceData.platform || '');
  const quality = String(sourceData.quality || '320k');
  const songInfo = sourceData.songInfo as MusicInfo | undefined;
  let url = '';
  let headers: Record<string, string> | undefined;
  let actualQuality = quality;
  let downgraded = false;
  let error = '';

  if (!isPlatform(platform) || !songInfo) {
    error = 'source_data 无效';
  } else if (!runtimeManager.hasPlatform(platform)) {
    error = `平台 ${platform} 尚未启用可用音源`;
  } else {
    try {
      const resolved = await runtimeManager.getMusicUrl(platform, songInfo, quality);
      if (typeof resolved === 'string') {
        url = resolved;
      } else {
        url = resolved.url || '';
        headers = resolved.headers || undefined;
      }
      actualQuality = resolved.actualQuality || quality;
      downgraded = Boolean(resolved.downgraded);
      sourceData.quality = actualQuality;
    } catch (err) {
      error = describeError(err);
    }
  }

  return {
    title: item.title,
    artist: item.artist,
    album: item.album || '',
    duration: Number(item.duration || 0),
    cover_url: item.cover_url || '',
    url,
    headers,
    source_data: sourceData,
    platform,
    quality: actualQuality,
    requested_quality: quality,
    actual_quality: actualQuality,
    downgraded,
    songInfo,
    ...(error ? { error } : {}),
  };
}

export function createExternalSearchRoute(runtimeManager: RuntimeManager): (req: HTTPRequest) => Promise<HTTPResponse> {
  return async (req: HTTPRequest): Promise<HTTPResponse> => {
    try {
      const body = parseJSONBody<ExternalSearchRequest>(req);
      const hint = body.hint || {};
      const keyword = String(body.keyword || '').trim() || `${hint.title || ''} ${hint.artist || ''}`.trim();
      if (!keyword) return jsonResponse({ code: 400, msg: 'keyword is required', data: [] }, 400);

      const sourceId = String(body.source_id || 'all');
      const quality = String(body.quality || '320k');
      const page = Number(body.page || 1) || 1;
      const pageSize = normalizeLimit(body.page_size ?? body.limit, 12);

      let candidates: SearchResultItem[] = [];
      if (sourceId === 'all') {
        candidates = await searchAcross(keyword, page, pageSize, quality);
      } else {
        if (!isPlatform(sourceId)) return jsonResponse({ code: 400, msg: `unsupported source_id: ${sourceId}`, data: [] }, 400);
        candidates = await searchOne(sourceId, keyword, page, pageSize, quality);
      }

      if (hint.title || hint.artist) {
        const hintTitle = String(hint.title || keyword);
        const hintArtist = String(hint.artist || '');
        const hintDuration = hint.duration == null ? undefined : Number(hint.duration);
        candidates.sort((a, b) => matchScore(b, hintTitle, hintArtist, hintDuration) - matchScore(a, hintTitle, hintArtist, hintDuration));
      }

      const limited = candidates.slice(0, pageSize);
      if (!limited.length) {
        return jsonResponse({ code: 404, msg: '未找到匹配歌曲', data: [] }, 404);
      }
      const data = await Promise.all(limited.map(item => resolveExternalItem(runtimeManager, item)));
      return jsonResponse({ code: 0, msg: 'success', data });
    } catch (error) {
      return jsonResponse({ code: 500, msg: describeError(error), data: [] }, 500);
    }
  };
}
