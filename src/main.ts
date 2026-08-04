/// <reference types="@songloft/plugin-sdk" />
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
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
import { getDownloadTargetDir, getRequestProtectionSettings, setDownloadTargetDir, setRequestProtectionSettings } from './download/settings';
import { parseJSONBody } from './handlers/request';

const router = createRouter();
const runtimeManager = new RuntimeManager();
const sourceManager = new SourceManager(runtimeManager);
const sourceApi = sourceHandlers(sourceManager);
const directApi = directHandlers(runtimeManager);
const downloadManager = new DownloadManager();
const downloadApi = downloadHandlers(downloadManager);
let initialized = false;

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

router.post('/api/search', createSearchRoute());
router.post('/api/music/url', createMusicUrlRoute(runtimeManager));
router.post('/api/songs/import', importSongsHandler);
router.post('/api/songs/download', downloadApi.create);
router.get('/api/songs/download', downloadApi.status);
router.post('/api/songs/download/retry', downloadApi.retry);
router.delete('/api/songs/download', downloadApi.remove);
router.get('/api/settings/download', async () => jsonResponse({
  code: 0,
  msg: 'success',
  data: { target_dir: await getDownloadTargetDir(), ...(await getRequestProtectionSettings()) },
}));
router.put('/api/settings/download', async (req) => {
  try {
    const body = parseJSONBody<{ target_dir?: string; enabled?: boolean; download_interval_ms?: number; playback_interval_ms?: number }>(req);
    const targetDir = await setDownloadTargetDir(body.target_dir || '');
    const protection = await setRequestProtectionSettings(body);
    return jsonResponse({ code: 0, msg: 'success', data: { target_dir: targetDir, ...protection } });
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
router.get('/api/leaderboard/:action', async (req, params) => await leaderboardHandler(req, params.action));
router.post('/api/direct/music/url', directApi.musicUrl);
router.post('/api/direct/music/probe', directApi.musicProbe);
router.get('/api/direct/lyric', directApi.lyric);
router.post('/api/search/topone', directApi.topone);

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

async function onInit(): Promise<void> {
  songloft.log.info('[neo-lxbridge] initializing');
  await sourceManager.init();
  initialized = true;
  songloft.log.info(`[neo-lxbridge] initialized, ${runtimeManager.getStatus().length} source runtime(s) active`);
}

async function onDeinit(): Promise<void> {
  initialized = false;
  await runtimeManager.destroyAll();
  songloft.log.info('[neo-lxbridge] deinitialized');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  try {
    const response = await router.handle(normalizeRequest(req));
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

(globalThis as unknown as { onInit: typeof onInit }).onInit = onInit;
(globalThis as unknown as { onDeinit: typeof onDeinit }).onDeinit = onDeinit;
(globalThis as unknown as { onHTTPRequest: typeof onHTTPRequest }).onHTTPRequest = onHTTPRequest;
