export const DOWNLOAD_TARGET_DIR_KEY = 'download_target_dir';
export const DOWNLOAD_PROTECTION_ENABLED_KEY = 'download_protection_enabled';
export const DOWNLOAD_INTERVAL_MS_KEY = 'download_interval_ms';
export const PLAYBACK_INTERVAL_MS_KEY = 'playback_interval_ms';

export const DEFAULT_DOWNLOAD_INTERVAL_MS = 5000;
export const DEFAULT_PLAYBACK_INTERVAL_MS = 2000;

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
