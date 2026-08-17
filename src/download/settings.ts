export const DOWNLOAD_TARGET_DIR_KEY = 'download_target_dir';
export const DOWNLOAD_TARGET_DIR_INPUT_KEY = 'download_target_dir_input';
export const DOWNLOAD_CREATE_ARTIST_FOLDER_KEY = 'download_create_artist_folder';
export const DOWNLOAD_FILENAME_ORDER_KEY = 'download_filename_order';
export const DOWNLOAD_FAVORITE_DIRS_KEY = 'download_favorite_dirs';
export const DOWNLOAD_PROTECTION_ENABLED_KEY = 'download_protection_enabled';
export const DOWNLOAD_INTERVAL_MS_KEY = 'download_interval_ms';
export const PLAYBACK_INTERVAL_MS_KEY = 'playback_interval_ms';

export const DEFAULT_DOWNLOAD_INTERVAL_MS = 5000;
export const DEFAULT_PLAYBACK_INTERVAL_MS = 2000;
export const DEFAULT_MUSIC_ROOT = '/app/music';

export type DownloadFilenameOrder = 'title_artist' | 'artist_title';

export interface DownloadPathSettings {
  target_dir_input: string;
  target_dir: string;
  create_artist_folder: boolean;
  filename_order: DownloadFilenameOrder;
  path_template: string;
  favorite_dirs: string[];
}

export interface RequestProtectionSettings {
  enabled: boolean;
  download_interval_ms: number;
  playback_interval_ms: number;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() !== 'false';
}

function normalizeInterval(value: unknown, fallback: number, min: number, max: number): number {
  if (value == null || value === '') return fallback;
  const interval = Number(value);
  if (!Number.isFinite(interval)) throw new Error('保护间隔必须是有效数字');
  return Math.round(Math.min(max, Math.max(min, interval)));
}

export async function getRequestProtectionSettings(): Promise<RequestProtectionSettings> {
  const [enabled, downloadInterval, playbackInterval] = await Promise.all([
    songloft.persistentStorage.get(DOWNLOAD_PROTECTION_ENABLED_KEY),
    songloft.persistentStorage.get(DOWNLOAD_INTERVAL_MS_KEY),
    songloft.persistentStorage.get(PLAYBACK_INTERVAL_MS_KEY),
  ]);
  return {
    enabled: normalizeBoolean(enabled, true),
    download_interval_ms: normalizeInterval(downloadInterval, DEFAULT_DOWNLOAD_INTERVAL_MS, 2000, 60000),
    playback_interval_ms: normalizeInterval(playbackInterval, DEFAULT_PLAYBACK_INTERVAL_MS, 1000, 30000),
  };
}

export async function setRequestProtectionSettings(value: Partial<RequestProtectionSettings>): Promise<RequestProtectionSettings> {
  const current = await getRequestProtectionSettings();
  const settings = {
    enabled: normalizeBoolean(value.enabled, current.enabled),
    download_interval_ms: normalizeInterval(value.download_interval_ms, current.download_interval_ms, 2000, 60000),
    playback_interval_ms: normalizeInterval(value.playback_interval_ms, current.playback_interval_ms, 1000, 30000),
  };
  await Promise.all([
    songloft.persistentStorage.set(DOWNLOAD_PROTECTION_ENABLED_KEY, settings.enabled),
    songloft.persistentStorage.set(DOWNLOAD_INTERVAL_MS_KEY, settings.download_interval_ms),
    songloft.persistentStorage.set(PLAYBACK_INTERVAL_MS_KEY, settings.playback_interval_ms),
  ]);
  return settings;
}

export function normalizeDownloadTargetDir(value: unknown): string {
  const targetDir = String(value || '').trim();
  if (!targetDir) return '';
  if (targetDir.includes('\0')) throw new Error('下载目录包含无效字符');
  if (!targetDir.startsWith('/')) throw new Error('下载目录必须是绝对路径，例如 /音乐 或 /音乐/Songloft');
  if (targetDir.split('/').includes('..')) throw new Error('下载目录不能包含 .. 路径片段');
  return targetDir.length > 1 ? targetDir.replace(/\/+$/, '') : targetDir;
}

function normalizeTargetDirInput(value: unknown): string {
  const input = String(value || '').trim().replace(/\\/g, '/');
  if (!input) return '';
  if (input.includes('\0')) throw new Error('下载目录包含无效字符');
  if (input.split('/').includes('..')) throw new Error('下载目录不能包含 .. 路径片段');
  const normalized = input.length > 1 ? input.replace(/\/+$/, '') : input;
  if (normalized === DEFAULT_MUSIC_ROOT || normalized.startsWith(`${DEFAULT_MUSIC_ROOT}/`)) return normalized;
  const relative = normalized.replace(/^\/+/, '');
  if (!relative) throw new Error('请填写音乐目录下的子目录，例如 /LxBridge');
  return `/${relative}`;
}

export function resolveDownloadTargetDir(input: unknown): string {
  const normalized = normalizeTargetDirInput(input);
  if (!normalized) return '';
  if (normalized === DEFAULT_MUSIC_ROOT || normalized.startsWith(`${DEFAULT_MUSIC_ROOT}/`)) return normalized;
  return `${DEFAULT_MUSIC_ROOT}${normalized}`;
}

function normalizeFilenameOrder(value: unknown): DownloadFilenameOrder {
  return value === 'artist_title' ? 'artist_title' : 'title_artist';
}

function normalizeFavoriteDirs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  for (const item of values) {
    try {
      const normalized = normalizeTargetDirInput(item);
      if (normalized) unique.add(normalized);
    } catch { /* ignore stale invalid entries */ }
  }
  return Array.from(unique).slice(0, 20);
}

export function buildDownloadPathTemplate(createArtistFolder: boolean, filenameOrder: DownloadFilenameOrder): string {
  const filename = filenameOrder === 'artist_title' ? '{artist}-{title}' : '{title}-{artist}';
  return createArtistFolder ? `{artist}/${filename}` : filename;
}

export async function getDownloadPathSettings(): Promise<DownloadPathSettings> {
  const [storedTargetDir, storedInput, createArtistFolder, filenameOrder, favoriteDirs] = await Promise.all([
    songloft.persistentStorage.get(DOWNLOAD_TARGET_DIR_KEY),
    songloft.persistentStorage.get(DOWNLOAD_TARGET_DIR_INPUT_KEY),
    songloft.persistentStorage.get(DOWNLOAD_CREATE_ARTIST_FOLDER_KEY),
    songloft.persistentStorage.get(DOWNLOAD_FILENAME_ORDER_KEY),
    songloft.persistentStorage.get(DOWNLOAD_FAVORITE_DIRS_KEY),
  ]);
  const targetDir = normalizeDownloadTargetDir(storedTargetDir);
  const targetDirInput = storedInput == null || storedInput === ''
    ? targetDir
    : normalizeTargetDirInput(storedInput);
  const createFolder = normalizeBoolean(createArtistFolder, false);
  const order = normalizeFilenameOrder(filenameOrder);
  return {
    target_dir_input: targetDirInput,
    target_dir: targetDir,
    create_artist_folder: createFolder,
    filename_order: order,
    path_template: buildDownloadPathTemplate(createFolder, order),
    favorite_dirs: normalizeFavoriteDirs(favoriteDirs),
  };
}

export async function setDownloadPathSettings(value: Partial<DownloadPathSettings>): Promise<DownloadPathSettings> {
  const current = await getDownloadPathSettings();
  const input = value.target_dir_input == null ? current.target_dir_input : normalizeTargetDirInput(value.target_dir_input);
  const targetDir = value.target_dir_input == null ? current.target_dir : resolveDownloadTargetDir(input);
  const createFolder = normalizeBoolean(value.create_artist_folder, current.create_artist_folder);
  const order = normalizeFilenameOrder(value.filename_order ?? current.filename_order);
  const favoriteDirs = value.favorite_dirs == null ? current.favorite_dirs : normalizeFavoriteDirs(value.favorite_dirs);
  if (targetDir) {
    await Promise.all([
      songloft.persistentStorage.set(DOWNLOAD_TARGET_DIR_KEY, targetDir),
      songloft.persistentStorage.set(DOWNLOAD_TARGET_DIR_INPUT_KEY, input),
    ]);
  } else {
    await Promise.all([
      songloft.persistentStorage.delete(DOWNLOAD_TARGET_DIR_KEY),
      songloft.persistentStorage.delete(DOWNLOAD_TARGET_DIR_INPUT_KEY),
    ]);
  }
  await Promise.all([
    songloft.persistentStorage.set(DOWNLOAD_CREATE_ARTIST_FOLDER_KEY, createFolder),
    songloft.persistentStorage.set(DOWNLOAD_FILENAME_ORDER_KEY, order),
    songloft.persistentStorage.set(DOWNLOAD_FAVORITE_DIRS_KEY, favoriteDirs),
  ]);
  return {
    target_dir_input: input,
    target_dir: targetDir,
    create_artist_folder: createFolder,
    filename_order: order,
    path_template: buildDownloadPathTemplate(createFolder, order),
    favorite_dirs: favoriteDirs,
  };
}

export function resolveDownloadPathSettings(value: Partial<DownloadPathSettings>, defaults: DownloadPathSettings): DownloadPathSettings {
  const input = value.target_dir_input == null ? defaults.target_dir_input : normalizeTargetDirInput(value.target_dir_input);
  const targetDir = value.target_dir_input == null ? defaults.target_dir : resolveDownloadTargetDir(input);
  const createFolder = normalizeBoolean(value.create_artist_folder, defaults.create_artist_folder);
  const order = normalizeFilenameOrder(value.filename_order ?? defaults.filename_order);
  return {
    ...defaults,
    target_dir_input: input,
    target_dir: targetDir,
    create_artist_folder: createFolder,
    filename_order: order,
    path_template: buildDownloadPathTemplate(createFolder, order),
  };
}

export async function discoverMusicDirectories(): Promise<string[]> {
  const songs = await songloft.songs.list({ limit: 100000, offset: 0 });
  const found = new Set<string>();
  for (const song of songs) {
    const path = String(song.file_path || '').replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    if (slash <= DEFAULT_MUSIC_ROOT.length) continue;
    const directory = path.slice(0, slash).replace(/\/+$/, '');
    if (directory === DEFAULT_MUSIC_ROOT || directory.startsWith(`${DEFAULT_MUSIC_ROOT}/`)) {
      const relative = directory.slice(DEFAULT_MUSIC_ROOT.length) || '/';
      const parts = relative.split('/').filter(Boolean);
      for (let index = 1; index <= parts.length; index += 1) found.add(`/${parts.slice(0, index).join('/')}`);
    }
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

export async function getDownloadTargetDir(): Promise<string> {
  const value = await songloft.persistentStorage.get(DOWNLOAD_TARGET_DIR_KEY);
  return normalizeDownloadTargetDir(value);
}

export async function setDownloadTargetDir(value: unknown): Promise<string> {
  const targetDir = normalizeDownloadTargetDir(value);
  if (targetDir) await songloft.persistentStorage.set(DOWNLOAD_TARGET_DIR_KEY, targetDir);
  else await songloft.persistentStorage.delete(DOWNLOAD_TARGET_DIR_KEY);
  return targetDir;
}

export function downloadDirectoryError(error: unknown, targetDir: string): string {
  const message = String((error as Error)?.message || error || '下载失败');
  const lower = message.toLowerCase();
  if (lower.includes('target_dir must be under music_path')) {
    return `下载目录“${targetDir}”不在 Songloft 音乐目录内，请填写 music_path 下的目录：${message}`;
  }
  if (lower.includes('permission denied') || lower.includes('access is denied') || lower.includes('read-only file system')) {
    return `下载目录“${targetDir}”不可写，请检查目录权限或容器卷映射`;
  }
  if (lower.includes('mkdir')) {
    return `无法创建下载目录“${targetDir}”，请检查路径和写入权限：${message}`;
  }
  if (lower.includes('invalid target dir')) {
    return `下载目录“${targetDir}”无效：${message}`;
  }
  return message;
}
