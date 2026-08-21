(() => {
  const root = window.__LX_PLUGIN_ROOT__ || (() => {
    const path = location.pathname;
    const staticIndex = path.search(/\/static(?:\/|$)/);
    return staticIndex >= 0
      ? path.slice(0, staticIndex).replace(/\/$/, '')
      : path.replace(/\/(?:index\.html)?$/, '').replace(/\/$/, '');
  })();

  const state = {
    selected: [],
    results: [],
    pollTimer: 0,
    statusPollTimer: 0,
    playingKey: '',
    playingItem: null,
    playlists: [],
    playlistsLoaded: false,
    importItem: null,
    downloadJobs: {},
    downloadPollers: {},
    downloadTaskList: [],
    downloadManagerTimer: 0,
    downloadSettings: {
      target_dir_input: '', target_dir: '', create_artist_folder: false,
      filename_order: 'title_artist', favorite_dirs: [],
    },
    playbackSettings: {
      default_quality: '320k', allow_auto_downgrade: true, show_compatibility_notice: true, configured: false,
    },
    compatibilityNoticeShown: false,
    lxSyncSettings: null,
    discoveredDownloadDirs: [],
    downloadModalResolve: null,
    upgradeSongs: [],
    upgradeScanned: false,
    upgradeUnknownSongs: [],
    upgradeUnknownTotal: 0,
    upgradeUnknownExpanded: true,
    upgradeCandidates: {},
    upgradeSelected: new Set(),
    upgradeSearch: '',
    qualityByPlatform: {},
    legacyQualityPlatforms: new Set(),
    browseMode: 'rank',
    browsePlatform: 'wy',
    browseCatalog: [],
    browseSongs: [],
    browseTitle: '',
    sharedPlaylistSongs: [],
    sharedPlaylistSource: '',
    sharedPlaylistTitle: '',
    sharedPlaylistTotal: 0,
    hotSearches: [],
    hotSearchSource: '',
    searchHistory: [],
    searchDiscoveryExpanded: true,
  };

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  const platformNames = { kw: '酷我', kg: '酷狗', tx: 'QQ 音乐', wy: '网易云', mg: '咪咕' };
  const qualityCatalog = [
    { value: '128k', label: '标准 · 128K', common: true },
    { value: '320k', label: '高品质 · 320K', common: true },
    { value: 'flac', label: '无损 · FLAC', common: true },
    { value: 'flac24bit', label: 'FLAC 24-Bit', common: true },
    { value: 'hires', label: 'Hi-Res 无损' },
    { value: 'atmos', label: '沉浸声 · Atmos' },
    { value: 'atmos_plus', label: '臻品音质 · Atmos Plus' },
    { value: 'master', label: '臻品母带' },
  ];
  const qualityAliases = { '24bit': 'flac24bit', '24-bit': 'flac24bit', lossless: 'flac', high: '320k', standard: '128k' };
  const normalizeQuality = value => qualityAliases[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase();
  const musicPlaceholder = '<span class="cover-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6.8l9-1.8v10.2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="15.5" cy="15.2" r="2.5"/></svg></span>';

  function defaultQuality() {
    return normalizeQuality(state.playbackSettings.default_quality) || '320k';
  }

  function allowAutoDowngrade() {
    return state.playbackSettings.allow_auto_downgrade !== false;
  }

  function showCompatibilityNotice() {
    return state.playbackSettings.show_compatibility_notice !== false;
  }

  function setTheme(mode) {
    const normalized = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';
    localStorage.setItem('neo-lxbridge:theme', normalized);
    document.documentElement.dataset.themeMode = normalized;
    if (normalized === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = normalized;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const dark = normalized === 'dark' || (normalized === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      meta.content = dark ? '#101117' : '#f5f6fb';
    }
  }

  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });
  setTheme(localStorage.getItem('neo-lxbridge:theme') || localStorage.getItem('lxbridge:theme') || localStorage.getItem('lxmusic:theme') || 'system');
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  const onSchemeChange = () => {
    if ((localStorage.getItem('neo-lxbridge:theme') || localStorage.getItem('lxbridge:theme') || localStorage.getItem('lxmusic:theme') || 'system') === 'system') setTheme('system');
  };
  if (colorScheme.addEventListener) colorScheme.addEventListener('change', onSchemeChange);
  else if (colorScheme.addListener) colorScheme.addListener(onSchemeChange);

  function getAuthToken() {
    // 兼容 Songloft 注入 helper、URL 参数及不同版本的本地存储形态。
    try {
      const helperToken = window.SongloftPlugin?.getAuthToken?.();
      if (helperToken) return String(helperToken);
    } catch {}

    try {
      const params = new URLSearchParams(window.location.search);
      const queryToken = params.get('access_token') || params.get('token');
      if (queryToken) return queryToken;
    } catch {}

    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      const referrerToken = referrer?.searchParams.get('access_token') || referrer?.searchParams.get('token');
      if (referrerToken) return referrerToken;
    } catch {}

    const storages = [window.localStorage, window.sessionStorage];
    try {
      if (window.parent && window.parent !== window) {
        storages.push(window.parent.localStorage, window.parent.sessionStorage);
      }
    } catch {}

    for (const storage of storages) {
      try {
        const raw = storage.getItem('songloft-auth');
        if (raw) {
          try {
            const auth = JSON.parse(raw);
            const token = auth?.accessToken || auth?.access_token || auth?.token;
            if (token) return String(token);
          } catch {
            if (raw.split('.').length === 3) return raw;
          }
        }
        const direct = storage.getItem('access_token') || storage.getItem('accessToken');
        if (direct) return direct;
      } catch {}
    }
    return '';
  }

  function withAccessToken(url, token) {
    if (!token) return url;
    const absolute = new URL(url, window.location.origin);
    if (!absolute.searchParams.has('access_token')) {
      absolute.searchParams.set('access_token', token);
    }
    return absolute.pathname + absolute.search + absolute.hash;
  }

  function songloftAudioProxyUrl(url) {
    const proxy = new URL('/api/v1/proxy', window.location.origin);
    proxy.searchParams.set('url', String(url || ''));
    return withAccessToken(proxy.pathname + proxy.search, getAuthToken());
  }

  function playbackCandidates(resolved) {
    const directUrl = String(resolved?.url || '').trim();
    if (!directUrl) return [];

    let protocol = '';
    try { protocol = new URL(directUrl, window.location.origin).protocol; }
    catch {}

    const hasCustomHeaders = !!resolved?.headers
      && typeof resolved.headers === 'object'
      && Object.keys(resolved.headers).length > 0;
    const preferProxy = protocol === 'http:' || hasCustomHeaders;
    const proxyUrl = songloftAudioProxyUrl(directUrl);
    const ordered = preferProxy
      ? [{ url: proxyUrl, proxied: true }, { url: directUrl, proxied: false }]
      : [{ url: directUrl, proxied: false }, { url: proxyUrl, proxied: true }];

    return ordered.filter((candidate, index, items) => (
      candidate.url && items.findIndex(item => item.url === candidate.url) === index
    ));
  }

  async function playResolvedAudio(audio, resolved) {
    const attempts = playbackCandidates(resolved);
    const errors = [];

    for (const attempt of attempts) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.src = attempt.url;
        await audio.play();
        return attempt;
      } catch (error) {
        errors.push(`${attempt.proxied ? 'Songloft 兼容代理' : '音源直连'}：${error?.message || '播放失败'}`);
      }
    }

    throw new Error(`音频地址无法播放（${errors.join('；')}）`);
  }

  async function request(path, init = {}) {
    const token = getAuthToken();
    const headers = new Headers(init.headers || {});
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // 不在前端提前拦截无 token 场景：部分 Songloft 客户端会通过
    // WebView/同源凭据完成认证。若显式 token 可用，则 Header 和 query 双通道携带，
    // 兼容上传 FormData、普通 JSON 请求及不同宿主版本。
    const requestUrl = withAccessToken(`${root}${path}`, token);
    const response = await fetch(requestUrl, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
    const text = await response.text();

    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch {
        if (response.ok) throw new Error(`响应不是 JSON：${text.slice(0, 120)}`);
      }
    }

    if (response.status === 401) {
      const reason = data?.error || data?.msg || '缺少认证信息';
      throw new Error(`${reason}。请关闭当前页面后，从 Songloft 插件管理中重新打开本插件`);
    }
    if (!response.ok || (data && typeof data.code === 'number' && data.code !== 0)) {
      const primary = data?.msg || data?.error || `HTTP ${response.status}`;
      const detail = data?.detail && String(data.detail) !== String(primary) ? `：${data.detail}` : '';
      throw new Error(`${primary}${detail}`);
    }
    return data;
  }

  function toast(message, ms = 2800) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.innerHTML;
    button.disabled = busy;
    button.innerHTML = busy
      ? `<span class="spinner"></span><span>${escapeHtml(label || '处理中')}</span>`
      : button.dataset.label;
  }

  function availableQualities() {
    const platform = $('platform')?.value || 'all';
    const ids = platform === 'all' ? Object.keys(state.qualityByPlatform) : [platform];
    const found = new Set();
    let legacy = false;
    ids.forEach(id => {
      (state.qualityByPlatform[id] || []).forEach(value => found.add(normalizeQuality(value)));
      if (state.legacyQualityPlatforms.has(id)) legacy = true;
      if (id === 'wy') ['hires', 'atmos', 'atmos_plus', 'master'].forEach(value => found.add(value));
    });
    if (legacy || !ids.length || !Object.keys(state.qualityByPlatform).length) {
      qualityCatalog.filter(item => item.common).forEach(item => found.add(item.value));
    }
    return found;
  }

  function renderQualityOptions(preferred) {
    const available = availableQualities();
    const known = new Set(qualityCatalog.map(item => item.value));
    const saved = normalizeQuality(preferred || defaultQuality()) || '320k';
    const upgradePreferred = normalizeQuality($('upgradeQuality')?.value) || 'flac';
    const custom = Array.from(new Set([...available, saved, upgradePreferred])).filter(value => value && !known.has(value)).sort();
    const options = [
      ...qualityCatalog.map(item => ({ ...item, supported: available.has(item.value) })),
      ...custom.map(value => ({ value, label: `扩展音质 · ${value}`, supported: available.has(value) })),
    ];
    const render = (select, current) => {
      select.innerHTML = options.map(item =>
        `<option value="${escapeHtml(item.value)}"${item.supported ? '' : ' disabled'}>${escapeHtml(item.label)}${item.supported ? '' : ' · 当前音源不支持'}</option>`
      ).join('');
      const usable = options.filter(item => item.supported).map(item => item.value);
      select.value = current;
      return { usable, actual: select.value };
    };
    const setting = $('defaultQualitySetting');
    render(setting, saved);
    setting.value = saved;
    const search = $('quality');
    const searchResult = render(search, saved);
    search.value = searchResult.usable.includes(saved)
      ? saved
      : searchResult.usable.includes('320k') ? '320k' : searchResult.usable[0] || '';
    const upgrade = $('upgradeQuality');
    if (upgrade) {
      const upgradeResult = render(upgrade, upgradePreferred);
      upgrade.value = upgradeResult.usable.includes(upgradePreferred)
        ? upgradePreferred
        : upgradeResult.usable.includes('flac') ? 'flac'
          : upgradeResult.usable.includes('320k') ? '320k' : upgradeResult.usable[0] || '';
    }
    updatePlaybackSettingsState(saved, available.has(saved), search.value);
    updateExternalExample($('quality').value);
  }

  function updatePlaybackSettingsState(saved, supported, actual) {
    const element = $('playbackSettingsState');
    if (!element) return;
    const item = qualityCatalog.find(option => option.value === saved);
    const label = item?.label || saved;
    if (supported) {
      element.textContent = `已保存：${label}`;
      element.classList.remove('is-warning');
      return;
    }
    const fallback = qualityCatalog.find(option => option.value === actual)?.label || actual || '无可用音质';
    element.textContent = `已保存：${label}。当前音源不支持，搜索时暂用 ${fallback}；设置值不会被修改。`;
    element.classList.add('is-warning');
  }

  function syncQualityControls(value) {
    renderQualityOptions(normalizeQuality(value) || '320k');
    updateExternalExample($('quality').value || '320k');
  }

  function updateQualityCapabilities(runtimeSources) {
    state.qualityByPlatform = {};
    state.legacyQualityPlatforms = new Set();
    (runtimeSources || []).forEach(runtime => {
      Object.entries(runtime.sources || {}).forEach(([platform, capability]) => {
        const qualities = Array.isArray(capability?.qualitys) ? capability.qualitys.map(normalizeQuality).filter(Boolean) : [];
        if (!state.qualityByPlatform[platform]) state.qualityByPlatform[platform] = [];
        if (!qualities.length) state.legacyQualityPlatforms.add(platform);
        qualities.forEach(value => {
          if (!state.qualityByPlatform[platform].includes(value)) state.qualityByPlatform[platform].push(value);
        });
      });
    });
    renderQualityOptions(defaultQuality());
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
    if (name === 'import') {
      renderImport();
      loadPlaylists();
    }
    if (name === 'downloads') loadDownloads();
    if (name === 'browse') loadBrowseCatalog();
    if (name === 'sources') loadSources();
    if (name === 'lx-sync') loadLxSyncSettings();
    if (name === 'settings') {
      updateExternalExample($('defaultQualitySetting').value || defaultQuality());
    }
  }

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.querySelectorAll('[data-go-tab]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.goTab)));

  function setRuntimeStatus(active, loading = false) {
    const warning = $('sourceWarning');
    const status = $('runtimeStatus');
    warning.classList.toggle('hidden', active > 0 || loading);
    status.classList.toggle('is-online', active > 0);
    status.classList.toggle('is-offline', active === 0 && !loading);
    status.querySelector('.runtime-title').textContent = active > 0
      ? `${active} 个音源正在运行`
      : loading ? '音源正在初始化' : '未检测到可用音源';
    status.querySelector('.runtime-subtitle').textContent = active > 0
      ? '已动态读取音质能力，失败时自动降级'
      : loading ? '正在加载已启用的音源，请稍候' : '搜索和歌词仍然可用';
  }

  async function loadStatus() {
    clearTimeout(state.statusPollTimer);
    try {
      const resp = await request('/api/status');
      const runtimes = resp.data?.runtime_sources || [];
      const loading = resp.data?.source_state?.loading === true;
      setRuntimeStatus(runtimes.length, loading);
      updateQualityCapabilities(runtimes);
      if (loading) state.statusPollTimer = setTimeout(loadStatus, 1500);
    } catch (error) { toast(error.message); }
  }

  function selectedKey(item) {
    const sd = item.source_data || {};
    const song = sd.songInfo || {};
    return `${sd.platform}:${song.songmid || song.musicId || song.hash || song.copyrightId || item.title + item.artist}`;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function updateSelectionCount() {
    const count = state.selected.length;
    const badge = $('selectedCount');
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  function coverMarkup(url, title) {
    if (!url) return `<div class="cover-wrap">${musicPlaceholder}</div>`;
    return `<div class="cover-wrap"><img src="${escapeHtml(url)}" alt="${escapeHtml(title || '')}" loading="lazy" onerror="this.parentNode.innerHTML='${musicPlaceholder.replace(/'/g, "\\'")}'"></div>`;
  }

  function isPlayingItem(item) {
    const audio = $('previewAudio');
    return state.playingKey && state.playingKey === selectedKey(item) && !!audio.src && !audio.paused;
  }

  function renderResults() {
    const selected = new Set(state.selected.map(selectedKey));
    const count = state.results.length;
    $('searchMeta').textContent = count ? `共找到 ${count} 条结果 · 已选择 ${state.selected.length} 首` : '';
    $('selectAllResults').classList.toggle('hidden', count === 0);
    $('selectAllResults').textContent = count && state.results.every(item => selected.has(selectedKey(item))) ? '取消全选' : '全选结果';

    if (!count) {
      $('results').innerHTML = `<div class="empty-state compact-empty">
        <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>
        <strong>没有找到匹配歌曲</strong><p>换一个关键词或平台再试试。</p>
      </div>`;
      updateSelectionCount();
      return;
    }

    $('results').innerHTML = state.results.map((item, index) => {
      const checked = selected.has(selectedKey(item));
      const source = item.source_data?.platform || '';
      const songQualities = Array.isArray(item.source_data?.songInfo?.types)
        ? item.source_data.songInfo.types.map(entry => entry?.type).filter(Boolean)
        : [];
      const qualityHint = source === 'wy' && songQualities.length
        ? ` · 可用音质 ${songQualities.join(' / ')}`
        : '';
      const playing = isPlayingItem(item);
      const downloadJob = state.downloadJobs[selectedKey(item)] || null;
      const downloadLabel = downloadJob?.status === 'completed'
        ? '已下载'
        : downloadJob?.status === 'pending'
          ? '等待解析'
          : downloadJob?.status === 'resolving'
            ? '解析中'
        : downloadJob?.status === 'downloading'
          ? `下载中${downloadJob.total_bytes != null ? ` · ${formatBytes(downloadJob.total_bytes)}` : ''}`
          : downloadJob?.status === 'verifying'
            ? '校验中'
          : downloadJob?.status === 'queued'
            ? `排队中${downloadJob.total_bytes != null ? ` · ${formatBytes(downloadJob.total_bytes)}` : ''}`
            : downloadJob?.status === 'failed'
              ? '重试'
              : '下载';
      const downloadDisabled = ['pending', 'resolving', 'queued', 'downloading', 'verifying', 'completed'].includes(downloadJob?.status || '') ? ' disabled' : '';
      return `<article class="result-item">
        <input class="result-check" type="checkbox" data-index="${index}" ${checked ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.title)}">
        ${coverMarkup(item.cover_url, item.title)}
        <div class="result-main">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="sub">${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(item.album || '未知专辑')} · ${formatDuration(item.duration)}${escapeHtml(qualityHint)}</div>
        </div>
        <div class="result-side">
          <div class="result-tags">
            <span class="badge primary-badge">${escapeHtml(platformNames[source] || source)}</span>
            <span class="badge">${escapeHtml(item.source_data?.quality || $('quality').value)}</span>
          </div>
          <div class="result-actions">
            <button class="mini-button play" type="button" data-play="${index}">${playing ? '暂停' : '播放'}</button>
            <button class="mini-button download" type="button" data-download="${index}" title="下载到 Songloft 音乐目录"${downloadDisabled}>${downloadLabel}</button>
            <button class="mini-button import" type="button" data-import-one="${index}" title="导入到 Songloft 歌曲库">导入</button>
          </div>
        </div>
      </article>`;
    }).join('');

    $('results').querySelectorAll('input[type=checkbox]').forEach(input => input.addEventListener('change', event => {
      const item = state.results[Number(event.target.dataset.index)];
      const key = selectedKey(item);
      if (event.target.checked && !state.selected.some(x => selectedKey(x) === key)) state.selected.push(item);
      if (!event.target.checked) state.selected = state.selected.filter(x => selectedKey(x) !== key);
      localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
      renderResults();
    }));

    $('results').querySelectorAll('[data-play]').forEach(button => button.addEventListener('click', () => {
      playPreview(state.results[Number(button.dataset.play)], button);
    }));

    $('results').querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => {
      startDownload(state.results[Number(button.dataset.download)], button);
    }));

    $('results').querySelectorAll('[data-import-one]').forEach(button => button.addEventListener('click', () => {
      openSingleImport(state.results[Number(button.dataset.importOne)]);
    }));

    updateSelectionCount();
  }

  function setSearchDiscoveryExpanded(expanded) {
    state.searchDiscoveryExpanded = Boolean(expanded);
    $('searchDiscovery').classList.toggle('is-collapsed', !state.searchDiscoveryExpanded);
    $('toggleSearchDiscovery').setAttribute('aria-expanded', String(state.searchDiscoveryExpanded));
    $('searchDiscoveryToggleLabel').textContent = state.searchDiscoveryExpanded ? '收起' : '展开';
  }

  function renderSearchDiscovery() {
    const hotSource = $('hotSearchSource');
    hotSource.textContent = state.hotSearches.length
      ? state.hotSearchSource === 'netease_mixed' ? '网易云实时热搜 + 推荐补充 · 点击搜索' : '内置推荐 · 点击搜索'
      : '暂时不可用';
    $('hotSearchList').innerHTML = state.hotSearches.length
      ? state.hotSearches.map((keyword, index) => `<button class="search-chip" type="button" data-hot-search="${index}" title="搜索 ${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`).join('')
      : '<span class="search-suggestion-empty">暂时没有热门推荐，可直接输入关键词搜索。</span>';

    const historySection = $('searchHistorySection');
    historySection.classList.toggle('hidden', state.searchHistory.length === 0);
    $('searchHistoryList').innerHTML = state.searchHistory.map((keyword, index) => `<span class="search-history-chip">
      <button type="button" data-history-search="${index}" title="再次搜索 ${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>
      <button type="button" data-history-remove="${index}" aria-label="删除搜索记录 ${escapeHtml(keyword)}" title="删除">×</button>
    </span>`).join('');

    $('hotSearchList').querySelectorAll('[data-hot-search]').forEach(button => button.addEventListener('click', () => runSuggestedSearch(state.hotSearches[Number(button.dataset.hotSearch)])));
    $('searchHistoryList').querySelectorAll('[data-history-search]').forEach(button => button.addEventListener('click', () => runSuggestedSearch(state.searchHistory[Number(button.dataset.historySearch)])));
    $('searchHistoryList').querySelectorAll('[data-history-remove]').forEach(button => button.addEventListener('click', () => removeHistoryKeyword(state.searchHistory[Number(button.dataset.historyRemove)])));
  }

  async function loadSearchDiscovery() {
    try {
      const resp = await request('/api/search/discovery');
      state.hotSearches = Array.isArray(resp.data?.hot) ? resp.data.hot : [];
      state.hotSearchSource = String(resp.data?.hot_source || '');
      state.searchHistory = Array.isArray(resp.data?.history) ? resp.data.history : [];
      renderSearchDiscovery();
    } catch (error) {
      state.hotSearches = [];
      state.hotSearchSource = '';
      renderSearchDiscovery();
    }
  }

  async function saveHistoryKeyword(keyword) {
    try {
      const resp = await request('/api/search/history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword }),
      });
      state.searchHistory = Array.isArray(resp.data?.history) ? resp.data.history : state.searchHistory;
      renderSearchDiscovery();
    } catch (error) {
      // 搜索历史保存失败不应影响歌曲搜索。
    }
  }

  async function removeHistoryKeyword(keyword) {
    try {
      const resp = await request(`/api/search/history?keyword=${encodeURIComponent(keyword)}`, { method: 'DELETE' });
      state.searchHistory = Array.isArray(resp.data?.history) ? resp.data.history : [];
      renderSearchDiscovery();
    } catch (error) { toast(error.message, 4200); }
  }

  function runSuggestedSearch(keyword) {
    if (!keyword) return;
    $('keyword').value = keyword;
    search();
  }

  function browseArtist(value) {
    if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.name || '').filter(Boolean).join(' / ');
    if (value && typeof value === 'object') return value.name || value.title || '';
    return String(value || '');
  }

  function normalizeBrowseSong(song, platform) {
    const duration = Number(song.duration || song.interval || 0);
    return {
      title: song.name || song.title || song.songName || '未知歌曲',
      artist: browseArtist(song.singer || song.artist || song.artists || song.ar),
      album: song.albumName || song.album?.name || song.album || '',
      duration: duration > 10000 ? Math.round(duration / 1000) : duration,
      cover_url: song.img || song.cover || song.coverUrl || song.album?.picUrl || '',
      source_data: {
        platform,
        quality: $('quality').value || defaultQuality(),
        songInfo: song,
      },
    };
  }

  function filteredSharedPlaylistSongs() {
    const keyword = $('sharedPlaylistSearch').value.trim().toLocaleLowerCase();
    if (!keyword) return state.sharedPlaylistSongs.map((item, index) => ({ item, index }));
    return state.sharedPlaylistSongs
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => `${item.title} ${item.artist} ${item.album}`.toLocaleLowerCase().includes(keyword));
  }

  function renderSharedPlaylistSongs() {
    const container = $('sharedPlaylistSongs');
    const filtered = filteredSharedPlaylistSongs();
    const selected = new Set(state.selected.map(selectedKey));
    const selectedInPlaylist = state.sharedPlaylistSongs.filter(item => selected.has(selectedKey(item))).length;
    $('sharedPlaylistMeta').textContent = `已加载 ${state.sharedPlaylistSongs.length}${state.sharedPlaylistTotal > state.sharedPlaylistSongs.length ? ` / ${state.sharedPlaylistTotal}` : ''} 首 · 已选择 ${selectedInPlaylist} 首 · ${platformNames[state.sharedPlaylistSource] || state.sharedPlaylistSource}`;
    $('selectAllSharedPlaylist').textContent = filtered.length && filtered.every(({ item }) => selected.has(selectedKey(item))) ? '取消选择当前结果' : '全选当前结果';
    $('downloadSharedSelection').disabled = selectedInPlaylist === 0;
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state compact-empty"><strong>没有匹配歌曲</strong><p>换一个筛选关键词再试试。</p></div>';
      return;
    }
    container.innerHTML = filtered.map(({ item, index }) => `<article class="shared-playlist-song">
      <input class="result-check" type="checkbox" data-shared-check="${index}" ${selected.has(selectedKey(item)) ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.title)}">
      ${coverMarkup(item.cover_url, item.title)}
      <div class="shared-playlist-song-main"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(item.album || '未知专辑')} · ${formatDuration(item.duration)}</span></div>
      <span class="badge primary-badge">${escapeHtml(platformNames[state.sharedPlaylistSource] || state.sharedPlaylistSource)}</span>
    </article>`).join('');
    container.querySelectorAll('[data-shared-check]').forEach(input => input.addEventListener('change', event => {
      const item = state.sharedPlaylistSongs[Number(event.target.dataset.sharedCheck)];
      const key = selectedKey(item);
      if (event.target.checked && !state.selected.some(entry => selectedKey(entry) === key)) state.selected.push(item);
      if (!event.target.checked) state.selected = state.selected.filter(entry => selectedKey(entry) !== key);
      localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
      renderSharedPlaylistSongs();
      renderImport();
      renderResults();
    }));
  }

  async function parseSharedPlaylist() {
    const value = $('sharedPlaylistUrl').value.trim();
    if (!value) return toast('请粘贴歌单分享链接');
    const button = $('parseSharedPlaylist');
    setBusy(button, true, '解析中');
    $('sharedPlaylistState').textContent = '正在识别平台并加载完整歌单，请稍候…';
    $('sharedPlaylistResult').classList.add('hidden');
    try {
      const resp = await request('/api/songlist/shared', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: value }),
      });
      const source = String(resp.data?.source || '');
      const songs = Array.isArray(resp.data?.list) ? resp.data.list : [];
      state.sharedPlaylistSource = source;
      state.sharedPlaylistTitle = String(resp.data?.name || '分享歌单');
      state.sharedPlaylistTotal = Number(resp.data?.total || songs.length);
      state.sharedPlaylistSongs = songs.map(song => normalizeBrowseSong(song, source));
      $('sharedPlaylistTitle').textContent = state.sharedPlaylistTitle;
      $('sharedPlaylistCover').innerHTML = resp.data?.img ? `<img src="${escapeHtml(resp.data.img)}" alt="">` : '♫';
      $('sharedPlaylistSearch').value = '';
      $('sharedPlaylistResult').classList.remove('hidden');
      $('sharedPlaylistState').textContent = resp.data?.truncated
        ? `歌单共有 ${state.sharedPlaylistTotal} 首，本次已加载前 ${state.sharedPlaylistSongs.length} 首。`
        : `歌单解析成功，共加载 ${state.sharedPlaylistSongs.length} 首歌曲。`;
      if (!$('playlistName').value) $('playlistName').value = state.sharedPlaylistTitle;
      renderSharedPlaylistSongs();
    } catch (error) {
      state.sharedPlaylistSongs = [];
      $('sharedPlaylistState').textContent = `解析失败：${error.message}`;
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  }

  $('sharedPlaylistForm').addEventListener('submit', event => { event.preventDefault(); parseSharedPlaylist(); });
  $('sharedPlaylistSearch').addEventListener('input', renderSharedPlaylistSongs);
  $('selectAllSharedPlaylist').addEventListener('click', () => {
    const filtered = filteredSharedPlaylistSongs();
    const current = new Set(state.selected.map(selectedKey));
    const allSelected = filtered.length && filtered.every(({ item }) => current.has(selectedKey(item)));
    const filteredKeys = new Set(filtered.map(({ item }) => selectedKey(item)));
    if (allSelected) state.selected = state.selected.filter(item => !filteredKeys.has(selectedKey(item)));
    else filtered.forEach(({ item }) => { if (!state.selected.some(entry => selectedKey(entry) === selectedKey(item))) state.selected.push(item); });
    localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
    renderSharedPlaylistSongs();
    renderImport();
    renderResults();
  });
  $('downloadSharedSelection').addEventListener('click', () => $('batchDownloadButton').click());

  function formatPlayCount(value) {
    const count = Number(value || 0);
    if (!count) return '';
    if (count >= 100000000) return `${(count / 100000000).toFixed(1)} 亿次播放`;
    if (count >= 10000) return `${(count / 10000).toFixed(1)} 万次播放`;
    return `${count} 次播放`;
  }

  function renderBrowseSongs() {
    const list = $('browseSongs');
    const selected = new Set(state.selected.map(selectedKey));
    $('browseDetailTitle').textContent = state.browseTitle || (state.browseMode === 'rank' ? '榜单详情' : '歌单详情');
    $('browseDetailMeta').textContent = `共 ${state.browseSongs.length} 首歌曲 · ${platformNames[state.browsePlatform] || state.browsePlatform}`;
    $('selectAllBrowse').textContent = state.browseSongs.length && state.browseSongs.every(item => selected.has(selectedKey(item)))
      ? '取消全选' : '全选歌曲';
    if (!state.browseSongs.length) {
      list.innerHTML = '<div class="empty-state compact-empty"><strong>暂无歌曲</strong><p>该项目没有返回可用的歌曲数据。</p></div>';
      return;
    }
    list.innerHTML = state.browseSongs.map((item, index) => {
      const checked = selected.has(selectedKey(item));
      const playing = isPlayingItem(item);
      return `<article class="result-item">
        <input class="result-check" type="checkbox" data-browse-check="${index}" ${checked ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.title)}">
        ${coverMarkup(item.cover_url, item.title)}
        <div class="result-main">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="sub">${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(item.album || '未知专辑')} · ${formatDuration(item.duration)}</div>
        </div>
        <div class="result-side">
          <div class="result-tags"><span class="badge primary-badge">${escapeHtml(platformNames[state.browsePlatform] || state.browsePlatform)}</span></div>
          <div class="result-actions">
            <button class="mini-button play" type="button" data-browse-play="${index}">${playing ? '暂停' : '播放'}</button>
            <button class="mini-button download" type="button" data-browse-download="${index}">下载</button>
            <button class="mini-button import" type="button" data-browse-import="${index}">导入</button>
          </div>
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-browse-check]').forEach(input => input.addEventListener('change', event => {
      const item = state.browseSongs[Number(event.target.dataset.browseCheck)];
      const key = selectedKey(item);
      if (event.target.checked && !state.selected.some(entry => selectedKey(entry) === key)) state.selected.push(item);
      if (!event.target.checked) state.selected = state.selected.filter(entry => selectedKey(entry) !== key);
      localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
      renderBrowseSongs();
      renderResults();
      updateSelectionCount();
    }));
    list.querySelectorAll('[data-browse-play]').forEach(button => button.addEventListener('click', () => playPreview(state.browseSongs[Number(button.dataset.browsePlay)], button)));
    list.querySelectorAll('[data-browse-download]').forEach(button => button.addEventListener('click', () => startDownload(state.browseSongs[Number(button.dataset.browseDownload)], button)));
    list.querySelectorAll('[data-browse-import]').forEach(button => button.addEventListener('click', () => openSingleImport(state.browseSongs[Number(button.dataset.browseImport)])));
  }

  function rawBrowseSongKey(song) {
    const id = song.musicId || song.songmid || song.hash || song.copyrightId || song.id || song.rid || song.audio_id;
    if (id) return `${state.browsePlatform}:${id}`;
    return `${state.browsePlatform}:${song.name || song.title || ''}:${browseArtist(song.singer || song.artist || song.artists || song.ar)}`;
  }

  async function loadAllBrowseSongs(endpoint, itemId) {
    const maximumSongs = 500;
    const maximumPages = 50;
    let page = 1;
    let pageSize = 50;
    let total = 0;
    let totalIsAuthoritative = false;
    let title = '';
    let previousSignature = '';
    const songs = [];
    const seen = new Set();

    while (page <= maximumPages && songs.length < maximumSongs) {
      $('browseDetailMeta').textContent = `正在加载第 ${page} 页 · 已获取 ${songs.length} 首`;
      const resp = await request(`${endpoint}?source_id=${encodeURIComponent(state.browsePlatform)}&id=${encodeURIComponent(itemId)}&page=${page}&limit=${pageSize}`);
      const batch = Array.isArray(resp.data?.list) ? resp.data.list : [];
      if (page === 1) {
        title = resp.data?.name || '';
        total = Math.max(0, Number(resp.data?.total || 0));
        totalIsAuthoritative = total > batch.length;
        if (batch.length > 0 && batch.length < pageSize) pageSize = batch.length;
      }
      if (!batch.length) break;

      const signature = batch.map(rawBrowseSongKey).join('|');
      if (signature && signature === previousSignature) break;
      previousSignature = signature;

      let added = 0;
      for (const song of batch) {
        const key = rawBrowseSongKey(song);
        if (seen.has(key)) continue;
        seen.add(key);
        songs.push(song);
        added += 1;
        if (songs.length >= maximumSongs) break;
      }
      if (!added) break;
      if (totalIsAuthoritative && songs.length >= Math.min(total, maximumSongs)) break;
      if (batch.length < pageSize) break;
      page += 1;
    }
    return { songs, title, total };
  }

  async function openBrowseItem(item) {
    $('browseCatalog').closest('.browse-card').classList.add('hidden');
    $('browseDetail').classList.remove('hidden');
    state.browseTitle = item.name || item.title || (state.browseMode === 'rank' ? '榜单详情' : '歌单详情');
    state.browseSongs = [];
    renderBrowseSongs();
    $('browseSongs').innerHTML = '<div class="empty-state compact-empty"><span class="spinner"></span><p>正在加载歌曲…</p></div>';
    try {
      const endpoint = state.browseMode === 'rank' ? '/api/leaderboard/list' : '/api/songlist/detail';
      const result = await loadAllBrowseSongs(endpoint, item.id);
      state.browseTitle = result.title || state.browseTitle;
      state.browseSongs = result.songs.map(song => normalizeBrowseSong(song, state.browsePlatform));
      renderBrowseSongs();
      if (result.total > state.browseSongs.length) {
        $('browseDetailMeta').textContent = `已加载 ${state.browseSongs.length} / ${result.total} 首 · ${platformNames[state.browsePlatform] || state.browsePlatform}`;
      }
    } catch (error) {
      $('browseSongs').innerHTML = `<div class="empty-state compact-empty"><strong>加载失败</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  function renderBrowseCatalog() {
    const catalog = $('browseCatalog');
    if (!state.browseCatalog.length) {
      const keyword = $('browseKeyword').value.trim();
      const copy = state.browseMode === 'playlist' && keyword
        ? `没有找到与“${escapeHtml(keyword)}”相关的歌单，可以更换关键词或平台。`
        : '该平台暂未返回数据，可以切换其他平台。';
      catalog.innerHTML = `<div class="empty-state compact-empty browse-empty"><strong>暂无内容</strong><p>${copy}</p></div>`;
      return;
    }
    catalog.innerHTML = state.browseCatalog.map((item, index) => {
      const cover = item.img || item.cover || item.coverUrl || item.coverImgUrl || '';
      const title = item.name || item.title || '未命名';
      const meta = item.creator || item.author || formatPlayCount(item.playCount || item.playcount) || item.description || '';
      return `<button class="browse-item" type="button" data-browse-index="${index}">
        <span class="browse-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">` : '<span class="browse-cover-placeholder">♫</span>'}</span>
        <span class="browse-item-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta || (state.browseMode === 'rank' ? '点击查看榜单' : '点击查看歌单'))}</small></span>
      </button>`;
    }).join('');
    catalog.querySelectorAll('[data-browse-index]').forEach(button => button.addEventListener('click', () => openBrowseItem(state.browseCatalog[Number(button.dataset.browseIndex)])));
  }

  async function loadBrowseCatalog(force = false) {
    const catalog = $('browseCatalog');
    if (!catalog || (!force && state.browseCatalog.length && $('browsePlatform').value === state.browsePlatform)) return;
    state.browsePlatform = $('browsePlatform').value;
    const keyword = state.browseMode === 'playlist' ? $('browseKeyword').value.trim() : '';
    $('browseHeading').textContent = state.browseMode === 'rank' ? '排行榜' : keyword ? `搜索歌单：${keyword}` : '热门歌单';
    $('browseResetSearch').classList.toggle('hidden', !keyword);
    $('browseDetail').classList.add('hidden');
    catalog.closest('.browse-card').classList.remove('hidden');
    catalog.innerHTML = '<div class="empty-state compact-empty browse-empty"><span class="spinner"></span><p>正在加载…</p></div>';
    try {
      const endpoint = state.browseMode === 'rank' ? '/api/leaderboard/boards' : keyword ? '/api/songlist/search' : '/api/songlist/list';
      const query = new URLSearchParams({ source_id: state.browsePlatform, page: '1', limit: '30' });
      if (keyword) query.set('keyword', keyword); else query.set('sort', 'hot');
      const resp = await request(`${endpoint}?${query.toString()}`);
      state.browseCatalog = Array.isArray(resp.data?.list) ? resp.data.list : [];
      renderBrowseCatalog();
    } catch (error) {
      state.browseCatalog = [];
      catalog.innerHTML = `<div class="empty-state compact-empty browse-empty"><strong>加载失败</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  document.querySelectorAll('[data-browse-mode]').forEach(button => button.addEventListener('click', () => {
    state.browseMode = button.dataset.browseMode;
    state.browseCatalog = [];
    document.querySelectorAll('[data-browse-mode]').forEach(item => item.classList.toggle('active', item === button));
    $('browseSearchForm').classList.toggle('hidden', state.browseMode !== 'playlist');
    loadBrowseCatalog(true);
  }));
  $('browseSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('browseKeyword').value.trim()) return toast('请输入歌单名称或关键词');
    state.browseCatalog = [];
    loadBrowseCatalog(true);
  });
  $('browseResetSearch').addEventListener('click', () => {
    $('browseKeyword').value = '';
    state.browseCatalog = [];
    loadBrowseCatalog(true);
  });
  $('browsePlatform').addEventListener('change', () => { state.browseCatalog = []; loadBrowseCatalog(true); });
  $('refreshBrowse').addEventListener('click', () => loadBrowseCatalog(true));
  $('browseBack').addEventListener('click', () => {
    $('browseDetail').classList.add('hidden');
    $('browseCatalog').closest('.browse-card').classList.remove('hidden');
  });
  $('selectAllBrowse').addEventListener('click', () => {
    const selected = new Set(state.selected.map(selectedKey));
    const allSelected = state.browseSongs.length && state.browseSongs.every(item => selected.has(selectedKey(item)));
    const keys = new Set(state.browseSongs.map(selectedKey));
    if (allSelected) state.selected = state.selected.filter(item => !keys.has(selectedKey(item)));
    else state.browseSongs.forEach(item => { if (!state.selected.some(entry => selectedKey(entry) === selectedKey(item))) state.selected.push(item); });
    localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
    renderBrowseSongs();
    renderResults();
    updateSelectionCount();
  });

  $('selectAllResults').addEventListener('click', () => {
    const currentKeys = new Set(state.selected.map(selectedKey));
    const allSelected = state.results.every(item => currentKeys.has(selectedKey(item)));
    if (allSelected) {
      const resultKeys = new Set(state.results.map(selectedKey));
      state.selected = state.selected.filter(item => !resultKeys.has(selectedKey(item)));
    } else {
      state.results.forEach(item => {
        if (!state.selected.some(x => selectedKey(x) === selectedKey(item))) state.selected.push(item);
      });
    }
    localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
    renderResults();
  });

  async function search() {
    const keyword = $('keyword').value.trim();
    if (!keyword) return toast('请输入歌曲名或歌手');
    const button = $('searchButton');
    setBusy(button, true, '搜索中');
    $('searchMeta').textContent = '正在连接音乐平台…';
    try {
      const resp = await request('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          source_id: $('platform').value,
          quality: $('quality').value,
          page: 1,
          page_size: 30,
          allow_downgrade: allowAutoDowngrade(),
        }),
      });
      state.results = resp.results || [];
      setSearchDiscoveryExpanded(false);
      saveHistoryKeyword(keyword);
      renderResults();
    } catch (error) {
      state.results = [];
      renderResults();
      toast(error.message, 4800);
    } finally {
      setBusy(button, false);
    }
  }
  $('platform').addEventListener('change', () => renderQualityOptions($('quality').value));
  $('searchButton').addEventListener('click', search);
  $('keyword').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  $('toggleSearchDiscovery').addEventListener('click', () => setSearchDiscoveryExpanded(!state.searchDiscoveryExpanded));
  $('clearSearchHistory').addEventListener('click', async () => {
    if (!confirm('确定清空全部搜索历史吗？')) return;
    try {
      const resp = await request('/api/search/history?all=true', { method: 'DELETE' });
      state.searchHistory = Array.isArray(resp.data?.history) ? resp.data.history : [];
      renderSearchDiscovery();
      toast('搜索历史已清空');
    } catch (error) { toast(error.message, 4200); }
  });

  function playlistOptionsMarkup(selectedValue = '') {
    const base = [
      `<option value=""${selectedValue === '' ? ' selected' : ''}>仅导入 Songloft 歌曲库</option>`,
      ...state.playlists.map(item => {
        const value = String(item.id);
        const count = Number(item.song_count || 0);
        const label = `${item.name || '未命名歌单'}${count ? ` · ${count} 首` : ''}`;
        return `<option value="${escapeHtml(value)}"${selectedValue === value ? ' selected' : ''}>加入歌单：${escapeHtml(label)}</option>`;
      }),
      `<option value="__new__"${selectedValue === '__new__' ? ' selected' : ''}>新建歌单…</option>`,
    ];
    return base.join('');
  }

  function populatePlaylistSelect(selectId) {
    const select = $(selectId);
    if (!select) return;
    const previous = select.value || '';
    select.innerHTML = playlistOptionsMarkup(previous);
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  async function loadPlaylists(force = false) {
    if (state.playlistsLoaded && !force) {
      populatePlaylistSelect('batchPlaylistTarget');
      populatePlaylistSelect('singlePlaylistTarget');
      return state.playlists;
    }
    try {
      const resp = await request('/api/playlists');
      state.playlists = Array.isArray(resp.data?.playlists) ? resp.data.playlists : [];
      state.playlistsLoaded = true;
      populatePlaylistSelect('batchPlaylistTarget');
      populatePlaylistSelect('singlePlaylistTarget');
      return state.playlists;
    } catch (error) {
      state.playlists = [];
      state.playlistsLoaded = false;
      populatePlaylistSelect('batchPlaylistTarget');
      populatePlaylistSelect('singlePlaylistTarget');
      toast(`歌单列表加载失败：${error.message}`, 4800);
      return [];
    }
  }

  function toggleNewPlaylistField(selectId, fieldId) {
    const select = $(selectId);
    const field = $(fieldId);
    if (!select || !field) return;
    field.classList.toggle('hidden', select.value !== '__new__');
  }

  function readPlaylistTarget(selectId, nameId) {
    const select = $(selectId);
    const value = select?.value || '';
    if (value === '__new__') {
      const name = $(nameId)?.value.trim() || '';
      if (!name) throw new Error('请输入新建歌单名称');
      return { playlistName: name, playlistLabel: name };
    }
    if (value) {
      const option = select.options[select.selectedIndex];
      const label = String(option?.textContent || '').replace(/^加入歌单：/, '').replace(/ · \d+ 首$/, '');
      return { playlistId: Number(value), playlistLabel: label || '所选歌单' };
    }
    return { playlistLabel: '' };
  }

  function renderImport() {
    if (state.selected.length) {
      $('importList').innerHTML = state.selected.map((item, index) => `<article class="compact-item">
        <button class="remove-button" type="button" data-remove="${index}" title="移除" aria-label="移除 ${escapeHtml(item.title)}">×</button>
        ${coverMarkup(item.cover_url, item.title)}
        <div class="compact-main"><div class="title">${escapeHtml(item.title)}</div><div class="sub">${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(platformNames[item.source_data?.platform] || item.source_data?.platform || '')}</div></div>
        <span class="badge">${escapeHtml(item.source_data?.quality || $('quality').value)}</span>
      </article>`).join('');
    } else {
      $('importList').innerHTML = `<div class="empty-state compact-empty">
        <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/></svg></div>
        <strong>还没有选择歌曲</strong><p>返回搜索页勾选想要导入的歌曲。</p>
      </div>`;
    }
    $('importList').querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
      state.selected.splice(Number(button.dataset.remove), 1);
      localStorage.setItem('neo-lxbridge:selected', JSON.stringify(state.selected));
      renderImport();
      renderResults();
    }));
    $('importButton').disabled = !state.selected.length;
    $('batchDownloadButton').disabled = !state.selected.length;
    if (state.playlistsLoaded) populatePlaylistSelect('batchPlaylistTarget');
    toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
    updateSelectionCount();
  }

  $('clearSelection').addEventListener('click', () => {
    state.selected = [];
    localStorage.removeItem('neo-lxbridge:selected');
    renderImport();
    renderResults();
  });

  async function importSongs(items, button, options = {}) {
    if (!items.length) return null;
    const {
      playlistId,
      playlistName,
      playlistLabel = '',
      fetchLyric = true,
      successMessage = '',
    } = options;
    setBusy(button, true, '导入中');
    try {
      const resp = await request('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songs: items,
          playlist_id: playlistId || undefined,
          playlist_name: playlistName || undefined,
          fetch_lyric: fetchLyric,
        }),
      });
      const count = resp.data?.count || items.length;
      const destination = playlistLabel ? `，并加入歌单「${playlistLabel}」` : '';
      toast(successMessage || `已导入 ${count} 首歌曲到 Songloft 歌曲库${destination}`, 4200);
      if (playlistId || playlistName) loadPlaylists(true);
      return resp;
    } catch (error) {
      toast(error.message, 5200);
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  $('batchPlaylistTarget').addEventListener('change', () => {
    toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
  });

  $('importButton').addEventListener('click', async () => {
    if (!state.selected.length) return;
    try {
      const target = readPlaylistTarget('batchPlaylistTarget', 'playlistName');
      await importSongs(state.selected, $('importButton'), {
        ...target,
        fetchLyric: $('fetchLyric').checked,
      });
      state.selected = [];
      localStorage.removeItem('neo-lxbridge:selected');
      $('playlistName').value = '';
      $('batchPlaylistTarget').value = '';
      toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
      renderImport();
      renderResults();
    } catch {
      // error already shown
    }
  });

  function openSingleImport(item) {
    state.importItem = item;
    $('singleImportSong').innerHTML = `${coverMarkup(item.cover_url, item.title)}
      <div class="compact-main">
        <div class="title">${escapeHtml(item.title)}</div>
        <div class="sub">${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(item.album || '未知专辑')} · ${escapeHtml(platformNames[item.source_data?.platform] || item.source_data?.platform || '')}</div>
      </div>`;
    $('singlePlaylistName').value = '';
    $('singleFetchLyric').checked = true;
    $('singlePlaylistTarget').value = '';
    toggleNewPlaylistField('singlePlaylistTarget', 'singleNewPlaylistField');
    $('importModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    loadPlaylists().then(() => {
      $('singlePlaylistTarget').value = '';
      toggleNewPlaylistField('singlePlaylistTarget', 'singleNewPlaylistField');
    });
  }

  function closeSingleImport() {
    $('importModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.importItem = null;
  }

  $('singlePlaylistTarget').addEventListener('change', () => {
    toggleNewPlaylistField('singlePlaylistTarget', 'singleNewPlaylistField');
  });
  $('closeImportModal').addEventListener('click', closeSingleImport);
  $('cancelSingleImport').addEventListener('click', closeSingleImport);
  $('importModal').addEventListener('click', event => {
    if (event.target === $('importModal')) closeSingleImport();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('importModal').classList.contains('hidden')) closeSingleImport();
  });

  $('confirmSingleImport').addEventListener('click', async () => {
    if (!state.importItem) return;
    const item = state.importItem;
    try {
      const target = readPlaylistTarget('singlePlaylistTarget', 'singlePlaylistName');
      await importSongs([item], $('confirmSingleImport'), {
        ...target,
        fetchLyric: $('singleFetchLyric').checked,
        successMessage: `已导入《${item.title}》到 Songloft 歌曲库${target.playlistLabel ? `，并加入歌单「${target.playlistLabel}」` : ''}`,
      });
      closeSingleImport();
    } catch {
      // error already shown
    }
  });

  function setDownloadJob(item, job) {
    const key = selectedKey(item);
    state.downloadJobs[key] = { ...(state.downloadJobs[key] || {}), ...job };
    const index = state.downloadTaskList.findIndex(entry => entry.id === job.id);
    if (index >= 0) state.downloadTaskList[index] = { ...state.downloadTaskList[index], ...job };
    else state.downloadTaskList.unshift({ ...job });
    renderResults();
    renderDownloads();
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '大小未知';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = -1;
    do {
      size /= 1024;
      unit += 1;
    } while (size >= 1024 && unit < units.length - 1);
    return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`;
  }

  function filteredUpgradeSongs() {
    const keyword = String(state.upgradeSearch || '').trim().toLowerCase();
    if (!keyword) return state.upgradeSongs;
    return state.upgradeSongs.filter(song => [song.title, song.artist, song.album, song.file_path]
      .some(value => String(value || '').toLowerCase().includes(keyword)));
  }

  async function requestUpgradeCandidates(songId) {
    const resp = await request('/api/upgrade/match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId, quality: $('upgradeQuality').value, max_duration_diff: Number($('upgradeDurationDiff').value) }),
    });
    return resp.data?.candidates || [];
  }

  function updateUpgradeResultTools() {
    const hasResults = state.upgradeScanned && state.upgradeSongs.length > 0;
    $('upgradeResultTools')?.classList.toggle('hidden', !hasResults);
    const count = $('upgradeSelectedCount');
    if (count) {
      count.textContent = `已选择 ${state.upgradeSelected.size} 首`;
      count.classList.toggle('hidden', !hasResults);
    }
  }

  function renderUpgradeSongs() {
    const list = $('upgradeSongList');
    if (!list) return;
    updateUpgradeResultTools();
    if (!state.upgradeSongs.length) {
      list.innerHTML = '<div class="empty-state compact-empty"><strong>没有符合条件的歌曲</strong><p>可以提高扫描码率阈值后重新扫描。</p></div>';
      return;
    }
    const visibleSongs = filteredUpgradeSongs();
    if (!visibleSongs.length) {
      list.innerHTML = '<div class="empty-state compact-empty"><strong>没有匹配的扫描结果</strong><p>请更换歌名、歌手或路径关键词。</p></div>';
      return;
    }
    list.innerHTML = visibleSongs.map(song => {
      const candidates = state.upgradeCandidates[song.id];
      const candidateMarkup = Array.isArray(candidates)
        ? (candidates.length ? `<div class="upgrade-candidates">${candidates.map((item, index) => `<div class="upgrade-candidate">
            <div class="upgrade-candidate-copy"><strong>${index === 0 ? '<em class="upgrade-best-badge">最佳匹配</em>' : ''}${escapeHtml(item.title)} · ${escapeHtml(item.artist || '未知歌手')}</strong><span>${escapeHtml(item.album || '未知专辑')} · ${formatDuration(item.duration)} · 时长差 ${Number(item.duration_diff || 0).toFixed(1)} 秒 · 匹配分 ${Math.round(Number(item.match_score || 0))}</span>${upgradeCandidateProbeMarkup(item)}</div>
            <button class="mini-button download" type="button" data-upgrade-download="${song.id}" data-candidate-index="${index}">下载新版</button>
          </div>`).join('')}</div>` : '<p class="muted">没有找到满足歌名、歌手和时长条件的安全候选。</p>')
        : '';
      return `<article class="upgrade-song-item">
        <div class="upgrade-song-header">
          <label class="upgrade-song-select" title="加入批量操作"><input type="checkbox" data-upgrade-select="${song.id}" ${state.upgradeSelected.has(Number(song.id)) ? 'checked' : ''}></label>
          <div class="upgrade-song-copy"><strong>${escapeHtml(song.title)} · ${escapeHtml(song.artist || '未知歌手')}</strong><span>${escapeHtml(String(song.format || '未知格式').toUpperCase())} · ${Number(song.bitrate_kbps || 0)} kbps${song.bitrate_source === 'estimated' ? '（估算）' : ''} · ${formatDuration(song.duration)} · ${escapeHtml(song.file_path || '')}</span></div>
          <button class="secondary" type="button" data-upgrade-match="${song.id}">匹配高音质版本</button>
        </div>
        ${candidateMarkup}
      </article>`;
    }).join('');
    list.querySelectorAll('[data-upgrade-match]').forEach(button => button.addEventListener('click', async () => {
      const songId = Number(button.dataset.upgradeMatch);
      setBusy(button, true, '匹配中');
      try {
        state.upgradeCandidates[songId] = await requestUpgradeCandidates(songId);
        state.upgradeCandidates[songId].forEach(item => { item._probe_status = 'loading'; });
        renderUpgradeSongs();
        for (const item of state.upgradeCandidates[songId]) {
          try {
            item._probe = await probeDownload(item, false);
            item._probe_status = 'done';
          } catch (error) {
            item._probe_status = 'failed';
            item._probe_error = error.message;
          }
          renderUpgradeSongs();
        }
      } catch (error) {
        toast(`匹配失败：${error.message}`, 6200);
      } finally { setBusy(button, false); }
    }));
    list.querySelectorAll('[data-upgrade-select]').forEach(input => input.addEventListener('change', () => {
      const songId = Number(input.dataset.upgradeSelect);
      if (input.checked) state.upgradeSelected.add(songId);
      else state.upgradeSelected.delete(songId);
      updateUpgradeResultTools();
    }));
    list.querySelectorAll('[data-upgrade-download]').forEach(button => button.addEventListener('click', async () => {
      const songId = Number(button.dataset.upgradeDownload);
      const candidate = state.upgradeCandidates[songId]?.[Number(button.dataset.candidateIndex)];
      if (!candidate) return;
      await startDownload(candidate, button, {
        downloadOptions: { target_dir_input: $('upgradeTargetDir').value.trim() || '/LxBridge-Upgrades', create_artist_folder: false, filename_order: 'title_artist' },
        allowDowngrade: false,
        requireProbe: true,
        upgradeMeta: { source_song_id: songId, source_bitrate: state.upgradeSongs.find(song => song.id === songId)?.bitrate_kbps || 0, target_quality: $('upgradeQuality').value },
      });
    }));
  }

  function upgradeCandidateProbeMarkup(item) {
    if (item._probe_status === 'loading') return '<div class="upgrade-candidate-media muted">正在顺序探测格式、容量和码率…</div>';
    if (item._probe_status === 'failed') return `<div class="upgrade-candidate-media warning">媒体信息未知 · ${escapeHtml(item._probe_error || '探测失败')}</div>`;
    const probe = item._probe;
    if (!probe) return '<div class="upgrade-candidate-media muted">媒体信息尚未探测</div>';
    const quality = String(probe.actual_quality || probe.requested_quality || '').toLowerCase();
    const contentType = String(probe.content_type || '').split(';')[0];
    const subtype = contentType.includes('/') ? contentType.split('/').pop() : contentType;
    const format = quality.includes('flac') || subtype === 'flac' ? 'FLAC'
      : quality.includes('320') || /mpeg|mp3/.test(subtype) ? 'MP3'
        : (subtype || quality || '未知格式').toUpperCase();
    const bytes = Number(probe.total_bytes || 0);
    const duration = Number(item.duration || 0);
    let bitrate = 0;
    let approximate = false;
    if (bytes > 0 && duration > 0) {
      bitrate = Math.round((bytes * 8) / duration / 1000);
      approximate = true;
    } else {
      const qualityMatch = quality.match(/(\d{2,4})\s*k?/);
      bitrate = qualityMatch ? Number(qualityMatch[1]) : 0;
    }
    const size = bytes > 0 ? formatBytes(bytes) : '容量未知';
    const bitrateText = bitrate > 0 ? `${approximate ? '约 ' : ''}${bitrate} kbps` : '码率未知';
    const downgrade = probe.downgraded ? '<em>已降级</em>' : '';
    return `<div class="upgrade-candidate-media"><span>格式 <strong>${escapeHtml(format)}</strong></span><span>容量 <strong>${escapeHtml(size)}</strong></span><span>码率 <strong>${escapeHtml(bitrateText)}</strong></span>${downgrade}${probe.probe_error ? `<small title="${escapeHtml(probe.probe_error)}">容量探测受限</small>` : ''}</div>`;
  }

  function renderUpgradeStatistics(statistics) {
    const summary = $('upgradeScanSummary');
    const formats = $('upgradeFormatSummary');
    if (!statistics) {
      summary.classList.add('hidden');
      formats.classList.add('hidden');
      return;
    }
    const ranges = statistics.ranges || {};
    const entries = [
      ['歌曲库总数', statistics.library_total],
      ['本地歌曲', statistics.local_total],
      ['远程/其他', statistics.remote_total],
      ['有效本地路径', statistics.local_with_path],
      ['码率已识别', statistics.bitrate_known],
      ['码率未知', statistics.bitrate_unknown],
      ['重新探测获得', statistics.bitrate_from_probe],
      ['其中估算值', statistics.bitrate_estimated],
      ['< 192 kbps', ranges.below_192],
      ['192～319 kbps', ranges.from_192_to_319],
      ['320～499 kbps', ranges.from_320_to_499],
      ['≥ 500 kbps', ranges.at_least_500],
    ];
    summary.innerHTML = entries.map(([label, value]) => `<div class="upgrade-stat"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div>`).join('');
    summary.classList.remove('hidden');
    const formatItems = Array.isArray(statistics.formats) ? statistics.formats : [];
    formats.innerHTML = `<span class="upgrade-format-chip"><strong>本地格式分布</strong></span>${formatItems.map(item => `<span class="upgrade-format-chip">${escapeHtml(item.format)} · ${Number(item.count || 0)}</span>`).join('')}`;
    formats.classList.remove('hidden');
  }

  function renderUnknownSongs() {
    const section = $('upgradeUnknownSection');
    const list = $('upgradeUnknownList');
    const button = $('toggleUnknownSongs');
    const songs = state.upgradeUnknownSongs;
    if (!songs.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    $('upgradeUnknownCount').textContent = state.upgradeUnknownTotal > songs.length
      ? `显示 ${songs.length} / 共 ${state.upgradeUnknownTotal} 首`
      : `${songs.length} 首`;
    list.innerHTML = songs.map(song => `<div class="upgrade-unknown-item" title="${escapeHtml(song.file_path || '')}">
      <strong>${escapeHtml(song.title || '未知歌曲')} · ${escapeHtml(song.artist || '未知歌手')}</strong>
      <span>${escapeHtml(String(song.format || '未知格式').toUpperCase())} · ${formatDuration(song.duration)}</span>
      <span>${formatBytes(song.file_size)}</span>
      <span>${escapeHtml(song.file_path || '无本地路径')}</span>
    </div>`).join('');
    list.classList.toggle('hidden', !state.upgradeUnknownExpanded);
    button.textContent = state.upgradeUnknownExpanded ? '收起列表' : '展开列表';
  }

  async function scanUpgradeSongs() {
    const button = $('scanUpgradeSongs');
    setBusy(button, true, '扫描中');
    try {
      const bitrate = Number($('upgradeMaxBitrate').value || 320);
      const resp = await request(`/api/upgrade/scan?max_bitrate=${encodeURIComponent(bitrate)}&limit=500`);
      state.upgradeSongs = resp.data?.songs || [];
      state.upgradeScanned = true;
      state.upgradeUnknownSongs = resp.data?.unknown_songs || [];
      state.upgradeUnknownTotal = Number(resp.data?.statistics?.bitrate_unknown || state.upgradeUnknownSongs.length);
      state.upgradeCandidates = {};
      state.upgradeSelected = new Set(state.upgradeSongs.map(song => Number(song.id)));
      $('upgradeScanState').textContent = `找到 ${state.upgradeSongs.length} 首严格低于 ${bitrate} kbps、具有本地路径且码率已识别的歌曲；恰好 ${bitrate} kbps 不计入。`;
      renderUpgradeStatistics(resp.data?.statistics);
      renderUnknownSongs();
      renderUpgradeSongs();
    } catch (error) {
      $('upgradeScanState').textContent = `扫描失败：${error.message}`;
      renderUpgradeStatistics(null);
      toast(error.message, 6200);
    } finally { setBusy(button, false); }
  }

  async function probeUnknownBitrates() {
    const button = $('probeUnknownBitrates');
    setBusy(button, true, '探测中…');
    $('upgradeScanState').textContent = '正在低并发读取本地音频信息，请勿重复操作…';
    try {
      const resp = await request('/api/upgrade/probe-unknown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: Number($('probeBatchSize').value || 50),
          concurrency: Number($('probeConcurrency').value || 2),
        }),
      });
      const result = resp.data || {};
      const failureHint = Number(result.failed || 0) > 0
        ? `，${Number(result.failed)} 首失败并继续保持未知`
        : '';
      toast(`探测完成：精确 ${Number(result.exact || 0)} 首，估算 ${Number(result.estimated || 0)} 首${failureHint}`, 6200);
      await scanUpgradeSongs();
      const firstFailure = Array.isArray(result.failures) && result.failures[0]
        ? ` 首个失败原因：${result.failures[0].error}`
        : '';
      $('upgradeScanState').textContent += ` 本批处理 ${Number(result.processed || 0)} 首：精确 ${Number(result.exact || 0)} 首，估算 ${Number(result.estimated || 0)} 首，失败 ${Number(result.failed || 0)} 首；当前仍有 ${Number(result.remaining || 0)} 首未知。${firstFailure}`;
      await loadProbeToolStatus();
    } catch (error) {
      $('upgradeScanState').textContent = `重新探测失败：${error.message}`;
      toast(error.message, 7200);
    } finally { setBusy(button, false); }
  }

  function renderProbeToolStatus(status) {
    const label = $('probeToolStatus');
    const install = $('installProbeTool');
    const remove = $('removeProbeTool');
    if (!status?.available) {
      label.className = 'probe-tool-alert unavailable';
      label.innerHTML = '<span class="probe-tool-dot"></span><span><strong>ffprobe 不可用</strong><small>点击重新探测时会尝试自动安装，失败后改用估算码率。</small></span><em class="probe-status-badge">不可用</em>';
      install.classList.remove('hidden');
      remove.classList.add('hidden');
      return;
    }
    const source = status.source === 'plugin' ? '插件私有版' : 'Songloft 容器提供';
    const systemExtra = status.source === 'plugin' && status.system_available
      ? `；同时检测到容器版本：${status.system_version || 'ffprobe 可用'}`
      : '';
    label.className = 'probe-tool-alert available';
    label.innerHTML = `<span class="probe-tool-dot"></span><span><strong>${status.source === 'plugin' ? '插件私有 ffprobe 可用' : '容器 ffprobe 可用'}</strong><small>${escapeHtml(status.version || source)}${escapeHtml(systemExtra)}</small></span><em class="probe-status-badge">正常</em>`;
    install.classList.add('hidden');
    remove.classList.toggle('hidden', status.source !== 'plugin');
  }

  async function loadProbeToolStatus() {
    const button = $('refreshProbeTool');
    if (button) setBusy(button, true, '检测中…');
    try {
      const resp = await request('/api/upgrade/probe-tool');
      renderProbeToolStatus(resp.data);
    } catch (error) {
      const label = $('probeToolStatus');
      label.className = 'probe-tool-alert unavailable';
      label.innerHTML = `<span class="probe-tool-dot"></span><span><strong>ffprobe 检测失败</strong><small>${escapeHtml(error.message)}</small></span><em class="probe-status-badge">不可用</em>`;
    } finally { if (button) setBusy(button, false); }
  }

  async function installProbeTool() {
    const button = $('installProbeTool');
    setBusy(button, true, '下载中…');
    try {
      const resp = await request('/api/upgrade/probe-tool/install', { method: 'POST' });
      toast('插件私有 ffprobe 已安装，不需要修改 Songloft 镜像。', 5200);
      await loadProbeToolStatus();
      return resp.data;
    } catch (error) {
      toast(`安装失败：${error.message}`, 7200);
    } finally { setBusy(button, false); }
  }

  async function removeProbeTool() {
    const button = $('removeProbeTool');
    setBusy(button, true, '删除中…');
    try {
      await request('/api/upgrade/probe-tool', { method: 'DELETE' });
      toast('插件私有 ffprobe 已删除。', 4200);
      await loadProbeToolStatus();
    } catch (error) {
      toast(`删除失败：${error.message}`, 6200);
    } finally { setBusy(button, false); }
  }

  async function batchMatchUpgradeSongs() {
    const songs = state.upgradeSongs.filter(song => state.upgradeSelected.has(Number(song.id)));
    if (!songs.length) return toast('请先勾选需要匹配的歌曲');
    if (!confirm(`将逐首搜索 ${songs.length} 首歌曲，并自动选择每首匹配分最高的安全候选。\n\n搜索请求不会并发，每首之间等待 1 秒，是否继续？`)) return;
    const button = $('batchMatchUpgradeSongs');
    setBusy(button, true, `匹配 0/${songs.length}`);
    let matched = 0;
    let failed = 0;
    try {
      for (let index = 0; index < songs.length; index += 1) {
        const song = songs[index];
        $('upgradeScanState').textContent = `正在批量匹配 ${index + 1}/${songs.length}：《${song.title}》；请求逐首执行并保留安全间隔。`;
        try {
          const candidates = await requestUpgradeCandidates(Number(song.id));
          state.upgradeCandidates[song.id] = candidates;
          if (candidates.length) matched += 1;
          else failed += 1;
        } catch {
          state.upgradeCandidates[song.id] = [];
          failed += 1;
        }
        setBusy(button, true, `匹配 ${index + 1}/${songs.length}`);
        renderUpgradeSongs();
        if (index < songs.length - 1) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      $('upgradeScanState').textContent = `批量匹配完成：${matched} 首已选择匹配分最高的安全候选，${failed} 首没有合格候选。`;
      toast(`批量匹配完成：最佳候选 ${matched} 首，无合格候选 ${failed} 首`, 6200);
    } finally {
      setBusy(button, false);
    }
  }

  async function batchDownloadUpgradeSongs() {
    const songs = state.upgradeSongs.filter(song => state.upgradeSelected.has(Number(song.id)) && state.upgradeCandidates[song.id]?.[0]);
    if (!songs.length) return toast('没有已匹配的最佳候选，请先执行批量匹配');
    if (!confirm(`将为 ${songs.length} 首歌曲下载各自匹配分最高的安全候选。\n\n目标音质：${$('upgradeQuality').selectedOptions[0]?.textContent || $('upgradeQuality').value}\n保存目录：${resolvedDownloadPath($('upgradeTargetDir').value)}\n\n任务会串行执行并遵守下载安全间隔，是否继续？`)) return;
    const button = $('batchDownloadUpgradeSongs');
    setBusy(button, true, `加入 0/${songs.length}`);
    try {
      for (let index = 0; index < songs.length; index += 1) {
        const song = songs[index];
        const candidate = state.upgradeCandidates[song.id][0];
        $('upgradeScanState').textContent = `正在处理最佳候选 ${index + 1}/${songs.length}：《${song.title}》。`;
        await startDownload(candidate, null, {
          downloadOptions: { target_dir_input: $('upgradeTargetDir').value.trim() || '/LxBridge-Upgrades', create_artist_folder: false, filename_order: 'title_artist' },
          skipConfirm: true,
          allowDowngrade: false,
          requireProbe: true,
          upgradeMeta: { source_song_id: Number(song.id), source_bitrate: song.bitrate_kbps || 0, target_quality: $('upgradeQuality').value },
        });
        setBusy(button, true, `加入 ${index + 1}/${songs.length}`);
      }
      $('upgradeScanState').textContent = `已处理 ${songs.length} 首最佳候选，下载任务将按照安全间隔串行执行。`;
      toast(`已将 ${songs.length} 首最佳候选加入安全下载队列`, 6200);
      activateTab('downloads');
      loadDownloads();
    } finally {
      setBusy(button, false);
    }
  }

  $('scanUpgradeSongs').addEventListener('click', scanUpgradeSongs);
  $('upgradeSearch').addEventListener('input', event => {
    state.upgradeSearch = event.target.value;
    renderUpgradeSongs();
  });
  $('toggleUpgradeSelection').addEventListener('click', () => {
    const visibleIds = filteredUpgradeSongs().map(song => Number(song.id));
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => state.upgradeSelected.has(id));
    visibleIds.forEach(id => allSelected ? state.upgradeSelected.delete(id) : state.upgradeSelected.add(id));
    $('toggleUpgradeSelection').textContent = allSelected ? '全选当前结果' : '取消当前全选';
    renderUpgradeSongs();
  });
  $('batchMatchUpgradeSongs').addEventListener('click', batchMatchUpgradeSongs);
  $('batchDownloadUpgradeSongs').addEventListener('click', batchDownloadUpgradeSongs);
  $('probeUnknownBitrates').addEventListener('click', probeUnknownBitrates);
  $('refreshProbeTool').addEventListener('click', loadProbeToolStatus);
  $('installProbeTool').addEventListener('click', installProbeTool);
  $('removeProbeTool').addEventListener('click', removeProbeTool);
  const savedProbeBatchSize = localStorage.getItem('neo-lxbridge:probeBatchSize') || '50';
  const savedProbeConcurrency = localStorage.getItem('neo-lxbridge:probeConcurrency') || '2';
  if ([...$('probeBatchSize').options].some(option => option.value === savedProbeBatchSize)) $('probeBatchSize').value = savedProbeBatchSize;
  if ([...$('probeConcurrency').options].some(option => option.value === savedProbeConcurrency)) $('probeConcurrency').value = savedProbeConcurrency;
  $('probeBatchSize').addEventListener('change', event => localStorage.setItem('neo-lxbridge:probeBatchSize', event.target.value));
  $('probeConcurrency').addEventListener('change', event => localStorage.setItem('neo-lxbridge:probeConcurrency', event.target.value));
  $('toggleUnknownSongs').addEventListener('click', () => {
    state.upgradeUnknownExpanded = !state.upgradeUnknownExpanded;
    renderUnknownSongs();
  });
  loadProbeToolStatus();
  $('upgradeTargetDir').addEventListener('input', () => {
    $('upgradeResolvedPath').textContent = resolvedDownloadPath($('upgradeTargetDir').value);
  });

  function downloadStatusLabel(status) {
    return { pending: '等待解析', resolving: '解析中', queued: '等待下载', downloading: '下载中', verifying: '校验中', completed: '下载完成', failed: '失败' }[status] || status;
  }

  function downloadStatusText(job) {
    if (job.status === 'queued' && Number(job.wait_until) > Date.now()) {
      return `安全间隔 · ${Math.max(1, Math.ceil((Number(job.wait_until) - Date.now()) / 1000))} 秒`;
    }
    return downloadStatusLabel(job.status);
  }

  function renderDownloads() {
    const list = $('downloadList');
    if (!list) return;
    const filter = $('downloadFilter')?.value || 'all';
    const jobs = state.downloadTaskList.filter(job => {
      if (filter === 'active') return ['pending', 'resolving', 'queued', 'downloading', 'verifying'].includes(job.status);
      return filter === 'all' || job.status === filter;
    });
    const counts = state.downloadTaskList.reduce((result, job) => {
      result.total += 1;
      if (['pending', 'resolving', 'queued', 'downloading', 'verifying'].includes(job.status)) result.active += 1;
      if (job.status === 'completed') result.completed += 1;
      if (job.status === 'failed') result.failed += 1;
      return result;
    }, { total: 0, active: 0, completed: 0, failed: 0 });
    $('downloadSummary').innerHTML = [
      ['全部', counts.total], ['进行中', counts.active], ['已完成', counts.completed], ['失败', counts.failed],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('downloadCount').textContent = String(counts.active);
    $('downloadCount').classList.toggle('hidden', counts.active === 0);
    if (!jobs.length) {
      list.innerHTML = `<div class="empty-state compact-empty"><strong>没有符合条件的任务</strong><p>新的下载任务会自动显示在这里。</p></div>`;
      return;
    }
    list.innerHTML = jobs.map(job => {
      const details = [
        job.artist || '',
        job.actual_quality ? `音质 ${job.actual_quality}` : '',
        job.total_bytes == null ? '大小未知' : formatBytes(job.total_bytes),
        new Date(job.created_at).toLocaleString(),
      ].filter(Boolean).map(escapeHtml).join(' · ');
      const statusClass = `status-${escapeHtml(job.status)}`;
      return `<article class="download-item">
        <div class="download-main">
          <div class="download-title-row">
            <strong>${escapeHtml(job.title || '未知歌曲')}</strong>
            <span class="download-status ${statusClass}">${escapeHtml(downloadStatusText(job))}</span>
          </div>
          <p>${details}</p>
          <div class="download-progress ${job.status === 'downloading' ? 'is-indeterminate' : ''}" role="progressbar" aria-label="${escapeHtml(downloadStatusText(job))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, Number(job.progress || 0)))}">
            <span style="width:${Math.max(0, Math.min(100, Number(job.progress || 0)))}%"></span>
          </div>
          ${job.status_detail ? `<p class="download-stage-detail">${escapeHtml(job.status_detail)}</p>` : ''}
          ${job.error ? `<p class="download-error">${escapeHtml(job.error)}</p>` : ''}
          ${job.verification_message ? `<p class="${job.verification_status === 'passed' ? 'download-verification-passed' : 'download-verification-warning'}">${escapeHtml(job.verification_message)}</p>` : ''}
          ${job.path ? `<p class="download-path" title="${escapeHtml(job.path)}">${escapeHtml(job.path)}</p>` : ''}
        </div>
        <div class="download-actions">
          ${job.status === 'failed' && Number(job.song_id) > 0 ? `<button class="secondary" type="button" data-download-retry="${escapeHtml(job.id)}">重试</button>` : ''}
          ${job.path ? `<button class="secondary" type="button" data-download-copy="${escapeHtml(job.path)}">复制路径</button>` : ''}
          ${['pending', 'resolving', 'queued'].includes(job.status) ? `<button class="danger-button" type="button" data-download-remove="${escapeHtml(job.id)}" data-download-remove-kind="cancel">取消任务</button>` : ''}
          ${['completed', 'failed'].includes(job.status) ? `<button class="danger-button" type="button" data-download-remove="${escapeHtml(job.id)}" data-download-remove-kind="record">删除记录</button>` : ''}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-download-retry]').forEach(button => button.addEventListener('click', async () => {
      try {
        await request('/api/songs/download/retry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: button.dataset.downloadRetry }),
        });
        toast('已重新加入下载队列');
        loadDownloads();
      } catch (error) { toast(error.message, 5200); }
    }));
    list.querySelectorAll('[data-download-remove]').forEach(button => button.addEventListener('click', async () => {
      try {
        const cancelling = button.dataset.downloadRemoveKind === 'cancel';
        await request(`/api/songs/download?id=${encodeURIComponent(button.dataset.downloadRemove)}`, { method: 'DELETE' });
        if (cancelling) toast('已取消下载任务');
        loadDownloads();
      } catch (error) { toast(error.message, 5200); }
    }));
    list.querySelectorAll('[data-download-copy]').forEach(button => button.addEventListener('click', () => copyText(button.dataset.downloadCopy)));
  }

  async function loadDownloads() {
    clearTimeout(state.downloadManagerTimer);
    try {
      const resp = await request('/api/songs/download');
      state.downloadTaskList = resp.data?.jobs || [];
      state.downloadTaskList.forEach(job => { if (job.client_key) state.downloadJobs[job.client_key] = job; });
      renderDownloads();
      renderResults();
      if (state.downloadTaskList.some(job => ['pending', 'resolving', 'queued', 'downloading', 'verifying'].includes(job.status))) {
        state.downloadManagerTimer = setTimeout(loadDownloads, 1400);
      }
    } catch (error) {
      toast(`加载下载任务失败：${error.message}`, 5200);
    }
  }

  async function probeDownload(item, allowDowngrade = allowAutoDowngrade()) {
    const requestedQuality = String(item.source_data?.quality || $('quality').value || '320k');
    const resp = await request('/api/direct/music/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: item.source_data?.platform,
        songInfo: item.source_data?.songInfo,
        quality: requestedQuality,
        allow_downgrade: allowDowngrade,
      }),
    });
    return { requestedQuality, ...(resp.data || {}) };
  }

  function clearDownloadPoller(key) {
    const timer = state.downloadPollers[key];
    if (timer) clearTimeout(timer);
    delete state.downloadPollers[key];
  }

  function resolvedDownloadPath(input) {
    const value = String(input || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!value) return 'Songloft 默认 downloads 目录';
    if (value === '/app/music' || value.startsWith('/app/music/')) return value;
    return `/app/music/${value.replace(/^\/+/, '')}`;
  }

  function currentDownloadOptions() {
    return {
      target_dir_input: state.downloadSettings.target_dir_input || '',
      create_artist_folder: Boolean(state.downloadSettings.create_artist_folder),
      filename_order: state.downloadSettings.filename_order || 'title_artist',
    };
  }

  function updateDownloadModalPreview() {
    $('downloadModalResolvedPath').textContent = `最终实际路径：${resolvedDownloadPath($('downloadModalTargetDir').value)}`;
  }

  function closeDownloadModal(result = null) {
    $('downloadModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    const resolve = state.downloadModalResolve;
    state.downloadModalResolve = null;
    if (resolve) resolve(result);
  }

  function openDownloadModal({ count = 1, item = null, probe = null } = {}) {
    if (state.downloadModalResolve) closeDownloadModal(null);
    const defaults = currentDownloadOptions();
    $('downloadModalTargetDir').value = defaults.target_dir_input;
    $('downloadModalArtistFolder').checked = defaults.create_artist_folder;
    $('downloadModalFilenameOrder').value = defaults.filename_order;
    $('downloadModalSaveDefault').checked = false;
    const size = probe?.total_bytes == null ? '大小未知' : formatBytes(probe.total_bytes);
    $('downloadModalSummary').textContent = count > 1
      ? `本批共 ${count} 首歌曲，只需选择一次目录和命名规则。`
      : `《${item?.title || '歌曲'}》 · ${probe ? `${probe.actual_quality || probe.requestedQuality} · ${size}` : '请选择本次下载设置'}`;
    updateDownloadModalPreview();
    $('downloadModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    return new Promise(resolve => { state.downloadModalResolve = resolve; });
  }

  $('downloadModalTargetDir').addEventListener('input', updateDownloadModalPreview);
  $('closeDownloadModal').addEventListener('click', () => closeDownloadModal(null));
  $('cancelDownloadModal').addEventListener('click', () => closeDownloadModal(null));
  $('downloadModal').addEventListener('click', event => { if (event.target === $('downloadModal')) closeDownloadModal(null); });
  $('confirmDownloadModal').addEventListener('click', async () => {
    const options = {
      target_dir_input: $('downloadModalTargetDir').value.trim(),
      create_artist_folder: $('downloadModalArtistFolder').checked,
      filename_order: $('downloadModalFilenameOrder').value,
    };
    if ($('downloadModalSaveDefault').checked) {
      try {
        const resp = await saveDownloadPathSettings(options);
        Object.assign(options, {
          target_dir_input: resp.target_dir_input,
          create_artist_folder: resp.create_artist_folder,
          filename_order: resp.filename_order,
        });
      } catch (error) {
        toast(error.message, 5200);
        return;
      }
    }
    closeDownloadModal(options);
  });

  $('batchDownloadButton').addEventListener('click', async () => {
    if (!state.selected.length) return;
    const button = $('batchDownloadButton');
    const options = await openDownloadModal({ count: state.selected.length });
    if (!options) return;
    setBusy(button, true, '正在创建任务');
    const items = [...state.selected];
    try {
      const resp = await request('/api/songs/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songs: items.map(item => ({ ...item, _download_client_key: selectedKey(item) })),
          download_options: options,
          quality: $('quality').value || '320k',
          allow_downgrade: allowAutoDowngrade(),
        }),
      });
      const jobs = resp.data?.jobs || [];
      jobs.forEach((job, index) => {
        state.downloadTaskList.unshift(job);
        if (items[index]) state.downloadJobs[selectedKey(items[index])] = job;
      });
      toast(`已创建 ${jobs.length} 条下载任务，正在后台逐首解析`, 5200);
      activateTab('downloads');
      loadDownloads();
    } finally {
      setBusy(button, false);
    }
  });

  function pollDownload(item, jobId) {
    const key = selectedKey(item);
    clearDownloadPoller(key);
    const check = async () => {
      try {
        const resp = await request(`/api/songs/download?id=${encodeURIComponent(jobId)}`);
        const job = resp.data?.job;
        if (!job) throw new Error('下载任务状态无效');
        setDownloadJob(item, job);
        if (job.status === 'completed') {
          clearDownloadPoller(key);
          const message = job.already_downloaded
            ? `《${item.title}》已经下载到本地音乐库`
            : `《${item.title}》下载完成${job.path ? `：${job.path}` : ''}`;
          toast(message, 6200);
          return;
        }
        if (job.status === 'failed') {
          clearDownloadPoller(key);
          toast(`下载《${item.title}》失败：${job.error || '未知错误'}`, 6200);
          return;
        }
        state.downloadPollers[key] = setTimeout(check, 1200);
      } catch (error) {
        clearDownloadPoller(key);
        state.downloadJobs[key] = { id: jobId, status: 'failed', error: error.message };
        renderResults();
        toast(`查询下载状态失败：${error.message}`, 5200);
      }
    };
    state.downloadPollers[key] = setTimeout(check, 600);
  }

  async function startDownload(item, button, behavior = {}) {
    const key = selectedKey(item);
    const current = state.downloadJobs[key];
    if (current && ['queued', 'downloading', 'completed'].includes(current.status)) return;

    setBusy(button, true, '探测中');
    try {
      let probe = null;
      const allowDowngrade = behavior.allowDowngrade ?? allowAutoDowngrade();
      try {
        probe = await probeDownload(item, allowDowngrade);
      } catch (error) {
        if (behavior.requireProbe) throw new Error(`高音质探测失败，安全洗版已停止：${error.message}`);
        if (!behavior.skipConfirm) toast(`未能提前探测《${item.title}》的文件信息，仍可在确认目录后继续下载：${error.message}`, 5200);
      }
      let downloadOptions = behavior.downloadOptions || currentDownloadOptions();
      if (probe) {
        const actualQuality = probe.actual_quality || probe.requestedQuality;
        item.source_data.requested_quality = probe.requestedQuality;
        item.source_data.quality = actualQuality;
        item.source_data.allow_downgrade = allowDowngrade;
      }
      if (!behavior.downloadOptions) {
        downloadOptions = await openDownloadModal({ item, probe });
        if (!downloadOptions) return;
      }
      setBusy(button, true, '准备中');
      const resp = await request('/api/songs/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          song: item,
          fetch_lyric: true,
          download_meta: probe ? {
            total_bytes: probe.total_bytes,
            actual_quality: probe.actual_quality || probe.requestedQuality,
            content_type: probe.content_type || '',
          } : {},
          download_options: downloadOptions,
          upgrade_meta: behavior.upgradeMeta || undefined,
        }),
      });
      const job = resp.data?.job;
      if (!job?.id) throw new Error('未创建下载任务');
      if (probe) {
        job.total_bytes = probe.total_bytes;
        job.actual_quality = probe.actual_quality || probe.requestedQuality;
        job.content_type = probe.content_type || '';
      }
      setDownloadJob(item, job);
      if (job.status === 'completed') {
        const message = job.already_downloaded
          ? `《${item.title}》已经存在于本地音乐库`
          : `《${item.title}》下载完成${job.path ? `：${job.path}` : ''}`;
        toast(message, 6200);
        return;
      }
      const sizeText = probe?.total_bytes == null ? '' : `，文件大小 ${formatBytes(probe.total_bytes)}`;
      toast(`已将《${item.title}》加入下载队列${sizeText}，完成后会保存到 Songloft 音乐目录`, 4800);
      pollDownload(item, job.id);
    } catch (error) {
      state.downloadJobs[key] = { status: 'failed', error: error.message };
      renderResults();
      toast(`下载失败：${error.message}`, 6200);
    } finally {
      setBusy(button, false);
    }
  }

  function updatePlayerDock(item, url) {
    const dock = $('playerDock');
    $('playerTitle').textContent = item?.title || '未在播放';
    $('playerMeta').textContent = item ? `${item.artist || '未知歌手'} · ${platformNames[item.source_data?.platform] || item.source_data?.platform || '未知平台'}` : '点击搜索结果中的“播放”按钮即可试听。';
    dock.classList.toggle('hidden', !url);
  }

  async function playPreview(item, button) {
    const audio = $('previewAudio');
    const key = selectedKey(item);

    if (state.playingKey === key && audio.src) {
      if (audio.paused) await audio.play().catch(error => { throw error; });
      else audio.pause();
      renderResults();
      return;
    }

    setBusy(button, true, '解析中');
    try {
      const requestedQuality = String(item.source_data?.quality || $('quality').value || '320k');
      const resp = await request('/api/direct/music/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: item.source_data?.platform,
          songInfo: item.source_data?.songInfo,
          quality: requestedQuality,
          allow_downgrade: allowAutoDowngrade(),
        }),
      });
      const resolved = resp.data || {};
      if (!resolved.url) throw new Error('未获取到可播放地址');
      const actualQuality = resolved.actualQuality || requestedQuality;
      item.source_data.quality = actualQuality;
      const playback = await playResolvedAudio(audio, resolved);
      state.playingKey = key;
      state.playingItem = item;
      updatePlayerDock(item, playback.url);
      if (resolved.downgraded) {
        toast(`目标音质 ${requestedQuality} 不可用，已自动降级为 ${actualQuality}`, 5200);
      } else if (playback.proxied && showCompatibilityNotice() && !state.compatibilityNoticeShown) {
        state.compatibilityNoticeShown = true;
        toast('已通过 Songloft 兼容代理播放，适配 App、HTTP 地址及跨域重定向。', 4200);
      }
      renderResults();
    } catch (error) {
      audio.pause();
      state.playingKey = '';
      state.playingItem = null;
      updatePlayerDock(null, '');
      renderResults();
      toast(error.message || '播放失败', 5200);
    } finally {
      setBusy(button, false);
    }
  }

  function closePlayer() {
    const audio = $('previewAudio');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.playingKey = '';
    state.playingItem = null;
    updatePlayerDock(null, '');
    renderResults();
  }

  $('previewAudio').addEventListener('pause', () => renderResults());
  $('previewAudio').addEventListener('play', () => renderResults());
  $('previewAudio').addEventListener('ended', () => renderResults());
  $('closePlayer').addEventListener('click', closePlayer);

  function sourcePlatforms(item) {
    const platforms = Object.keys(item.sources || item.platforms || {});
    if (!platforms.length) return '';
    return `<span class="source-platforms">${platforms.map(id => `<span class="badge">${escapeHtml(platformNames[id] || id)}</span>`).join('')}</span>`;
  }

  async function exportSource(item, button) {
    const token = getAuthToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const path = `/api/sources/export?id=${encodeURIComponent(item.id)}`;
    const url = withAccessToken(`${root}${path}`, token);
    setBusy(button, true, '导出中');
    try {
      const response = await fetch(url, { headers, credentials: 'same-origin' });
      if (!response.ok) {
        const text = await response.text();
        let message = `HTTP ${response.status}`;
        try { message = JSON.parse(text)?.msg || message; } catch {}
        throw new Error(message);
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = item.filename || `${item.id}.js`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast(`已导出音源：${item.name}`);
    } catch (error) { toast(error.message, 5000); }
    finally { setBusy(button, false); }
  }

  async function loadSources() {
    try {
      const resp = await request('/api/sources');
      const data = resp.data || {};
      const list = data.sources || [];
      const enabledCount = list.filter(item => item.enabled && !item.error).length;
      setRuntimeStatus(enabledCount, data.loading === true);
      $('batchState').textContent = data.loading
        ? `正在初始化 ${data.batch_current_id || '音源'}，还有 ${data.batch_pending_ids?.length || 0} 个等待处理`
        : list.length ? `共 ${list.length} 个音源，已启用 ${enabledCount} 个` : '尚未导入任何音源';

      if (!list.length) {
        $('sourceList').innerHTML = `<div class="empty-state compact-empty">
          <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/></svg></div>
          <strong>还没有导入音源</strong><p>通过上方本地文件或 URL 添加洛雪音源脚本。</p>
        </div>`;
      } else {
        $('sourceList').innerHTML = list.map(item => `<article class="source-item">
          <div>
            <div class="source-title-row">
              <strong>${escapeHtml(item.name)}</strong>
              <span class="badge">v${escapeHtml(item.version || '未知')}</span>
              ${item.loading ? '<span class="spinner" title="初始化中"></span>' : ''}
            </div>
            <div class="source-meta">
              <span class="sub">${escapeHtml(item.author || '未知作者')}</span>
              ${sourcePlatforms(item)}
              ${item.error ? `<span class="sub source-error">${escapeHtml(item.error)}</span>` : ''}
            </div>
          </div>
          <label class="switch" title="启用或禁用音源">
            <input type="checkbox" data-toggle="${escapeHtml(item.id)}" ${item.enabled ? 'checked' : ''} ${item.loading ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
          <div class="source-actions">
            <button class="secondary" type="button" data-export="${escapeHtml(item.id)}">导出</button>
            <button class="danger-button" type="button" data-delete="${escapeHtml(item.id)}">删除</button>
          </div>
        </article>`).join('');
      }

      $('sourceList').querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
        const item = list.find(source => source.id === button.dataset.export);
        if (item) exportSource(item, button);
      }));

      $('sourceList').querySelectorAll('[data-toggle]').forEach(input => input.addEventListener('change', async event => {
        event.target.disabled = true;
        try {
          await request('/api/sources/toggle', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: event.target.dataset.toggle, enabled: event.target.checked }),
          });
          toast('音源状态已更新');
        } catch (error) { toast(error.message, 5000); }
        finally { loadSources(); loadStatus(); }
      }));

      $('sourceList').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('确定删除这个音源及其脚本吗？')) return;
        try {
          await request(`/api/sources?id=${encodeURIComponent(button.dataset.delete)}`, { method: 'DELETE' });
          toast('音源已删除');
          loadSources();
          loadStatus();
        } catch (error) { toast(error.message, 5000); }
      }));

      clearTimeout(state.pollTimer);
      if (data.loading) state.pollTimer = setTimeout(loadSources, 1500);
    } catch (error) { toast(error.message, 5000); }
  }

  const supportedSourceFile = file => /\.(?:js|zip)$/i.test(String(file?.name || ''));

  $('sourceFile').addEventListener('change', event => {
    const files = Array.from(event.target.files || []);
    const unsupported = files.filter(file => !supportedSourceFile(file));
    $('sourceFileLabel').textContent = unsupported.length
      ? `不支持：${unsupported.map(file => file.name).join('、')}`
      : files.length
      ? files.length === 1 ? files[0].name : `已选择 ${files.length} 个文件`
      : '选择 .js 或 .zip 文件';
    if (unsupported.length) toast('只支持 .js 或 .zip 文件，请重新选择', 4200);
  });

  $('uploadSource').addEventListener('click', async () => {
    const files = $('sourceFile').files;
    if (!files.length) return toast('请选择 .js 或 .zip 文件');
    const unsupported = Array.from(files).filter(file => !supportedSourceFile(file));
    if (unsupported.length) return toast(`不支持的文件：${unsupported.map(file => file.name).join('、')}`, 5200);
    const form = new FormData();
    Array.from(files).forEach(file => form.append('file', file));
    const button = $('uploadSource');
    setBusy(button, true, '上传中');
    try {
      const resp = await request('/api/sources/import', { method: 'POST', body: form });
      toast(resp.warning || '音源已导入');
      $('sourceFile').value = '';
      $('sourceFileLabel').textContent = '选择 .js 或 .zip 文件';
      loadSources();
      loadStatus();
    } catch (error) { toast(error.message, 5200); }
    finally { setBusy(button, false); }
  });

  $('importUrl').addEventListener('click', async () => {
    const url = $('sourceUrl').value.trim();
    if (!url) return toast('请输入音源 URL');
    const button = $('importUrl');
    setBusy(button, true, '下载中');
    try {
      const resp = await request('/api/sources/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      toast(resp.warning || '音源已导入');
      $('sourceUrl').value = '';
      loadSources();
      loadStatus();
    } catch (error) { toast(error.message, 5200); }
    finally { setBusy(button, false); }
  });

  function updateExternalExample(quality) {
    const endpoint = `${location.origin}${root}/external/search`;
    $('externalEndpoint').value = endpoint;
    $('toponeEndpoint').value = `${location.origin}${root}/api/search/topone`;
    $('bestEndpoint').value = `${location.origin}${root}/api/search/best`;
    $('externalExample').textContent = `// 请求头
Content-Type: application/json

// 请求体
${JSON.stringify({
      keyword: '晴天',
      hint: {
        title: '晴天',
        artist: '周杰伦',
        duration: 269,
      },
      source_id: 'all',
      quality,
      limit: 10,
    }, null, 2)}

// 成功响应
${JSON.stringify({
      code: 0,
      msg: 'success',
      data: [{
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        duration: 269,
        cover_url: 'https://example.com/cover.jpg',
        url: 'https://example.com/song.mp3',
        headers: { Referer: 'https://example.com/' },
        platform: 'kw',
        quality,
        source_data: {
          platform: 'kw',
          quality,
          songInfo: { /* 平台原始歌曲信息 */ },
        },
      }],
    }, null, 2)}

// cURL 示例
curl -X POST "${endpoint}" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"晴天","quality":"${quality}","source_id":"all","limit":10}'`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板');
    } catch {
      const input = document.createElement('textarea');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      toast('已复制到剪贴板');
    }
  }

  $('copyExternalEndpoint').addEventListener('click', () => copyText($('externalEndpoint').value));
  $('copyToponeEndpoint').addEventListener('click', () => copyText($('toponeEndpoint').value));
  $('copyBestEndpoint').addEventListener('click', () => copyText($('bestEndpoint').value));

  function renderLxSyncSettings(settings) {
    state.lxSyncSettings = settings || {};
    $('lxSyncEnabled').checked = Boolean(settings?.enabled);
    $('lxSyncServerName').value = settings?.serverName || 'Songloft LxBridge';
    $('lxSyncPassword').value = settings?.password || '';
    $('lxSyncCustomAddress').value = settings?.customServerAddress || '';
    const detectedAddresses = Array.isArray(settings?.serverAddresses) ? settings.serverAddresses : [];
    const customAddress = String(settings?.customServerAddress || '');
    const browserAddress = `${location.origin}${root}`.replace(/\/$/, '');
    const browserIsLocal = /:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(browserAddress);
    const addresses = [...new Set([
      ...(customAddress ? [customAddress] : []),
      ...(!browserIsLocal ? [browserAddress] : []),
      ...detectedAddresses,
      ...(browserIsLocal ? [browserAddress] : []),
    ])];
    $('lxSyncAddress').innerHTML = addresses.length
      ? addresses.map(address => {
          const local = /:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(address);
          const type = customAddress && address === customAddress
            ? '自定义'
            : address === browserAddress
              ? local ? '当前本机访问' : '当前访问（推荐）'
              : local ? '本机' : '容器探测';
          return `<option value="${escapeHtml(address)}">${type} · ${escapeHtml(address)}</option>`;
        }).join('')
      : '<option value="">暂未发现可用地址</option>';
    $('lxSyncConnectedCount').textContent = String(settings?.connectedCount || 0);
    $('lxSyncDeviceCount').textContent = String(settings?.devices?.length || 0);
    $('lxSyncMappedCount').textContent = String(settings?.mappedPlaylists || 0);
    $('lxSyncLastSync').textContent = settings?.lastSyncAt
      ? `上次同步：${new Date(settings.lastSyncAt).toLocaleString()}`
      : '尚未同步';
    $('lxSyncState').textContent = settings?.enabled
      ? '同步服务已开启。请确保防火墙和反向代理允许 WebSocket 连接。'
      : '同步服务默认关闭，开启并保存后才接受 LX Music 连接。';
  }

  async function loadLxSyncSettings() {
    try {
      const resp = await request('/api/settings/lx-sync');
      renderLxSyncSettings(resp.data);
    } catch (error) {
      $('lxSyncState').textContent = `读取同步设置失败：${error.message}`;
      $('lxSyncState').classList.add('is-warning');
    }
  }

  async function saveLxSyncSettings(extra = {}) {
    const resp = await request('/api/settings/lx-sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: $('lxSyncEnabled').checked,
        serverName: $('lxSyncServerName').value.trim(),
        customServerAddress: $('lxSyncCustomAddress').value.trim(),
        ...extra,
      }),
    });
    renderLxSyncSettings(resp.data);
    return resp.data;
  }

  $('copyLxSyncPassword').addEventListener('click', () => copyText($('lxSyncPassword').value));
  $('copyLxSyncAddress').addEventListener('click', () => copyText($('lxSyncAddress').value));
  $('resetLxSyncAddress').addEventListener('click', async () => {
    const button = $('resetLxSyncAddress');
    $('lxSyncCustomAddress').value = '';
    setBusy(button, true, '恢复中');
    try {
      await saveLxSyncSettings({ customServerAddress: '' });
      toast('已恢复自动探测地址');
    } catch (error) {
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });
  $('saveLxSyncSettings').addEventListener('click', async () => {
    const button = $('saveLxSyncSettings');
    setBusy(button, true, '保存中');
    try {
      await saveLxSyncSettings();
      toast('LX Music 同步设置已保存');
    } catch (error) {
      $('lxSyncState').textContent = `保存失败：${error.message}`;
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });
  $('regenerateLxSyncPassword').addEventListener('click', async () => {
    if (!confirm('重置密码会撤销全部已授权设备，并断开当前同步连接。确定继续吗？')) return;
    const button = $('regenerateLxSyncPassword');
    setBusy(button, true, '重置中');
    try {
      await saveLxSyncSettings({ regeneratePassword: true });
      toast('同步密码已重置，请在 LX Music 中重新连接');
    } catch (error) {
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });

  function downloadPathPayload(overrides = {}) {
    return {
      target_dir_input: $('downloadTargetDir').value.trim(),
      create_artist_folder: $('downloadCreateArtistFolder').checked,
      filename_order: $('downloadFilenameOrder').value,
      favorite_dirs: state.downloadSettings.favorite_dirs || [],
      ...overrides,
    };
  }

  function renderDownloadFavorites() {
    const list = $('downloadFavoriteList');
    const favorites = state.downloadSettings.favorite_dirs || [];
    list.innerHTML = favorites.length
      ? favorites.map((dir, index) => `<span class="favorite-directory-chip"><button type="button" data-use-favorite="${index}" title="使用此目录">${escapeHtml(dir)}</button><button type="button" data-remove-favorite="${index}" title="删除">×</button></span>`).join('')
      : '<span class="muted">暂未添加常用目录</span>';
    list.querySelectorAll('[data-use-favorite]').forEach(button => button.addEventListener('click', () => {
      $('downloadTargetDir').value = favorites[Number(button.dataset.useFavorite)] || '';
      updateDownloadDirectoryPreview();
    }));
    list.querySelectorAll('[data-remove-favorite]').forEach(button => button.addEventListener('click', () => {
      state.downloadSettings.favorite_dirs.splice(Number(button.dataset.removeFavorite), 1);
      renderDownloadFavorites();
      updateDirectorySuggestions();
    }));
  }

  function updateDirectorySuggestions() {
    const values = [...new Set([...(state.downloadSettings.favorite_dirs || []), ...state.discoveredDownloadDirs])];
    $('downloadDirectorySuggestions').innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  function updateDownloadDirectoryPreview() {
    const input = $('downloadTargetDir').value.trim();
    $('downloadDirectoryState').textContent = input
      ? `最终实际保存路径：${resolvedDownloadPath(input)}`
      : '当前使用 Songloft 默认 downloads 目录';
  }

  async function refreshDownloadDirectories(showMessage = false) {
    try {
      const resp = await request('/api/settings/download/directories');
      state.discoveredDownloadDirs = Array.isArray(resp.data?.discovered) ? resp.data.discovered : [];
      updateDirectorySuggestions();
      if (showMessage) toast(`已发现 ${state.discoveredDownloadDirs.length} 个包含歌曲的目录`);
    } catch (error) {
      if (showMessage) toast(`读取已有目录失败：${error.message}`, 5200);
    }
  }

  async function saveDownloadPathSettings(overrides = {}) {
    const resp = await request('/api/settings/download', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...downloadPathPayload(overrides), ...protectionPayload() }),
    });
    state.downloadSettings = { ...state.downloadSettings, ...(resp.data || {}) };
    return state.downloadSettings;
  }

  async function loadDownloadSettings() {
    try {
      const resp = await request('/api/settings/download');
      state.downloadSettings = { ...state.downloadSettings, ...(resp.data || {}) };
      $('downloadTargetDir').value = String(resp.data?.target_dir_input || '');
      $('downloadCreateArtistFolder').checked = Boolean(resp.data?.create_artist_folder);
      $('downloadFilenameOrder').value = resp.data?.filename_order || 'title_artist';
      $('downloadProtectionEnabled').checked = resp.data?.enabled !== false;
      $('downloadIntervalSeconds').value = String(Math.round(Number(resp.data?.download_interval_ms || 5000) / 1000));
      $('playbackIntervalSeconds').value = String(Math.round(Number(resp.data?.playback_interval_ms || 2000) / 1000));
      updateProtectionControls();
      showProtectionState(resp.data);
      updateDownloadDirectoryPreview();
      renderDownloadFavorites();
      updateDirectorySuggestions();
      refreshDownloadDirectories(false);
    } catch (error) {
      $('downloadDirectoryState').textContent = `读取下载目录失败：${error.message}`;
    }
  }

  $('downloadTargetDir').addEventListener('input', updateDownloadDirectoryPreview);
  $('refreshDownloadDirectories').addEventListener('click', () => refreshDownloadDirectories(true));
  $('addDownloadFavorite').addEventListener('click', () => {
    const value = $('downloadFavoriteInput').value.trim();
    if (!value) return;
    if (!(state.downloadSettings.favorite_dirs || []).includes(value)) state.downloadSettings.favorite_dirs.push(value);
    $('downloadFavoriteInput').value = '';
    renderDownloadFavorites();
    updateDirectorySuggestions();
  });

  function updateProtectionControls() {
    const enabled = $('downloadProtectionEnabled').checked;
    $('downloadIntervalSeconds').disabled = !enabled;
    $('playbackIntervalSeconds').disabled = !enabled;
    $('protectionIntervals').classList.toggle('is-disabled', !enabled);
  }

  function protectionPayload() {
    return {
      enabled: $('downloadProtectionEnabled').checked,
      download_interval_ms: Number($('downloadIntervalSeconds').value) * 1000,
      playback_interval_ms: Number($('playbackIntervalSeconds').value) * 1000,
    };
  }

  function showProtectionState(data, saved = false) {
    const enabled = data?.enabled !== false;
    $('protectionSettingsState').textContent = enabled
      ? `${saved ? '已保存' : '当前已开启'}：下载间隔 ${Number(data.download_interval_ms || 5000) / 1000} 秒，播放解析间隔 ${Number(data.playback_interval_ms || 2000) / 1000} 秒`
      : `${saved ? '已保存' : '当前'}：批量下载保护已关闭，下载仍保持串行但不再等待`;
  }

  $('downloadProtectionEnabled').addEventListener('change', updateProtectionControls);

  $('saveProtectionSettings').addEventListener('click', async () => {
    const button = $('saveProtectionSettings');
    setBusy(button, true, '保存中');
    try {
      const resp = await request('/api/settings/download', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...downloadPathPayload(), ...protectionPayload() }),
      });
      state.downloadSettings = { ...state.downloadSettings, ...(resp.data || {}) };
      $('downloadIntervalSeconds').value = String(Number(resp.data?.download_interval_ms || 5000) / 1000);
      $('playbackIntervalSeconds').value = String(Number(resp.data?.playback_interval_ms || 2000) / 1000);
      showProtectionState(resp.data, true);
      toast(resp.data?.enabled === false ? '批量下载保护已关闭，请注意音源请求风险' : '批量下载保护设置已保存');
    } catch (error) {
      $('protectionSettingsState').textContent = `保存失败：${error.message}`;
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });

  $('saveDownloadSettings').addEventListener('click', async () => {
    const button = $('saveDownloadSettings');
    setBusy(button, true, '保存中');
    try {
      const data = await saveDownloadPathSettings();
      $('downloadTargetDir').value = String(data.target_dir_input || '');
      updateDownloadDirectoryPreview();
      renderDownloadFavorites();
      toast(data.target_dir ? `下载设置已保存：${data.target_dir}` : '已恢复默认下载目录');
    } catch (error) {
      $('downloadDirectoryState').textContent = `保存失败：${error.message}`;
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });

  async function savePlaybackSettings(value, allowDowngrade, compatibilityNotice) {
    const resp = await request('/api/settings/playback', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_quality: value,
        allow_auto_downgrade: allowDowngrade,
        show_compatibility_notice: compatibilityNotice,
      }),
    });
    state.playbackSettings = resp.data;
    $('allowAutoDowngrade').checked = allowAutoDowngrade();
    $('showCompatibilityNotice').checked = showCompatibilityNotice();
    syncQualityControls(defaultQuality());
    return resp.data;
  }

  function legacyPlaybackSettings() {
    const qualityKeys = ['neo-lxbridge:defaultQuality', 'lxbridge:defaultQuality', 'lxmusic:defaultQuality'];
    const downgradeKeys = ['neo-lxbridge:allowAutoDowngrade', 'lxbridge:allowAutoDowngrade'];
    const quality = qualityKeys.map(key => localStorage.getItem(key)).find(Boolean) || '320k';
    const storedDowngrade = downgradeKeys.map(key => localStorage.getItem(key)).find(value => value != null);
    return { quality, allowDowngrade: storedDowngrade !== 'false' };
  }

  async function loadPlaybackSettings() {
    try {
      const resp = await request('/api/settings/playback');
      let settings = resp.data;
      if (!settings?.configured) {
        const legacy = legacyPlaybackSettings();
        settings = await savePlaybackSettings(legacy.quality, legacy.allowDowngrade, true);
        localStorage.removeItem('neo-lxbridge:defaultQuality');
        localStorage.removeItem('neo-lxbridge:allowAutoDowngrade');
      } else {
        state.playbackSettings = settings;
        $('allowAutoDowngrade').checked = allowAutoDowngrade();
        $('showCompatibilityNotice').checked = showCompatibilityNotice();
        syncQualityControls(defaultQuality());
      }
    } catch (error) {
      $('playbackSettingsState').textContent = `读取设置失败：${error.message}`;
      $('playbackSettingsState').classList.add('is-warning');
      toast(error.message, 5200);
    }
  }

  $('saveSettings').addEventListener('click', async () => {
    const button = $('saveSettings');
    const value = $('defaultQualitySetting').value || defaultQuality();
    setBusy(button, true, '保存中');
    try {
      await savePlaybackSettings(value, $('allowAutoDowngrade').checked, $('showCompatibilityNotice').checked);
      toast('播放设置已保存');
    } catch (error) {
      $('playbackSettingsState').textContent = `保存失败：${error.message}`;
      $('playbackSettingsState').classList.add('is-warning');
      toast(error.message, 5200);
    } finally {
      setBusy(button, false);
    }
  });
  $('quality').addEventListener('change', () => updateExternalExample($('quality').value));
  $('defaultQualitySetting').addEventListener('change', () => updateExternalExample($('defaultQualitySetting').value));
  $('allowAutoDowngrade').checked = allowAutoDowngrade();
  $('showCompatibilityNotice').checked = showCompatibilityNotice();

  $('downloadFilter').addEventListener('change', renderDownloads);
  $('refreshDownloads').addEventListener('click', loadDownloads);
  $('clearFinishedDownloads').addEventListener('click', async () => {
    if (!confirm('确定清除所有已完成和失败的下载记录吗？已下载文件不会被删除。')) return;
    try {
      const resp = await request('/api/songs/download?all=finished', { method: 'DELETE' });
      toast(`已清除 ${resp.data?.removed || 0} 条记录`);
      loadDownloads();
    } catch (error) { toast(error.message, 5200); }
  });

  $('refreshSources').addEventListener('click', loadSources);
  $('refreshStatus').addEventListener('click', () => { loadStatus(); loadSources(); });

  try { state.selected = JSON.parse(localStorage.getItem('neo-lxbridge:selected') || localStorage.getItem('lxbridge:selected') || localStorage.getItem('lxmusic:selected') || '[]'); }
  catch { state.selected = []; }

  syncQualityControls(defaultQuality());
  updateSelectionCount();
  renderImport();
  toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
  toggleNewPlaylistField('singlePlaylistTarget', 'singleNewPlaylistField');
  updatePlayerDock(null, '');
  loadStatus();
  loadPlaybackSettings();
  loadLxSyncSettings();
  loadDownloads();
  loadDownloadSettings();
  loadSearchDiscovery();
  updateExternalExample(defaultQuality());
})();
