import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import type { PlatformId } from '../types';
import { musicSdk } from '../musicSdk/facade';
import { errorMessage, fail, ok } from './response';

function platformFrom(req: HTTPRequest): PlatformId {
  const id = parseQuery(req.query).source_id || 'wy';
  if (!['kw','kg','tx','wy','mg'].includes(id)) throw new Error(`不支持的平台: ${id}`);
  return id as PlatformId;
}

export async function songListHandler(req: HTTPRequest, action: string): Promise<HTTPResponse> {
  try {
    const source = platformFrom(req); const query = parseQuery(req.query); const api = musicSdk[source].songList;
    let data: unknown;
    if (action === 'tags') data = await api.tags();
    else if (action === 'list') data = await api.list(query);
    else if (action === 'detail') data = await api.detail(String(query.id || ''), Number(query.page || 1), Number(query.limit || 100));
    else if (action === 'search') data = await api.search(String(query.keyword || ''), Number(query.page || 1), Number(query.limit || 30));
    else if (action === 'sorts') data = await api.sorts();
    else throw new Error(`未知歌单动作: ${action}`);
    return ok(data);
  } catch (error) { return fail(errorMessage(error), 400); }
}

export async function leaderboardHandler(req: HTTPRequest, action: string): Promise<HTTPResponse> {
  try {
    const source = platformFrom(req); const query = parseQuery(req.query); const api = musicSdk[source].leaderboard;
    if (action === 'boards') return ok(await api.boards());
    if (action === 'list') return ok(await api.list(String(query.id || ''), Number(query.page || 1), Number(query.limit || 100)));
    throw new Error(`未知排行榜动作: ${action}`);
  } catch (error) { return fail(errorMessage(error), 400); }
}
