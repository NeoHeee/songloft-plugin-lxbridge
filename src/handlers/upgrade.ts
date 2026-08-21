import type { HTTPRequest, HTTPResponse, SearchResultItem, Song } from '@songloft/plugin-sdk';
import { parseQuery } from '@songloft/plugin-sdk';
import { matchScore, searchAcross } from './search';
import { parseJSONBody } from './request';
import { errorMessage, fail, ok } from './response';

interface UpgradeMatchRequest {
  song_id?: number;
  quality?: string;
  max_duration_diff?: number;
}

interface ProbeCacheItem {
  file_path: string;
  resolved_path?: string;
  file_size?: number;
  bitrate_kbps: number;
  format: string;
  codec: string;
  sample_rate: number;
  bit_depth: number;
  duration: number;
  probed_at: string;
  source: 'ffprobe' | 'estimated';
}

interface ProbeUnknownRequest {
  limit?: number;
  concurrency?: number;
}

const PROBE_CACHE_KEY = 'upgrade_bitrate_probe_cache_v1';
const PRIVATE_FFPROBE_NAME = 'ffprobe';
const FFPROBE_RELEASE = 'b6.1.1';
const FFPROBE_URLS: Record<string, string> = {
  x64: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFPROBE_RELEASE}/ffprobe-linux-x64`,
  arm64: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFPROBE_RELEASE}/ffprobe-linux-arm64`,
};

async function loadProbeCache(): Promise<Record<string, ProbeCacheItem>> {
  const value = await songloft.storage.get(PROBE_CACHE_KEY);
  return value && typeof value === 'object' ? value as Record<string, ProbeCacheItem> : {};
}

async function saveProbeCache(cache: Record<string, ProbeCacheItem>): Promise<void> {
  await songloft.storage.set(PROBE_CACHE_KEY, cache);
}

function bitrateKbps(song: Song): number {
  const bitrate = Number(song.bit_rate || 0);
  return bitrate > 10000 ? Math.round(bitrate / 1000) : Math.round(bitrate);
}

function effectiveBitrateKbps(song: Song, cache: Record<string, ProbeCacheItem>): number {
  const stored = bitrateKbps(song);
  if (stored > 0) return stored;
  const path = String(song.file_path || '');
  const probed = path ? cache[path] : undefined;
  return probed?.file_path === path && probed.bitrate_kbps > 0 ? probed.bitrate_kbps : 0;
}

function localSongView(song: Song, cache: Record<string, ProbeCacheItem> = {}) {
  const path = String(song.file_path || '');
  const probed = path ? cache[path] : undefined;
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: Number(song.duration || 0),
    format: String(song.format || probed?.format || '').toLowerCase(),
    bit_rate: Number(song.bit_rate || 0),
    bitrate_kbps: effectiveBitrateKbps(song, cache),
    bitrate_source: bitrateKbps(song) > 0 ? 'library' : (probed?.bitrate_kbps ? (probed.source || 'ffprobe') : 'unknown'),
    file_size: Number(song.file_size || probed?.file_size || 0),
    file_path: song.file_path,
    cover_url: song.cover_url,
  };
}

function durationDifference(item: SearchResultItem, song: Song): number {
  if (!item.duration || !song.duration) return 0;
  return Math.abs(Number(item.duration) - Number(song.duration));
}

function scanStatistics(songs: Song[], cache: Record<string, ProbeCacheItem>) {
  const local = songs.filter(song => song.type === 'local');
  const localWithPath = local.filter(song => Boolean(song.file_path));
  const known = localWithPath.filter(song => effectiveBitrateKbps(song, cache) > 0);
  const fromProbe = localWithPath.filter(song => bitrateKbps(song) <= 0 && effectiveBitrateKbps(song, cache) > 0);
  const estimated = fromProbe.filter(song => cache[String(song.file_path || '')]?.source === 'estimated');
  const formats: Record<string, number> = {};
  for (const song of localWithPath) {
    const format = String(song.format || '未知').trim().toUpperCase() || '未知';
    formats[format] = (formats[format] || 0) + 1;
  }
  return {
    library_total: songs.length,
    local_total: local.length,
    remote_total: songs.length - local.length,
    local_with_path: localWithPath.length,
    bitrate_known: known.length,
    bitrate_unknown: localWithPath.length - known.length,
    bitrate_from_probe: fromProbe.length,
    bitrate_estimated: estimated.length,
    ranges: {
      below_192: known.filter(song => effectiveBitrateKbps(song, cache) < 192).length,
      from_192_to_319: known.filter(song => effectiveBitrateKbps(song, cache) >= 192 && effectiveBitrateKbps(song, cache) < 320).length,
      from_320_to_499: known.filter(song => effectiveBitrateKbps(song, cache) >= 320 && effectiveBitrateKbps(song, cache) < 500).length,
      at_least_500: known.filter(song => effectiveBitrateKbps(song, cache) >= 500).length,
    },
    formats: Object.entries(formats).sort((a, b) => b[1] - a[1]).map(([format, count]) => ({ format, count })),
  };
}

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildAudioPathCandidates(value: unknown): string[] {
  let storedPath = String(value || '').replace(/\\/g, '/').trim();
  try { storedPath = decodeURIComponent(storedPath); } catch { /* keep the stored path */ }
  storedPath = storedPath.replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  const candidates: string[] = [];
  const add = (path: string) => { if (path && !candidates.includes(path)) candidates.push(path); };

  if (/^\/app\/music\//i.test(storedPath)) {
    const relative = storedPath.slice('/app/music/'.length);
    add(storedPath);
    add(`/music/${relative}`);
    if (/^music\//i.test(relative)) add(`/app/music/${relative.slice('music/'.length)}`);
  } else if (/^\/music\//i.test(storedPath)) {
    const relative = storedPath.slice('/music/'.length);
    add(`/app/music/${relative}`);
    add(storedPath);
  } else if (/^music\//i.test(storedPath)) {
    const relative = storedPath.slice('music/'.length);
    add(`/app/music/${relative}`);
    add(`/music/${relative}`);
  } else if (/^app\/music\//i.test(storedPath)) {
    add(`/${storedPath}`);
  } else if (storedPath && !storedPath.startsWith('/')) {
    add(`/app/music/${storedPath}`);
  }
  add(storedPath);
  return candidates;
}

async function statFileSize(path: string): Promise<number> {
  try {
    const result = await songloft.command.exec('stat', ['-c', '%s', path], { timeout: 5000 });
    return result.exitCode === 0 ? parsePositiveNumber(result.stdout.trim()) : 0;
  } catch { return 0; }
}

function pathSuffixScore(reference: string, candidate: string): number {
  const left = reference.toLowerCase().split('/').filter(Boolean).reverse();
  const right = candidate.toLowerCase().split('/').filter(Boolean).reverse();
  let score = 0;
  while (score < left.length && score < right.length && left[score] === right[score]) score += 1;
  return score;
}

async function discoverAudioPaths(storedPath: string): Promise<string[]> {
  const filename = storedPath.replace(/\\/g, '/').split('/').pop()?.trim();
  if (!filename) return [];
  const found: string[] = [];
  for (const root of ['/app/music', '/music']) {
    try {
      const result = await songloft.command.exec('find', [root, '-type', 'f', '-name', filename, '-print'], { timeout: 12000 });
      if (result.exitCode !== 0) continue;
      result.stdout.split(/\r?\n/).map(path => path.trim()).filter(Boolean).forEach(path => {
        if (!found.includes(path)) found.push(path);
      });
    } catch { /* try the next music root */ }
  }
  return found.sort((a, b) => pathSuffixScore(storedPath, b) - pathSuffixScore(storedPath, a)).slice(0, 8);
}

async function existingAudioPathCandidates(storedPath: string): Promise<Array<{ path: string; size: number }>> {
  const candidates = buildAudioPathCandidates(storedPath);
  const existing: Array<{ path: string; size: number }> = [];
  for (const path of candidates) {
    const size = await statFileSize(path);
    if (size > 0) existing.push({ path, size });
  }
  if (existing.length) return existing;
  for (const path of await discoverAudioPaths(storedPath)) {
    const size = await statFileSize(path);
    if (size > 0) existing.push({ path, size });
  }
  return existing;
}

async function probeSong(song: Song): Promise<ProbeCacheItem> {
  const originalPath = String(song.file_path || '');
  const existing = await existingAudioPathCandidates(originalPath);
  const candidates = existing.length ? existing.map(item => item.path) : buildAudioPathCandidates(originalPath);

  const errors: string[] = [];
  for (const probePath of candidates) {
    try {
      const result = await songloft.command.exec('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=bit_rate,codec_name,sample_rate,bits_per_raw_sample,bits_per_sample:format=bit_rate,format_name,duration,size',
        '-of', 'json', probePath,
      ], { timeout: 15000 });
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `退出码 ${result.exitCode}`);
      const parsed = JSON.parse(result.stdout || '{}') as {
        streams?: Array<Record<string, unknown>>;
        format?: Record<string, unknown>;
      };
      const stream = parsed.streams?.[0] || {};
      const format = parsed.format || {};
      const duration = parsePositiveNumber(format.duration) || parsePositiveNumber(song.duration);
      const fileSize = parsePositiveNumber(format.size)
        || existing.find(item => item.path === probePath)?.size
        || parsePositiveNumber(song.file_size);
      const directBitrate = parsePositiveNumber(stream.bit_rate) || parsePositiveNumber(format.bit_rate);
      const bitrate = directBitrate || (fileSize && duration ? (fileSize * 8) / duration : 0);
      if (!bitrate) throw new Error('音频文件未提供可识别的码率');
      const bitDepth = parsePositiveNumber(stream.bits_per_raw_sample) || parsePositiveNumber(stream.bits_per_sample);
      return {
        file_path: originalPath,
        resolved_path: probePath,
        file_size: fileSize,
        bitrate_kbps: Math.round(bitrate / 1000),
        format: String(format.format_name || song.format || '').split(',')[0].toLowerCase(),
        codec: String(stream.codec_name || ''),
        sample_rate: parsePositiveNumber(stream.sample_rate),
        bit_depth: bitDepth,
        duration,
        probed_at: new Date().toISOString(),
        source: directBitrate ? 'ffprobe' : 'estimated',
      };
    } catch (error) {
      errors.push(`${probePath}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`所有候选路径均探测失败：${errors.join('；')}`);
}

function estimateSongBitrate(song: Song): ProbeCacheItem | null {
  const fileSize = parsePositiveNumber(song.file_size);
  const duration = parsePositiveNumber(song.duration);
  if (!fileSize || !duration) return null;
  const bitrate = Math.round((fileSize * 8) / duration / 1000);
  if (bitrate <= 0) return null;
  return {
    file_path: String(song.file_path || ''),
    file_size: fileSize,
    bitrate_kbps: bitrate,
    format: String(song.format || '').toLowerCase(),
    codec: '', sample_rate: 0, bit_depth: 0, duration,
    probed_at: new Date().toISOString(),
    source: 'estimated',
  };
}

async function probeSongWithFallback(song: Song): Promise<ProbeCacheItem> {
  try {
    return await probeSong(song);
  } catch (error) {
    const estimated = estimateSongBitrate(song);
    if (estimated) return estimated;
    const resolved = (await existingAudioPathCandidates(String(song.file_path || '')))[0];
    if (resolved) {
      const fromFile = estimateSongBitrate({ ...song, file_size: resolved.size } as Song);
      if (fromFile) return { ...fromFile, resolved_path: resolved.path, file_size: resolved.size };
    }
    throw new Error(`${errorMessage(error)}；未能从音乐目录找到可读取文件或有效文件大小`);
  }
}

async function ffprobeVersion(program = PRIVATE_FFPROBE_NAME): Promise<string> {
  const result = await songloft.command.exec(program, ['-version'], { timeout: 10000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `ffprobe 退出码 ${result.exitCode}`);
  return result.stdout.split(/\r?\n/)[0].trim();
}

async function systemFfprobeVersion(): Promise<string> {
  for (const path of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/bin/ffprobe']) {
    try { return await ffprobeVersion(path); } catch { /* try the next common system path */ }
  }
  return '';
}

async function runtimeArchitecture(): Promise<'x64' | 'arm64'> {
  const result = await songloft.command.exec('uname', ['-m'], { timeout: 5000 });
  const value = result.stdout.trim().toLowerCase();
  if (result.exitCode === 0 && /^(x86_64|amd64)$/.test(value)) return 'x64';
  if (result.exitCode === 0 && /^(aarch64|arm64)$/.test(value)) return 'arm64';
  throw new Error(`暂不支持当前容器架构：${value || '无法识别'}`);
}

async function installPrivateFfprobe(): Promise<{ source: 'plugin'; version: string; architecture: string }> {
  const architecture = await runtimeArchitecture();
  try {
    await songloft.command.download(FFPROBE_URLS[architecture], PRIVATE_FFPROBE_NAME);
    const version = await ffprobeVersion();
    return { source: 'plugin', version, architecture };
  } catch (error) {
    try { await songloft.command.deleteBin(PRIVATE_FFPROBE_NAME); } catch { /* ignore cleanup failure */ }
    throw new Error(`插件私有 ffprobe 安装失败：${errorMessage(error)}`);
  }
}

async function ffprobeStatus(): Promise<{ available: boolean; source: 'system' | 'plugin' | 'none'; version: string; architecture: string; system_available: boolean; system_version: string }> {
  const privateInstalled = await songloft.command.exists(PRIVATE_FFPROBE_NAME);
  const systemVersion = await systemFfprobeVersion();
  try {
    const version = await ffprobeVersion();
    return { available: true, source: privateInstalled ? 'plugin' : 'system', version, architecture: '', system_available: Boolean(systemVersion || !privateInstalled), system_version: systemVersion || (!privateInstalled ? version : '') };
  } catch {
    return { available: Boolean(systemVersion), source: systemVersion ? 'system' : 'none', version: systemVersion, architecture: '', system_available: Boolean(systemVersion), system_version: systemVersion };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }));
  return results;
}

export function upgradeHandlers(): {
  scan: (req: HTTPRequest) => Promise<HTTPResponse>;
  match: (req: HTTPRequest) => Promise<HTTPResponse>;
  probeUnknown: (req: HTTPRequest) => Promise<HTTPResponse>;
  probeToolStatus: () => Promise<HTTPResponse>;
  installProbeTool: () => Promise<HTTPResponse>;
  removeProbeTool: () => Promise<HTTPResponse>;
} {
  return {
    scan: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const query = parseQuery(req.query || '');
        const maxBitrate = Math.max(64, Math.min(2000, Number(query.max_bitrate || 320)));
        const limit = Math.max(1, Math.min(1000, Number(query.limit || 300)));
        const songs = await songloft.songs.list({ limit: 100000, offset: 0 });
        const cache = await loadProbeCache();
        const local = songs
          .filter(song => song.type === 'local' && Boolean(song.file_path))
          .filter(song => {
            const bitrate = effectiveBitrateKbps(song, cache);
            return bitrate > 0 && bitrate < maxBitrate;
          })
          .sort((a, b) => effectiveBitrateKbps(a, cache) - effectiveBitrateKbps(b, cache))
          .slice(0, limit)
          .map(song => localSongView(song, cache));
        const unknownSongs = songs
          .filter(song => song.type === 'local' && Boolean(song.file_path) && effectiveBitrateKbps(song, cache) <= 0)
          .slice(0, 500)
          .map(song => localSongView(song, cache));
        return ok({ songs: local, unknown_songs: unknownSongs, count: local.length, max_bitrate: maxBitrate, scanned: songs.length, statistics: scanStatistics(songs, cache) });
      } catch (error) {
        return fail(errorMessage(error), 500);
      }
    },

    probeUnknown: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<ProbeUnknownRequest>(req);
        const limit = Math.max(1, Math.min(500, Number(body.limit || 50)));
        const concurrency = Math.max(1, Math.min(4, Number(body.concurrency || 2)));
        const songs = await songloft.songs.list({ limit: 100000, offset: 0 });
        const cache = await loadProbeCache();
        const unknown = songs.filter(song => song.type === 'local' && Boolean(song.file_path) && effectiveBitrateKbps(song, cache) <= 0);
        const batch = unknown.slice(0, limit);
        let tool = await ffprobeStatus();
        let installError = '';
        if (!tool.available && batch.length) {
          try {
            await installPrivateFfprobe();
            tool = await ffprobeStatus();
          } catch (error) {
            installError = errorMessage(error);
          }
        }
        const results = tool.available
          ? await mapWithConcurrency(batch, concurrency, probeSongWithFallback)
          : batch.map(song => {
            const estimated = estimateSongBitrate(song);
            return estimated
              ? { status: 'fulfilled', value: estimated } as PromiseFulfilledResult<ProbeCacheItem>
              : { status: 'rejected', reason: new Error(installError || 'ffprobe 不可用，且歌曲缺少文件大小或时长，无法估算') } as PromiseRejectedResult;
          });
        const failures: Array<{ id: number; title: string; file_path: string; error: string }> = [];
        let succeeded = 0;
        let exact = 0;
        let estimated = 0;
        results.forEach((result, index) => {
          const song = batch[index];
          if (result.status === 'fulfilled') {
            cache[String(song.file_path)] = result.value;
            succeeded += 1;
            if (result.value.source === 'estimated') estimated += 1;
            else exact += 1;
          } else {
            failures.push({ id: song.id, title: song.title, file_path: String(song.file_path || ''), error: errorMessage(result.reason) });
          }
        });
        if (succeeded) await saveProbeCache(cache);
        const remaining = unknown.filter(song => effectiveBitrateKbps(song, cache) <= 0).length;
        return ok({ processed: batch.length, succeeded, exact, estimated, failed: failures.length, remaining, batch_limit: limit, concurrency, tool, install_error: installError, failures: failures.slice(0, 10) });
      } catch (error) {
        const message = errorMessage(error);
        const hint = /ffprobe|not found|ENOENT|permission/i.test(message)
          ? '无法运行 ffprobe。请确认 Songloft 容器已安装 ffmpeg/ffprobe，并允许插件执行外部命令。'
          : message;
        return fail(hint, 500);
      }
    },

    probeToolStatus: async (): Promise<HTTPResponse> => {
      try { return ok(await ffprobeStatus()); } catch (error) { return fail(errorMessage(error), 500); }
    },

    installProbeTool: async (): Promise<HTTPResponse> => {
      try { return ok(await installPrivateFfprobe()); } catch (error) { return fail(errorMessage(error), 500); }
    },

    removeProbeTool: async (): Promise<HTTPResponse> => {
      try {
        await songloft.command.deleteBin(PRIVATE_FFPROBE_NAME);
        return ok(await ffprobeStatus());
      } catch (error) { return fail(errorMessage(error), 500); }
    },

    match: async (req: HTTPRequest): Promise<HTTPResponse> => {
      try {
        const body = parseJSONBody<UpgradeMatchRequest>(req);
        const songId = Number(body.song_id || 0);
        if (!songId) throw new Error('缺少本地歌曲 ID');
        const song = await songloft.songs.getById(songId);
        if (!song || song.type !== 'local') throw new Error('本地歌曲不存在或已被修改');
        const quality = String(body.quality || 'flac');
        const maxDurationDiff = Math.max(0, Math.min(30, Number(body.max_duration_diff ?? 3)));
        const candidates = await searchAcross(`${song.title} ${song.artist}`.trim(), 1, 12, quality);
        const minimumScore = song.artist ? 130 : 90;
        const matched = candidates
          .map(item => ({
            item,
            score: matchScore(item, song.title, song.artist, song.duration),
            duration_diff: durationDifference(item, song),
          }))
          .filter(candidate => candidate.score >= minimumScore)
          .filter(candidate => !song.duration || (candidate.item.duration > 0 && candidate.duration_diff <= maxDurationDiff))
          .sort((a, b) => b.score - a.score || a.duration_diff - b.duration_diff)
          .slice(0, 5)
          .map(candidate => ({
            ...candidate.item,
            match_score: candidate.score,
            duration_diff: candidate.duration_diff,
          }));
        return ok({ song: localSongView(song), candidates: matched, quality, max_duration_diff: maxDurationDiff });
      } catch (error) {
        return fail(errorMessage(error), 400);
      }
    },
  };
}
