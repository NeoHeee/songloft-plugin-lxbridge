export const DOWNLOAD_TARGET_DIR_KEY = 'download_target_dir';

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
