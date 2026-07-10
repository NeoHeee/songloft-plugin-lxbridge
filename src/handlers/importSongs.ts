import type { HTTPRequest, HTTPResponse, SearchResultItem } from '@songloft/plugin-sdk';
import type { MusicInfo, PlatformId } from '../types';
import { musicSdk } from '../musicSdk/facade';
import { callHostAPI } from '../utils/http';
import { parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';

export type SearchSongItem = SearchResultItem & { source_data?: Record<string, any> };

interface ImportRequest {
  songs?: SearchSongItem[];
  playlist_id?: number;
  playlist_name?: string;
  fetch_lyric?: boolean;
}

export interface ImportedSongRecord {
  id: number;
  type?: 'local' | 'remote' | 'radio';
  title?: string;
  artist?: string;
  cover_url?: string;
  file_path?: string;
  dedup_key?: string;
}

function isPlatform(value: unknown): value is PlatformId {
  return ['kw', 'kg', 'tx', 'wy', 'mg'].includes(String(value));
}

function stableId(song: MusicInfo): string {
  return String(song.songmid || song.musicId || song.hash || song.copyrightId || '');
}

async function mapSong(item: SearchSongItem, fetchLyric: boolean): Promise<Record<string, unknown>> {
  const sourceData = item.source_data || {};
  const platform = sourceData.platform;
  const songInfo = sourceData.songInfo as MusicInfo | undefined;
  if (!isPlatform(platform) || !songInfo) throw new Error(`歌曲 ${item.title || ''} 缺少有效 source_data`);

  let lyric = '';
  if (fetchLyric) {
    try {
      lyric = (await musicSdk[platform].getLyric(songInfo)).lyric || '';
    } catch (error) {
      songloft.log.warn(`获取歌词失败 ${item.title}: ${errorMessage(error)}`);
    }
  }

  const id = stableId(songInfo);
  const payload: Record<string, unknown> = {
    title: item.title || songInfo.name,
    artist: item.artist || songInfo.singer || '',
    album: item.album || songInfo.albumName || '',
    cover_url: item.cover_url || songInfo.img || '',
    duration: Number(item.duration || songInfo.duration || 0),
    plugin_entry_path: 'lxmusic',
    source_data: JSON.stringify(sourceData),
  };
  if (id) payload.dedup_key = `${platform}:${id}`;
  if (lyric) {
    payload.lyric = lyric;
    payload.lyric_source = 'manual';
  }
  return payload;
}

async function mapWithConcurrency(items: SearchSongItem[], fetchLyric: boolean, concurrency = 3): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      result[current] = await mapSong(items[current], fetchLyric);
    }
  });
  await Promise.all(workers);
  return result;
}

/**
 * 把搜索结果写入 Songloft 歌曲库。宿主按 (plugin_entry_path, dedup_key)
 * 执行 upsert，因此重复导入会复用同一歌曲 ID；已下载为 local 的歌曲不会被覆盖回 remote。
 */
export async function upsertSearchSongs(items: SearchSongItem[], fetchLyric = true): Promise<ImportedSongRecord[]> {
  if (!items.length) return [];
  const payload = await mapWithConcurrency(items, fetchLyric);
  const created = await callHostAPI<{ songs: ImportedSongRecord[]; count: number }>('/api/v1/songs/remote', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return created.songs || [];
}

export async function importSongsHandler(req: HTTPRequest): Promise<HTTPResponse> {
  try {
    const body = parseJSONBody<ImportRequest>(req);
    if (!Array.isArray(body.songs) || !body.songs.length) throw new Error('songs 不能为空');

    const createdSongs = await upsertSearchSongs(body.songs, body.fetch_lyric !== false);
    let playlistId = Number(body.playlist_id || 0);
    if (!playlistId && body.playlist_name) {
      const firstCover = String(createdSongs[0]?.cover_url || body.songs[0]?.cover_url || '');
      const playlist = await songloft.playlists.create({
        name: body.playlist_name,
        type: 'normal',
        coverUrl: firstCover,
      });
      playlistId = playlist.id;
    }
    if (playlistId && createdSongs.length) {
      await songloft.playlists.addSongs(playlistId, createdSongs.map(song => song.id));
    }

    return ok({
      songs: createdSongs,
      count: createdSongs.length,
      playlist_id: playlistId || null,
    });
  } catch (error) {
    return fail(errorMessage(error), 400);
  }
}
