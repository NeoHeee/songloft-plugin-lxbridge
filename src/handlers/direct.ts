import type { HTTPRequest, HTTPResponse, SearchResultItem } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import type { MusicInfo, PlatformId } from '../types';
import { musicSdk } from '../musicSdk/facade';
import type { RuntimeManager } from '../engine/manager';
import { matchScore, searchAcross } from './search';
import { parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';

function platform(value: unknown): PlatformId {
  const id = String(value || '');
  if (!['kw','kg','tx','wy','mg'].includes(id)) throw new Error(`无效平台: ${id}`);
  return id as PlatformId;
}

function decodeSongInfo(encoded: string): MusicInfo {
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as MusicInfo; }
  catch { throw new Error('song_info 编码无效'); }
}

function parseTotalBytes(headers: Headers): number | null {
  const contentRange = headers.get('content-range') || '';
  const rangeMatch = contentRange.match(/\/(\d+)\s*$/);
  if (rangeMatch) {
    const total = Number(rangeMatch[1]);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  const length = Number(headers.get('content-length'));
  return Number.isFinite(length) && length >= 0 ? length : null;
}

async function probeAudio(url: string, requestHeaders: Record<string, string>) {
  const inspect = async (method: 'HEAD' | 'GET', extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(url, { method, headers: { ...requestHeaders, ...extraHeaders }, redirect: 'follow' });
    if (!response.ok && response.status !== 206) throw new Error(`音频服务器返回 HTTP ${response.status}`);
    return {
      total_bytes: parseTotalBytes(response.headers),
      content_type: (response.headers.get('content-type') || '').split(';')[0],
      accept_ranges: /bytes/i.test(response.headers.get('accept-ranges') || '') || response.status === 206,
    };
  };
  try {
    const head = await inspect('HEAD');
    if (head.total_bytes != null) return head;
  } catch {
    // 部分音频服务器禁用 HEAD，继续用单字节 Range 请求探测。
  }
  return await inspect('GET', { Range: 'bytes=0-0' });
}

export function directHandlers(runtimeManager: RuntimeManager) {
  return {
    musicUrl: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, any>>(req);
        const songInfo = body.songInfo as MusicInfo;
        const source = platform(songInfo?.source || body.source_id);
        const result = await runtimeManager.getMusicUrl(source, songInfo, String(body.quality || '320k'));
        return ok(result);
      } catch (error) { return fail(errorMessage(error), 404); }
    },

    musicProbe: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, any>>(req);
        const songInfo = body.songInfo as MusicInfo;
        const source = platform(songInfo?.source || body.source_id);
        const requestedQuality = String(body.quality || '320k');
        const resolved = await runtimeManager.getMusicUrl(source, songInfo, requestedQuality);
        const headers = Object.fromEntries(Object.entries(resolved.headers || {}).map(([key, value]) => [key, String(value)]));
        const file = await probeAudio(resolved.url, headers);
        return ok({
          ...file,
          requested_quality: resolved.requestedQuality || requestedQuality,
          actual_quality: resolved.actualQuality || requestedQuality,
          downgraded: Boolean(resolved.downgraded),
        });
      } catch (error) { return fail(errorMessage(error), 404); }
    },

    lyric: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const query = parseQuery(req.query);
        const source = platform(query.source_id);
        const songInfo = decodeSongInfo(query.song_info || '');
        const result = await musicSdk[source].getLyric(songInfo);
        return ok({ lyric: result.lyric, tlyric: result.tlyric || '', lxlyric: result.lxlyric || '' });
      } catch (error) { return fail(errorMessage(error), 404); }
    },

    topone: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, any>>(req);
        const title = String(body.title || body.keyword || '').trim();
        const artist = String(body.artist || '').trim();
        const quality = String(body.quality || '320k');
        if (!title) throw new Error('title/keyword is required');
        const candidates = await searchAcross(`${title} ${artist}`.trim(), 1, 10, quality);
        candidates.sort((a,b)=>matchScore(b,title,artist,body.duration)-matchScore(a,title,artist,body.duration));
        const errors: string[]=[];
        for (const item of candidates.slice(0,20)) {
          try {
            const sd=item.source_data; const source=platform(sd.platform); const songInfo=sd.songInfo as MusicInfo;
            const resolved=await runtimeManager.getMusicUrl(source,songInfo,String(sd.quality||quality));
            return ok({
              ...item,
              url: resolved.url,
              headers: resolved.headers || {},
              requested_quality: resolved.requestedQuality || quality,
              actual_quality: resolved.actualQuality || quality,
              downgraded: Boolean(resolved.downgraded),
              source_data: { ...sd, quality: resolved.actualQuality || sd.quality || quality },
            });
          } catch (error) { errors.push(errorMessage(error)); }
        }
        throw new Error(errors[0] || '没有找到可播放结果');
      } catch (error) { return fail(errorMessage(error), 404); }
    },
  };
}
