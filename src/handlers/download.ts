import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import type { DownloadManager } from '../download/manager';
import { parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';
import { upsertSearchSongs, type SearchSongItem } from './importSongs';

interface DownloadRequest {
  song?: SearchSongItem;
  fetch_lyric?: boolean;
  download_meta?: { total_bytes?: number | null; actual_quality?: string; content_type?: string };
}

export function downloadHandlers(manager: DownloadManager): {
  create: (req: HTTPRequest) => Promise<HTTPResponse>;
  status: (req: HTTPRequest) => Promise<HTTPResponse>;
  retry: (req: HTTPRequest) => Promise<HTTPResponse>;
  remove: (req: HTTPRequest) => Promise<HTTPResponse>;
} {
  return {
    create: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<DownloadRequest>(req);
        if (!body.song || typeof body.song !== 'object') throw new Error('song 不能为空');

        const created = await upsertSearchSongs([body.song], body.fetch_lyric !== false);
        const record = created[0];
        if (!record?.id) throw new Error('写入 Songloft 歌曲库失败');

        const current = await songloft.songs.getById(record.id);
        if (!current) throw new Error('无法读取已导入的歌曲记录');
        const job = manager.enqueue(current, body.download_meta || {});
        return ok({ job });
      } catch (error) {
        return fail(errorMessage(error), 400);
      }
    },

    status: async (req: HTTPRequest): Promise<HTTPResponse> => {
      const id = parseQuery(req.query || '').id || '';
      if (!id) return ok({ jobs: manager.list() });
      const job = manager.get(id);
      if (!job) return fail('下载任务不存在或已过期', 404);
      return ok({ job });
    },

    retry: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<{ id?: string }>(req);
        if (!body.id) throw new Error('缺少下载任务 id');
        return ok({ job: manager.retry(body.id) });
      } catch (error) {
        return fail(errorMessage(error), 400);
      }
    },

    remove: async (req: HTTPRequest): Promise<HTTPResponse> => {
      const query = parseQuery(req.query || '');
      if (query.all === 'finished') return ok({ removed: manager.clearFinished() });
      if (!query.id) return fail('缺少下载任务 id', 400);
      if (!manager.remove(query.id)) return fail('任务不存在，或正在下载中无法删除', 409);
      return ok({ removed: 1 });
    },
  };
}
