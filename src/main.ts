/// <reference types="@songloft/plugin-sdk" />
import type { HTTPRequest, HTTPResponse, InboundWebSocket, WebSocketRequest } from '@songloft/plugin-sdk';
import { createRouter, jsonResponse } from '@songloft/plugin-sdk';
import { RuntimeManager } from './engine/manager';
import { SourceManager } from './source/manager';
import { createExternalSearchRoute, createMusicUrlRoute, createSearchRoute } from './handlers/search';
import { sourceHandlers } from './handlers/source';
import { songListHandler, leaderboardHandler } from './handlers/browse';
import { directHandlers } from './handlers/direct';
import { importSongsHandler } from './handlers/importSongs';
import { downloadHandlers } from './handlers/download';
import { DownloadManager } from './download/manager';
import { musicSdk, sources } from './musicSdk/facade';
import { discoverMusicDirectories, getDownloadPathSettings, getRequestProtectionSettings, setDownloadPathSettings, setRequestProtectionSettings } from './download/settings';
import { parseJSONBody } from './handlers/request';
import { upgradeHandlers } from './handlers/upgrade';
import { getPlaybackSettings, setPlaybackSettings } from './playback/settings';
import { handleLxProtocolHttp } from './lx_sync/protocol_http';
import { handleLxSyncWebSocket } from './lx_sync/protocol_ws';
import { LxSyncService } from './lx_sync/service';
import { addSearchHistory, clearSearchHistory, getHotSearches, getSearchHistory, removeSearchHistory } from './search/discovery';
import { loadSharedPlaylist } from './songlist/shared';
import { runDiagnostics } from './handlers/diagnostics';

const router = createRouter();
const runtimeManager = new RuntimeManager();
const sourceManager = new SourceManager(runtimeManager);
const sourceApi = sourceHandlers(sourceManager);
const directApi = directHandlers(runtimeManager);
const downloadManager = new DownloadManager();
const downloadApi = downloadHandlers(downloadManager, runtimeManager);
const upgradeApi = upgradeHandlers();
const lxSyncService = new LxSyncService();
let initialized = false;
let miotRegistrationTimer: ReturnType<typeof setTimeout> | null = null;

function registerToMiot(): void {
  let attempts = 0;
  const tryRegister = async (): Promise<void> => {
    attempts += 1;
    try {
      if (!songloft.comm || typeof songloft.comm.call !== 'function') return;
      await songloft.comm.call('miot', 'register-search-provider', {
        name: 'Songloft LxBridge',
        searchPath: '/api/search/topone',
        icon: '',
      });
      songloft.log.info('[neo-lxbridge] registered as MIoT search provider');
    } catch (error) {
      if (attempts < 5 && initialized) {
        miotRegistrationTimer = setTimeout(tryRegister, 3000);
      } else {
        songloft.log.warn(`[neo-lxbridge] MIoT search provider registration skipped: ${String(error)}`);
      }
    }
  };
  miotRegistrationTimer = setTimeout(tryRegister, 2000);
}

router.get('/', async (req) => ({
  statusCode: 302,
  headers: {
    Location: `/api/v1/jsplugin/neo-lxbridge/static/index.html${req.query ? `?${req.query}` : ''}`,
  },
  body: '',
}));

router.get('/api/status', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: {
    initialized,
    metadata_sources: sources,
    runtime_sources: runtimeManager.getStatus(),
    source_state: sourceManager.list(),
  },
}));

router.post('/api/diagnostics/run', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: await runDiagnostics({ initialized: () => initialized, runtimeManager, sourceManager, lxSyncService, downloadManager }),
}));

router.post('/api/search', createSearchRoute());
router.get('/api/search/discovery', async () => {
  const [hot, history] = await Promise.all([getHotSearches(), getSearchHistory()]);
  return jsonResponse({ code: 0, msg: 'success', data: { hot: hot.keywords, hot_source: hot.source, hot_cached: hot.cached, history } });
});
router.post('/api/search/history', async (req) => {
  try {
    const body = parseJSONBody<{ keyword?: string }>(req);
    return jsonResponse({ code: 0, msg: 'success', data: { history: await addSearchHistory(body.keyword) } });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.delete('/api/search/history', async (req) => {
  try {
    const query = new URLSearchParams(req.query || '');
    const history = query.get('all') === 'true'
      ? await clearSearchHistory()
      : await removeSearchHistory(query.get('keyword'));
    return jsonResponse({ code: 0, msg: 'success', data: { history } });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.post('/api/music/url', createMusicUrlRoute(runtimeManager));
router.post('/api/songs/import', importSongsHandler);
router.post('/api/songs/download', downloadApi.create);
router.post('/api/songs/download/batch', downloadApi.createBatch);
router.get('/api/songs/download', downloadApi.status);
router.post('/api/songs/download/retry', downloadApi.retry);
router.delete('/api/songs/download', downloadApi.remove);
router.post('/api/songs/download/queue', downloadApi.queue);
router.get('/api/upgrade/scan', upgradeApi.scan);
router.post('/api/upgrade/probe-unknown', upgradeApi.probeUnknown);
router.get('/api/upgrade/probe-tool', upgradeApi.probeToolStatus);
router.post('/api/upgrade/probe-tool/install', upgradeApi.installProbeTool);
router.delete('/api/upgrade/probe-tool', upgradeApi.removeProbeTool);
router.post('/api/upgrade/match', upgradeApi.match);
router.get('/api/settings/download/directories', async () => {
  try {
    const settings = await getDownloadPathSettings();
    return jsonResponse({ code: 0, msg: 'success', data: { favorites: settings.favorite_dirs, discovered: await discoverMusicDirectories() } });
  } catch (error) {
    return jsonResponse({ code: 500, msg: String((error as Error)?.message || error), data: null }, 500);
  }
});
router.get('/api/settings/download', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: { ...(await getDownloadPathSettings()), ...(await getRequestProtectionSettings()) },
}));
router.put('/api/settings/download', async (req) => {
  try {
    const body = parseJSONBody<{ target_dir?: string; target_dir_input?: string; create_artist_folder?: boolean; filename_order?: 'title_artist' | 'artist_title'; favorite_dirs?: string[]; enabled?: boolean; download_interval_ms?: number; playback_interval_ms?: number }>(req);
    const pathSettings = await setDownloadPathSettings({
      target_dir_input: body.target_dir_input ?? body.target_dir,
      create_artist_folder: body.create_artist_folder,
      filename_order: body.filename_order,
      favorite_dirs: body.favorite_dirs,
    });
    const protection = await setRequestProtectionSettings(body);
    return jsonResponse({ code: 0, msg: 'success', data: { ...pathSettings, ...protection } });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.get('/api/settings/playback', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: await getPlaybackSettings(),
}));
router.put('/api/settings/playback', async (req) => {
  try {
    const body = parseJSONBody<{ default_quality?: string; allow_auto_downgrade?: boolean; show_compatibility_notice?: boolean }>(req);
    return jsonResponse({ code: 0, msg: 'success', data: await setPlaybackSettings(body) });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.get('/api/settings/lx-sync', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: await lxSyncService.getConfig(),
}));
router.put('/api/settings/lx-sync', async (req) => {
  try {
    const body = parseJSONBody<{ enabled?: boolean; serverName?: string; password?: string; regeneratePassword?: boolean; customServerAddress?: string }>(req);
    return jsonResponse({ code: 0, msg: 'success', data: await lxSyncService.updateConfig(body) });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.get('/api/playlists', async () => {
  const playlists = await songloft.playlists.list();
  return jsonResponse({ code: 0, msg: 'success', data: { playlists } });
});
router.post('/external/search', createExternalSearchRoute(runtimeManager));

router.get('/api/sources', sourceApi.list);
router.get('/api/sources/export', sourceApi.exportFile);
router.post('/api/sources/import', sourceApi.importFile);
router.post('/api/sources/import-url', sourceApi.importUrl);
router.delete('/api/sources', sourceApi.remove);
router.put('/api/sources/toggle', sourceApi.toggle);

router.get('/api/songlist/:action', async (req, params) => await songListHandler(req, params.action));
router.post('/api/songlist/shared', async (req) => {
  try {
    const body = parseJSONBody<{ url?: string }>(req);
    return jsonResponse({ code: 0, msg: 'success', data: await loadSharedPlaylist(body.url) });
  } catch (error) {
    return jsonResponse({ code: 400, msg: String((error as Error)?.message || error), data: null }, 400);
  }
});
router.get('/api/leaderboard/:action', async (req, params) => await leaderboardHandler(req, params.action));
router.post('/api/direct/music/url', directApi.musicUrl);
router.post('/api/direct/music/probe', directApi.musicProbe);
router.get('/api/direct/lyric', directApi.lyric);
router.post('/api/search/topone', directApi.topone);
router.post('/api/search/best', directApi.best);

// 便于外部插件查询当前支持的平台，不经过 UI 响应封装。
router.get('/api/platforms', async () => jsonResponse({ sources, capabilities: Object.fromEntries(sources.map(item => [item.id, {
  search: Boolean(musicSdk[item.id].musicSearch),
  lyric: Boolean(musicSdk[item.id].getLyric),
  songList: Boolean(musicSdk[item.id].songList),
  leaderboard: Boolean(musicSdk[item.id].leaderboard),
}])) }));

function normalizeRequest(req: HTTPRequest): HTTPRequest {
  const prefix = '/api/v1/jsplugin/neo-lxbridge';
  if (req.path === prefix) return { ...req, path: '/' };
  if (req.path.startsWith(`${prefix}/`)) return { ...req, path: req.path.slice(prefix.length) || '/' };
  return req;
}

function formatSyncAddresses(hostUrl: string, networkAddresses: string[]): string[] {
  const prefix = '/api/v1/jsplugin/neo-lxbridge';
  try {
    const host = new URL(hostUrl);
    const port = host.port ? `:${host.port}` : '';
    const addresses: string[] = [];
    for (const address of networkAddresses) {
      const value = String(address || '').trim();
      if (!value) continue;
      try {
        // Newer Songloft versions may return a complete reachable URL,
        // including protocol and port. Do not add them a second time.
        const networkUrl = new URL(value);
        addresses.push(`${networkUrl.origin}${prefix}`);
        continue;
      } catch { /* plain IP or host:port */ }
      const hasPort = /^\[[^\]]+\]:\d+$/.test(value) || /^[^:]+:\d+$/.test(value);
      addresses.push(`${host.protocol}//${value}${hasPort ? '' : port}${prefix}`);
    }
    // Keep the LAN address first so the value copied on a phone is reachable;
    // localhost remains available for a client running on the Songloft host.
    addresses.push(`${host.origin}${prefix}`);
    return Array.from(new Set(addresses));
  } catch {
    return hostUrl ? [`${hostUrl.replace(/\/$/, '')}${prefix}`] : [];
  }
}

async function onInit(): Promise<void> {
  songloft.log.info('[neo-lxbridge] initializing');
  try {
    const [hostUrl, networkAddresses] = await Promise.all([
      songloft.plugin.getHostUrl(),
      songloft.plugin.getNetworkAddresses(),
    ]);
    lxSyncService.setServerAddresses(formatSyncAddresses(hostUrl, networkAddresses));
  } catch (error) {
    songloft.log.warn(`[neo-lxbridge] LX sync address discovery failed: ${String(error)}`);
  }
  await downloadManager.init();
  await sourceManager.init();
  initialized = true;
  registerToMiot();
  songloft.log.info(`[neo-lxbridge] initialized, ${runtimeManager.getStatus().length} source runtime(s) active`);
}

async function onDeinit(): Promise<void> {
  initialized = false;
  if (miotRegistrationTimer) {
    clearTimeout(miotRegistrationTimer);
    miotRegistrationTimer = null;
  }
  try {
    if (songloft.comm && typeof songloft.comm.call === 'function') {
      await songloft.comm.call('miot', 'unregister-search-provider', {}, 2000);
    }
  } catch { /* MIoT may be absent or already stopped. */ }
  lxSyncService.dropAllConnections();
  await downloadManager.flush();
  await runtimeManager.destroyAll();
  songloft.log.info('[neo-lxbridge] deinitialized');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  try {
    const normalized = normalizeRequest(req);
    const protocolResponse = await handleLxProtocolHttp(normalized, lxSyncService);
    const response = protocolResponse || await router.handle(normalized);
    if (!response || typeof response !== 'object') {
      return jsonResponse({ code: 500, msg: 'handler returned an invalid response', data: null }, 500);
    }
    return {
      statusCode: response.statusCode ?? 200,
      headers: response.headers ?? { 'Content-Type': 'application/json' },
      body: response.body ?? '',
    };
  } catch (error) {
    const message = String((error as Error)?.message || error || 'unknown error');
    songloft.log.error(`[neo-lxbridge] HTTP error: ${message}`);
    return jsonResponse({ code: 500, msg: message, data: null }, 500);
  }
}

async function onWebSocket(req: WebSocketRequest, socket: InboundWebSocket): Promise<void> {
  const normalizedPath = normalizeRequest({
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: null,
  }).path;
  await handleLxSyncWebSocket(
    { ...req, path: normalizedPath },
    socket,
    lxSyncService,
  );
}

(globalThis as unknown as { onInit: typeof onInit }).onInit = onInit;
(globalThis as unknown as { onDeinit: typeof onDeinit }).onDeinit = onDeinit;
(globalThis as unknown as { onHTTPRequest: typeof onHTTPRequest }).onHTTPRequest = onHTTPRequest;
(globalThis as unknown as { onWebSocket: typeof onWebSocket }).onWebSocket = onWebSocket;
