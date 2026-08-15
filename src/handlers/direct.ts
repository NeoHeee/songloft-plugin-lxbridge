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

function headerValue(headers: unknown, name: string): string {
  const normalized = name.toLowerCase();
  const value = headers as { get?: (key: string) => string | null; forEach?: (callback: (value: string, key: string) => void) => void } | Record<string, unknown> | null;
  if (!value) return '';
  if (typeof value.get === 'function') {
    try { return String(value.get(name) || value.get(normalized) || ''); } catch { /* fall through */ }
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === normalized) return String(item || '');
  }
  const forEachHeader = (value as { forEach?: (callback: (item: string, key: string) => void) => void }).forEach;
  if (typeof forEachHeader === 'function') {
    let found = '';
    try { forEachHeader.call(value, (item: string, key: string) => { if (key.toLowerCase() === normalized) found = String(item || ''); }); } catch { /* ignore */ }
    return found;
  }
  return '';
}

function parseTotalBytes(headers: unknown): number | null {
  const contentRange = headerValue(headers, 'content-range');
  const rangeMatch = contentRange.match(/\/(\d+)\s*$/);
  if (rangeMatch) {
    const total = Number(rangeMatch[1]);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  const rawLength = headerValue(headers, 'content-length').trim();
  if (!rawLength) return null;
  const length = Number(rawLength);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

export async function probeAudio(url: string, requestHeaders: Record<string, string>) {
  type ProbeResult = {
    total_bytes: number | null;
    content_type: string;
    accept_ranges: boolean;
    probe_error?: string;
  };
  const errors: string[] = [];
  const inspect = async (method: 'HEAD' | 'GET', extraHeaders: Record<string, string> = {}): Promise<ProbeResult> => {
    const response = await fetch(url, {
      method,
      headers: { ...requestHeaders, ...extraHeaders },
      redirect: 'follow',
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`${method} 返回 HTTP ${response.status}`);
    }
    return {
      total_bytes: parseTotalBytes(response.headers),
      content_type: headerValue(response.headers, 'content-type').split(';')[0],
      accept_ranges: /bytes/i.test(headerValue(response.headers, 'accept-ranges')) || response.status === 206,
    };
  };

  for (const attempt of [
    { method: 'HEAD', run: () => inspect('HEAD') },
    { method: 'GET', run: () => inspect('GET', { Range: 'bytes=0-0', 'Accept-Encoding': 'identity' }) },
  ]) {
    try {
      const result = await attempt.run();
      if (result.total_bytes != null) return result;
      errors.push('服务器未返回 Content-Length 或 Content-Range');
      if (result.content_type) {
        return { ...result, probe_error: errors.join('；') };
      }
    } catch (error) {
      const message = errorMessage(error);
      errors.push(message === 'not a function' ? `${attempt.method} 探测不受当前运行环境支持` : message);
    }
  }

  return {
    total_bytes: null,
    content_type: '',
    accept_ranges: false,
    probe_error: [...new Set(errors)].join('；') || '音频服务器不支持文件大小探测',
  };
}

export function directHandlers(runtimeManager: RuntimeManager) {
  return {
    musicUrl: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, any>>(req);
        const songInfo = body.songInfo as MusicInfo;
        const source = platform(songInfo?.source || body.source_id);
        const result = await runtimeManager.getMusicUrl(source, songInfo, String(body.quality || '320k'), body.allow_downgrade !== false);
        return ok(result);
      } catch (error) { return fail(errorMessage(error), 404); }
    },

    musicProbe: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<Record<string, any>>(req);
        const songInfo = body.songInfo as MusicInfo;
        const source = platform(songInfo?.source || body.source_id);
        const requestedQuality = String(body.quality || '320k');
        const resolved = await runtimeManager.getMusicUrl(source, songInfo, requestedQuality, body.allow_downgrade !== false);
        const headers = Object.fromEntries(Object.entries(resolved.headers || {}).map(([key, value]) => [key, String(value)]));
        const file = await probeAudio(resolved.url, headers);
        return ok({
          ...file,
          requested_quality: resolved.requestedQuality || requestedQuality,
          actual_quality: resolved.actualQuality || requestedQuality,
          downgraded: Boolean(resolved.downgraded),
          downgrade_allowed: body.allow_downgrade !== false,
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
        const allowDowngrade = body.allow_downgrade !== false;
        if (!title) throw new Error('title/keyword is required');
        const candidates = await searchAcross(`${title} ${artist}`.trim(), 1, 10, quality);
        candidates.sort((a,b)=>matchScore(b,title,artist,body.duration)-matchScore(a,title,artist,body.duration));
        const errors: string[]=[];
        for (const item of candidates.slice(0,20)) {
          try {
            const sd=item.source_data; const source=platform(sd.platform); const songInfo=sd.songInfo as MusicInfo;
            const resolved=await runtimeManager.getMusicUrl(source,songInfo,String(sd.quality||quality),allowDowngrade);
            return ok({
              ...item,
              url: resolved.url,
              headers: resolved.headers || {},
              requested_quality: resolved.requestedQuality || quality,
              actual_quality: resolved.actualQuality || quality,
              downgraded: Boolean(resolved.downgraded),
              source_data: { ...sd, quality: resolved.actualQuality || sd.quality || quality, allow_downgrade: allowDowngrade },
            });
          } catch (error) { errors.push(errorMessage(error)); }
        }
        throw new Error(errors[0] || '没有找到可播放结果');
      } catch (error) { return fail(errorMessage(error), 404); }
    },
  };
}
