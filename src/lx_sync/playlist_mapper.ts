import type { Song } from '@songloft/plugin-sdk';
import { upsertSearchSongs, type SearchSongItem } from '../handlers/importSongs';
import {
  LX_SYNC_LIST_DATA_KEY,
  LX_SYNC_PLAYLIST_MAP_KEY,
} from './constants';
import type {
  LxListData,
  LxMusicInfo,
  LxPlaylistMapping,
  LxUserListInfo,
} from './types';

const PLATFORMS = new Set(['kw', 'kg', 'tx', 'wy', 'mg']);

function emptyListData(): LxListData {
  return { defaultList: [], loveList: [], userList: [] };
}

function parseStored<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function secondsFromInterval(value: unknown): number {
  const text = String(value || '');
  if (/^\d+:\d{1,2}$/.test(text)) {
    const [minutes, seconds] = text.split(':').map(Number);
    return minutes * 60 + seconds;
  }
  return Math.max(0, Number(value) || 0);
}

function intervalFromSeconds(value: unknown): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function lxSongToSearchItem(song: LxMusicInfo): SearchSongItem | null {
  const platform = String(song.source || '').toLowerCase();
  if (!PLATFORMS.has(platform)) return null;
  const meta = song.meta || {};
  const duration = secondsFromInterval(song.interval);
  const songInfo = {
    ...meta,
    source: platform,
    name: String(song.name || ''),
    singer: String(song.singer || ''),
    albumName: String(meta.albumName || ''),
    duration,
    interval: song.interval || intervalFromSeconds(duration),
    img: String(meta.picUrl || ''),
    musicId: String(meta.songId || song.id || ''),
    songmid: String(meta.songmid || ''),
    hash: String(meta.hash || ''),
    copyrightId: String(meta.copyrightId || ''),
    strMediaMid: String(meta.strMediaMid || ''),
    albumMid: String(meta.albumMid || ''),
    albumId: meta.albumId == null ? '' : String(meta.albumId),
  };
  return {
    title: String(song.name || '未知歌曲'),
    artist: String(song.singer || ''),
    album: String(meta.albumName || ''),
    duration,
    cover_url: String(meta.picUrl || ''),
    source_data: { platform, quality: '320k', songInfo },
  } as SearchSongItem;
}

function parseSourceData(song: Song): Record<string, unknown> | null {
  const raw = song.source_data;
  if (!raw) return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function songloftSongToLx(song: Song): LxMusicInfo | null {
  const sourceData = parseSourceData(song);
  const platform = String(sourceData?.platform || '').toLowerCase();
  const rawInfo = sourceData?.songInfo;
  const info = rawInfo && typeof rawInfo === 'object' ? rawInfo as Record<string, unknown> : {};
  if (!PLATFORMS.has(platform) || !Object.keys(info).length) return null;
  const id = String(
    info.musicId || info.songId || info.songmid || info.hash ||
    info.copyrightId || song.dedup_key || `neo-lxbridge:${song.id}`,
  );
  return {
    id,
    name: String(song.title || info.name || '未知歌曲'),
    singer: String(song.artist || info.singer || ''),
    source: platform,
    interval: intervalFromSeconds(song.duration || info.duration),
    meta: {
      ...info,
      songId: (info.musicId || info.songId || id) as string | number,
      albumName: String(song.album || info.albumName || ''),
      picUrl: String(song.cover_url || info.img || info.picUrl || ''),
    },
  };
}

type MappedList = {
  lxListId: string;
  kind: LxPlaylistMapping['kind'];
  name: string;
  songs: LxMusicInfo[];
  user?: LxUserListInfo;
};

function listsFromData(data: LxListData): MappedList[] {
  return [
    { lxListId: 'lx:love', kind: 'love', name: '我喜欢', songs: data.loveList || [] },
    { lxListId: 'lx:default', kind: 'default', name: '默认列表', songs: data.defaultList || [] },
    ...(data.userList || []).map(user => ({
      lxListId: `lx:user:${user.id}`,
      kind: 'user' as const,
      name: user.name || '未命名歌单',
      songs: user.list || [],
      user,
    })),
  ];
}

export class LxPlaylistMapper {
  private chain: Promise<void> = Promise.resolve();

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.chain;
    this.chain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  async loadListData(): Promise<LxListData> {
    const stored = parseStored<LxListData>(
      await songloft.persistentStorage.get(LX_SYNC_LIST_DATA_KEY),
      emptyListData(),
    );
    return {
      defaultList: Array.isArray(stored.defaultList) ? stored.defaultList : [],
      loveList: Array.isArray(stored.loveList) ? stored.loveList : [],
      userList: Array.isArray(stored.userList) ? stored.userList : [],
    };
  }

  async saveListData(data: LxListData): Promise<void> {
    await songloft.persistentStorage.set(LX_SYNC_LIST_DATA_KEY, JSON.stringify(data));
  }

  async loadMappings(): Promise<LxPlaylistMapping[]> {
    const value = parseStored<unknown>(
      await songloft.persistentStorage.get(LX_SYNC_PLAYLIST_MAP_KEY),
      [],
    );
    return Array.isArray(value)
      ? value.filter(row => row && typeof row === 'object' && Number((row as LxPlaylistMapping).songloftPlaylistId) > 0) as LxPlaylistMapping[]
      : [];
  }

  private async saveMappings(value: LxPlaylistMapping[]): Promise<void> {
    await songloft.persistentStorage.set(LX_SYNC_PLAYLIST_MAP_KEY, JSON.stringify(value));
  }

  async importToSongloft(data: LxListData): Promise<void> {
    await this.exclusive(async () => {
      const mappings = await this.loadMappings();
      const lists = listsFromData(data);
      const activeIds = new Set(lists.map(list => list.lxListId));
      // A list deleted in LX must not be restored from a stale Songloft mapping
      // during the next reverse refresh. We detach the mapping but deliberately
      // keep the Songloft playlist itself as a non-destructive safety measure.
      for (let index = mappings.length - 1; index >= 0; index -= 1) {
        if (mappings[index].kind === 'user' && !activeIds.has(mappings[index].lxListId)) {
          mappings.splice(index, 1);
        }
      }
      for (const list of lists) {
        await this.syncOneList(list, mappings);
        await this.saveMappings(mappings);
      }
      await this.saveMappings(mappings);
    });
  }

  private async syncOneList(list: MappedList, mappings: LxPlaylistMapping[]): Promise<void> {
    let mapping = mappings.find(row => row.lxListId === list.lxListId);
    let playlist = mapping ? await songloft.playlists.getById(mapping.songloftPlaylistId) : null;
    const displayName = `LX · ${list.name}`;
    const description = `由 Songloft LxBridge 管理的洛雪同步歌单（${list.lxListId}）`;
    if (!playlist) {
      playlist = await songloft.playlists.create({ name: displayName, type: 'normal', description });
      mapping = { lxListId: list.lxListId, songloftPlaylistId: playlist.id, name: list.name, kind: list.kind };
      mappings.push(mapping);
    } else if (playlist.name !== displayName || mapping?.name !== list.name) {
      await songloft.playlists.update(playlist.id, { name: displayName, description });
      if (mapping) mapping.name = list.name;
    }

    const items = list.songs.map(lxSongToSearchItem).filter((item): item is SearchSongItem => Boolean(item));
    const imported = items.length ? await upsertSearchSongs(items, false) : [];
    const targetIds = Array.from(new Set(imported.map(song => Number(song.id)).filter(id => id > 0)));
    const current = await songloft.playlists.getSongs(playlist.id);
    const currentIds = current.map(song => song.id);
    const removeIds = currentIds.filter(id => !targetIds.includes(id));
    const addIds = targetIds.filter(id => !currentIds.includes(id));
    if (removeIds.length) await songloft.playlists.removeSongs(playlist.id, removeIds);
    if (addIds.length) await songloft.playlists.addSongs(playlist.id, addIds);
    if (targetIds.length) await songloft.playlists.reorder(playlist.id, targetIds);
  }

  async refreshFromSongloft(data: LxListData): Promise<LxListData> {
    const mappings = await this.loadMappings();
    if (!mappings.length) return data;
    const next: LxListData = {
      defaultList: [...(data.defaultList || [])],
      loveList: [...(data.loveList || [])],
      userList: (data.userList || []).map(list => ({ ...list, list: [...list.list] })),
    };
    for (const mapping of mappings) {
      const playlist = await songloft.playlists.getById(mapping.songloftPlaylistId);
      if (!playlist) continue;
      const songs = (await songloft.playlists.getSongs(playlist.id))
        .map(songloftSongToLx)
        .filter((song): song is LxMusicInfo => Boolean(song));
      if (mapping.kind === 'love') next.loveList = songs;
      else if (mapping.kind === 'default') next.defaultList = songs;
      else {
        const id = mapping.lxListId.replace(/^lx:user:/, '');
        const existing = next.userList.find(list => String(list.id) === id);
        if (existing) {
          existing.name = mapping.name;
          existing.list = songs;
        } else {
          next.userList.push({ id, name: mapping.name, list: songs, locationUpdateTime: Date.now() });
        }
      }
    }
    await this.saveListData(next);
    return next;
  }
}
