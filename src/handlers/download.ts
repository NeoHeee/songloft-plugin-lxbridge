import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import type { DownloadManager } from '../download/manager';
import { parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';
import { upsertSearchSongs, type SearchSongItem } from './importSongs';
import { getDownloadPathSettings, resolveDownloadPathSettings, type DownloadPathSettings } from '../download/settings';

interface DownloadRequest {
  song?: SearchSongItem;
  fetch_lyric?: boolean;
  download_meta?: { total_bytes?: number | null; actual_quality?: string; content_type?: string };
  download_options?: Partial<DownloadPathSettings>;
  upgrade_meta?: { source_song_id?: number; source_bitrate?: number; target_quality?: string };
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

        const upgradeSuffix = body.upgrade_meta?.source_song_id
          ? `:upgrade:${Number(body.upgrade_meta.source_song_id)}:${String(body.upgrade_meta.target_quality || 'quality')}`
          : '';
        const created = await upsertSearchSongs([body.song], body.fetch_lyric !== false, upgradeSuffix);
        const record = created[0];
        if (!record?.id) throw new Error('写入 Songloft 歌曲库失败');

        const current = await songloft.songs.getById(record.id);
        if (!current) throw new Error('无法读取已导入的歌曲记录');
        const pathSettings = await getDownloadPathSettings();
        const selectedSettings = resolveDownloadPathSettings(body.download_options || {}, pathSettings);
        if (body.upgrade_meta?.source_song_id) {
          if (!selectedSettings.target_dir) throw new Error('安全洗版必须使用独立的新版保存目录');
          const oldSong = await songloft.songs.getById(Number(body.upgrade_meta.source_song_id));
          if (!oldSong || oldSong.type !== 'local') throw new Error('洗版源歌曲不存在或已被修改');
          const oldPath = String(oldSong.file_path || '').replace(/\\/g, '/');
          const oldDirectory = oldPath.slice(0, oldPath.lastIndexOf('/')).replace(/\/+$/, '');
          if (oldDirectory && selectedSettings.target_dir === oldDirectory) {
            throw new Error('新版保存目录不能与旧文件所在目录相同，请使用独立目录');
          }
        }
        const job = manager.enqueue(current, {
          ...(body.download_meta || {}),
          target_dir: selectedSettings.target_dir || undefined,
          path_template: selectedSettings.target_dir ? (body.upgrade_meta?.source_song_id ? '{title}-{artist}' : selectedSettings.path_template) : undefined,
          upgrade_source_song_id: Number(body.upgrade_meta?.source_song_id || 0) || undefined,
          upgrade_source_bitrate: Number(body.upgrade_meta?.source_bitrate || 0) || undefined,
          upgrade_target_quality: String(body.upgrade_meta?.target_quality || '') || undefined,
        });
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
