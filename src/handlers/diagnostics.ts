import type { RuntimeManager } from '../engine/manager';
import type { SourceManager } from '../source/manager';
import type { LxSyncService } from '../lx_sync/service';
import type { DownloadManager } from '../download/manager';
import { getDownloadPathSettings, DEFAULT_MUSIC_ROOT } from '../download/settings';
import { ffprobeStatus } from './upgrade';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface DiagnosticCheck {
  id: string;
  category: 'core' | 'media' | 'integration';
  title: string;
  status: DiagnosticStatus;
  summary: string;
  detail?: string;
  suggestion?: string;
  duration_ms: number;
}

export function summarizeDiagnosticChecks(checks: DiagnosticCheck[]): { overall: DiagnosticStatus; counts: Record<DiagnosticStatus, number> } {
  const counts: Record<DiagnosticStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  checks.forEach(item => { counts[item.status] += 1; });
  const overall: DiagnosticStatus = counts.fail ? 'fail' : counts.warn ? 'warn' : 'pass';
  return { overall, counts };
}

type DiagnosticDependencies = {
  initialized: () => boolean;
  runtimeManager: RuntimeManager;
  sourceManager: SourceManager;
  lxSyncService: LxSyncService;
  downloadManager: DownloadManager;
};

function messageOf(error: unknown): string {
  return String((error as Error)?.message || error || '未知错误');
}

async function check(id: string, category: DiagnosticCheck['category'], title: string, work: () => Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>>): Promise<DiagnosticCheck> {
  const started = Date.now();
  try {
    return { id, category, title, ...(await work()), duration_ms: Date.now() - started };
  } catch (error) {
    return {
      id, category, title, status: 'fail', summary: '检测失败', detail: messageOf(error),
      suggestion: '请复制诊断报告，并结合该错误检查 Songloft 日志。', duration_ms: Date.now() - started,
    };
  }
}

async function testPersistentStorage(): Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>> {
  const key = `neo-lxbridge:diagnostic:${Date.now()}`;
  const value = `ok-${Math.random().toString(36).slice(2)}`;
  try {
    await songloft.persistentStorage.set(key, value);
    const stored = await songloft.persistentStorage.get(key);
    if (stored !== value) throw new Error('写入后读取结果不一致');
    return { status: 'pass', summary: '插件持久化存储可读写', detail: '设置和任务状态可以正常保存。' };
  } finally {
    try { await songloft.persistentStorage.delete(key); } catch { /* best effort cleanup */ }
  }
}

async function testMusicLibrary(): Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>> {
  const songs = await songloft.songs.list({ limit: 100000, offset: 0 });
  const local = songs.filter(song => song.type === 'local');
  const withPath = local.filter(song => Boolean(song.file_path));
  return {
    status: local.length ? (withPath.length ? 'pass' : 'warn') : 'warn',
    summary: local.length ? `可读取音乐库，发现 ${local.length} 首本地歌曲` : '音乐库可访问，但没有本地歌曲',
    detail: `本次读取 ${songs.length} 首记录，其中 ${withPath.length} 首具有本地文件路径。`,
    ...(local.length && !withPath.length ? { suggestion: '请在 Songloft 中重新扫描音乐目录，确保本地歌曲具有文件路径。' } : {}),
  };
}

async function testDownloadDirectory(): Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>> {
  const settings = await getDownloadPathSettings();
  const target = settings.target_dir || DEFAULT_MUSIC_ROOT;
  const script = 'set -eu; test -d "$1"; test -r "$1"; f="$1/.neo-lxbridge-diagnostic-$$"; touch "$f"; rm -f "$f"';
  const result = await songloft.command.exec('sh', ['-c', script, 'neo-lxbridge-diagnostic', target], { timeout: 10000 });
  if (result.exitCode !== 0) {
    return {
      status: 'fail', summary: '下载目录不可写', detail: `${target}：${result.stderr.trim() || `退出码 ${result.exitCode}`}`,
      suggestion: '请检查目录是否存在、容器卷映射是否正确，以及 Songloft 是否具有写入权限。',
    };
  }
  return { status: 'pass', summary: '下载目录存在且可读写', detail: target };
}

async function testProbeTool(): Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>> {
  const status = await ffprobeStatus();
  if (!status.available) return { status: 'warn', summary: 'ffprobe 当前不可用', suggestion: '可在安全洗版页面安装插件私有版 ffprobe；未知码率只能尝试估算。' };
  return {
    status: 'pass',
    summary: status.source === 'plugin' ? '插件私有 ffprobe 可用' : 'Songloft 容器 ffprobe 可用',
    detail: status.version,
  };
}

function testSources(runtimeManager: RuntimeManager, sourceManager: SourceManager): Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'> {
  const state = sourceManager.list();
  const runtimes = runtimeManager.getStatus();
  const failed = state.sources.filter(source => Boolean(source.error));
  const platforms = new Set(runtimes.flatMap(runtime => Object.keys(runtime.sources || {})));
  if (state.loading) return { status: 'info', summary: '音源仍在初始化', detail: `${runtimes.length} 个运行时已就绪，${state.batch_pending_ids.length} 个等待加载。` };
  if (!runtimes.length) return { status: 'warn', summary: '没有正在运行的音源', detail: `${state.sources.length} 个音源已导入，${failed.length} 个加载失败。`, suggestion: '请前往音源管理启用或重新导入可用音源。' };
  return {
    status: failed.length ? 'warn' : 'pass',
    summary: `${runtimes.length} 个音源运行时可用`,
    detail: `覆盖 ${Array.from(platforms).join('、') || '未知'}；${failed.length} 个音源存在加载错误。`,
    ...(failed.length ? { suggestion: '请在音源管理中查看失败音源的具体错误。' } : {}),
  };
}

async function testLxSync(service: LxSyncService): Promise<Omit<DiagnosticCheck, 'id' | 'category' | 'title' | 'duration_ms'>> {
  const config = await service.getConfig();
  if (!config.enabled) return { status: 'info', summary: '洛雪互联未开启', detail: '该功能为可选项，不影响搜索、播放和下载。' };
  return {
    status: config.serverAddress ? 'pass' : 'warn',
    summary: config.serverAddress ? '洛雪互联已开启并具有服务地址' : '洛雪互联已开启，但没有可用服务地址',
    detail: `${config.connectedCount} 台在线，${config.devices.length} 台已授权，${config.mappedPlaylists} 个映射歌单。`,
    ...(!config.serverAddress ? { suggestion: '请在洛雪互联页面填写自定义对外地址，或检查 Songloft 网络地址探测。' } : {}),
  };
}

export async function runDiagnostics(deps: DiagnosticDependencies): Promise<{ generated_at: string; overall: DiagnosticStatus; counts: Record<DiagnosticStatus, number>; checks: DiagnosticCheck[]; download_queue: ReturnType<DownloadManager['getQueueState']> }> {
  const runtimeCount = deps.runtimeManager.getStatus().length;
  const checks = await Promise.all([
    check('runtime', 'core', '插件运行状态', async () => deps.initialized()
      ? { status: 'pass', summary: 'LxBridge 已完成初始化', detail: '插件路由与后台服务可以响应请求。' }
      : { status: 'warn', summary: 'LxBridge 尚未完成初始化', suggestion: '请稍候数秒后重新检测。' }),
    check('storage', 'core', '持久化存储', testPersistentStorage),
    check('download-queue', 'core', '下载任务存储', async () => {
      const status = deps.downloadManager.getPersistenceStatus();
      const queue = deps.downloadManager.getQueueState();
      if (!status.ready) return { status: 'warn', summary: '下载任务存储尚未初始化', suggestion: '请稍候数秒后重新检测。' };
      if (status.error) return { status: 'fail', summary: '下载任务无法持久化', detail: status.error, suggestion: '请检查插件 persistent-storage 权限和 Songloft 日志。' };
      const queueDetails = [
        queue.paused ? '队列已手动暂停' : '队列可继续执行',
        queue.current_job_id ? '当前有 1 条任务正在处理' : '当前没有执行中的任务',
        `${queue.queued_ids.length} 条等待任务`,
        `${queue.source_circuits.length} 个音源处于保护暂停`,
      ].join('；');
      return {
        status: queue.source_circuits.length ? 'warn' : 'pass',
        summary: queue.source_circuits.length ? '下载任务存储可用，部分音源已触发保护' : '下载任务持久化可用',
        detail: `已保存 ${status.jobs} 条任务记录，本次启动恢复 ${status.recovered_jobs} 条中断任务；${queueDetails}。`,
        ...(queue.source_circuits.length ? { suggestion: '请在下载管理中查看被保护的音源和剩余暂停时间；其他音源仍可继续下载。' } : {}),
      };
    }),
    check('library', 'media', 'Songloft 音乐库', testMusicLibrary),
    check('directory', 'media', '下载目录', testDownloadDirectory),
    check('ffprobe', 'media', '码率探测工具', testProbeTool),
    check('sources', 'media', '洛雪音源运行时', async () => testSources(deps.runtimeManager, deps.sourceManager)),
    check('playback', 'integration', '播放兼容层', async () => runtimeCount
      ? { status: 'pass', summary: '直连与兼容代理自动切换已就绪', detail: '实际播放地址由音源解析后按设备环境自动选择。' }
      : { status: 'warn', summary: '播放兼容层可用，但没有活动音源', suggestion: '请先启用至少一个洛雪音源，再进行实际播放测试。' }),
    check('external', 'integration', '外部搜索接口', async () => runtimeCount
      ? { status: 'pass', summary: '外部接口路由已就绪', detail: '/external/search、/api/search/topone、/api/search/best' }
      : { status: 'warn', summary: '接口路由可访问，但没有活动音源', suggestion: '外部搜索需要至少一个正常运行的音源。' }),
    check('lx-sync', 'integration', '洛雪互联', async () => testLxSync(deps.lxSyncService)),
  ]);
  const { overall, counts } = summarizeDiagnosticChecks(checks);
  return { generated_at: new Date().toISOString(), overall, counts, checks, download_queue: deps.downloadManager.getQueueState() };
}
