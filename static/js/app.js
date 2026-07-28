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
    playingKey: '',
    playingItem: null,
    playlists: [],
    playlistsLoaded: false,
    importItem: null,
    downloadJobs: {},
    downloadPollers: {},
    downloadTaskList: [],
    downloadManagerTimer: 0,
    qualityByPlatform: {},
    legacyQualityPlatforms: new Set(),
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
    { value: 'flac24bit', label: 'Hi-Res 无损 · 24-Bit', common: true },
    { value: 'atmos', label: '臻品音质' },
    { value: 'master', label: '臻品母带' },
  ];
  const qualityAliases = { hires: 'flac24bit', '24bit': 'flac24bit', '24-bit': 'flac24bit', lossless: 'flac', high: '320k', standard: '128k' };
  const normalizeQuality = value => qualityAliases[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase();
  const musicPlaceholder = '<span class="cover-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6.8l9-1.8v10.2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="15.5" cy="15.2" r="2.5"/></svg></span>';

  function defaultQuality() {
    return localStorage.getItem('lxbridge:defaultQuality') || localStorage.getItem('lxmusic:defaultQuality') || '320k';
  }

  function setTheme(mode) {
    const normalized = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';
    localStorage.setItem('lxmusic:theme', normalized);
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
  setTheme(localStorage.getItem('lxmusic:theme') || 'system');
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  const onSchemeChange = () => {
    if ((localStorage.getItem('lxmusic:theme') || 'system') === 'system') setTheme('system');
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
    });
    if (legacy || !ids.length || !Object.keys(state.qualityByPlatform).length) {
      qualityCatalog.filter(item => item.common).forEach(item => found.add(item.value));
    }
    return found;
  }

  function renderQualityOptions(preferred) {
    const available = availableQualities();
    const known = new Set(qualityCatalog.map(item => item.value));
    const custom = Array.from(available).filter(value => value && !known.has(value)).sort();
    const options = [
      ...qualityCatalog.map(item => ({ ...item, supported: available.has(item.value) })),
      ...custom.map(value => ({ value, label: `扩展音质 · ${value}`, supported: true })),
    ];
    for (const id of ['quality', 'defaultQualitySetting']) {
      const select = $(id);
      const current = normalizeQuality(preferred || select.value || defaultQuality());
      select.innerHTML = options.map(item =>
        `<option value="${escapeHtml(item.value)}"${item.supported ? '' : ' disabled'}>${escapeHtml(item.label)}${item.supported ? '' : ' · 当前音源不支持'}</option>`
      ).join('');
      const usable = options.filter(item => item.supported).map(item => item.value);
      select.value = usable.includes(current) ? current : usable.includes('320k') ? '320k' : usable[0] || '320k';
    }
    updateExternalExample($('quality').value);
  }

  function syncQualityControls(value) {
    renderQualityOptions(normalizeQuality(value) || '320k');
    const normalized = $('quality').value || '320k';
    $('defaultQualitySetting').value = normalized;
    updateExternalExample(normalized);
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
    renderQualityOptions($('quality')?.value || defaultQuality());
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
    if (name === 'import') {
      renderImport();
      loadPlaylists();
    }
    if (name === 'downloads') loadDownloads();
    if (name === 'sources') loadSources();
    if (name === 'settings') updateExternalExample($('defaultQualitySetting').value || defaultQuality());
  }

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.querySelectorAll('[data-go-tab]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.goTab)));

  function setRuntimeStatus(active) {
    const warning = $('sourceWarning');
    const status = $('runtimeStatus');
    warning.classList.toggle('hidden', active > 0);
    status.classList.toggle('is-online', active > 0);
    status.classList.toggle('is-offline', active === 0);
    status.querySelector('.runtime-title').textContent = active > 0 ? `${active} 个音源正在运行` : '未检测到可用音源';
    status.querySelector('.runtime-subtitle').textContent = active > 0 ? '已动态读取音质能力，失败时自动降级' : '搜索和歌词仍然可用';
  }

  async function loadStatus() {
    try {
      const resp = await request('/api/status');
      const runtimes = resp.data?.runtime_sources || [];
      setRuntimeStatus(runtimes.length);
      updateQualityCapabilities(runtimes);
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
      const playing = isPlayingItem(item);
      const downloadJob = state.downloadJobs[selectedKey(item)] || null;
      const downloadLabel = downloadJob?.status === 'completed'
        ? '已下载'
        : downloadJob?.status === 'downloading'
          ? `下载中${downloadJob.total_bytes != null ? ` · ${formatBytes(downloadJob.total_bytes)}` : ''}`
          : downloadJob?.status === 'queued'
            ? `排队中${downloadJob.total_bytes != null ? ` · ${formatBytes(downloadJob.total_bytes)}` : ''}`
            : downloadJob?.status === 'failed'
              ? '重试'
              : '下载';
      const downloadDisabled = ['queued', 'downloading', 'completed'].includes(downloadJob?.status || '') ? ' disabled' : '';
      return `<article class="result-item">
        <input class="result-check" type="checkbox" data-index="${index}" ${checked ? 'checked' : ''} aria-label="选择 ${escapeHtml(item.title)}">
        ${coverMarkup(item.cover_url, item.title)}
        <div class="result-main">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="sub">${escapeHtml(item.artist || '未知歌手')} · ${escapeHtml(item.album || '未知专辑')} · ${formatDuration(item.duration)}</div>
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
      localStorage.setItem('lxmusic:selected', JSON.stringify(state.selected));
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
    localStorage.setItem('lxmusic:selected', JSON.stringify(state.selected));
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
        }),
      });
      state.results = resp.results || [];
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
      localStorage.setItem('lxmusic:selected', JSON.stringify(state.selected));
      renderImport();
      renderResults();
    }));
    $('importButton').disabled = !state.selected.length;
    if (state.playlistsLoaded) populatePlaylistSelect('batchPlaylistTarget');
    toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
    updateSelectionCount();
  }

  $('clearSelection').addEventListener('click', () => {
    state.selected = [];
    localStorage.removeItem('lxmusic:selected');
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
      localStorage.removeItem('lxmusic:selected');
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

  function downloadStatusLabel(status) {
    return { queued: '排队中', downloading: '下载中', completed: '已完成', failed: '失败' }[status] || status;
  }

  function renderDownloads() {
    const list = $('downloadList');
    if (!list) return;
    const filter = $('downloadFilter')?.value || 'all';
    const jobs = state.downloadTaskList.filter(job => {
      if (filter === 'active') return job.status === 'queued' || job.status === 'downloading';
      return filter === 'all' || job.status === filter;
    });
    const counts = state.downloadTaskList.reduce((result, job) => {
      result.total += 1;
      if (job.status === 'queued' || job.status === 'downloading') result.active += 1;
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
            <span class="download-status ${statusClass}">${escapeHtml(downloadStatusLabel(job.status))}</span>
          </div>
          <p>${details}</p>
          ${job.error ? `<p class="download-error">${escapeHtml(job.error)}</p>` : ''}
          ${job.path ? `<p class="download-path" title="${escapeHtml(job.path)}">${escapeHtml(job.path)}</p>` : ''}
        </div>
        <div class="download-actions">
          ${job.status === 'failed' ? `<button class="secondary" type="button" data-download-retry="${escapeHtml(job.id)}">重试</button>` : ''}
          ${job.path ? `<button class="secondary" type="button" data-download-copy="${escapeHtml(job.path)}">复制路径</button>` : ''}
          ${['completed', 'failed'].includes(job.status) ? `<button class="danger-button" type="button" data-download-remove="${escapeHtml(job.id)}">删除记录</button>` : ''}
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
        await request(`/api/songs/download?id=${encodeURIComponent(button.dataset.downloadRemove)}`, { method: 'DELETE' });
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
      renderDownloads();
      if (state.downloadTaskList.some(job => job.status === 'queued' || job.status === 'downloading')) {
        state.downloadManagerTimer = setTimeout(loadDownloads, 1400);
      }
    } catch (error) {
      toast(`加载下载任务失败：${error.message}`, 5200);
    }
  }

  async function probeDownload(item) {
    const requestedQuality = String(item.source_data?.quality || $('quality').value || '320k');
    const resp = await request('/api/direct/music/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: item.source_data?.platform,
        songInfo: item.source_data?.songInfo,
        quality: requestedQuality,
      }),
    });
    return { requestedQuality, ...(resp.data || {}) };
  }

  function clearDownloadPoller(key) {
    const timer = state.downloadPollers[key];
    if (timer) clearTimeout(timer);
    delete state.downloadPollers[key];
  }

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

  async function startDownload(item, button) {
    const key = selectedKey(item);
    const current = state.downloadJobs[key];
    if (current && ['queued', 'downloading', 'completed'].includes(current.status)) return;

    setBusy(button, true, '探测中');
    try {
      let probe = null;
      try {
        probe = await probeDownload(item);
      } catch (error) {
        const proceed = window.confirm(`无法提前获取《${item.title}》的文件大小：${error.message}\n\n是否仍要继续下载？`);
        if (!proceed) return;
      }
      if (probe) {
        const actualQuality = probe.actual_quality || probe.requestedQuality;
        item.source_data.quality = actualQuality;
        const qualityLine = probe.downgraded
          ? `${probe.requestedQuality} → ${actualQuality}（已自动降级）`
          : actualQuality;
        const sizeLine = probe.total_bytes == null ? '大小未知' : formatBytes(probe.total_bytes);
        const typeLine = probe.content_type ? `\n格式：${probe.content_type}` : '';
        const proceed = window.confirm(
          `确认下载《${item.title}》？\n\n实际音质：${qualityLine}\n文件大小：${sizeLine}${typeLine}`,
        );
        if (!proceed) return;
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
        }),
      });
      const resolved = resp.data || {};
      if (!resolved.url) throw new Error('未获取到可播放地址');
      const actualQuality = resolved.actualQuality || requestedQuality;
      item.source_data.quality = actualQuality;
      audio.src = resolved.url;
      await audio.play();
      state.playingKey = key;
      state.playingItem = item;
      updatePlayerDock(item, resolved.url);
      if (resolved.downgraded) {
        toast(`目标音质 ${requestedQuality} 不可用，已自动降级为 ${actualQuality}`, 5200);
      } else if (resolved.headers && Object.keys(resolved.headers).length) {
        toast('该歌曲解析时返回了自定义请求头，浏览器预览可能在少数情况下受限。', 4200);
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

  async function loadSources() {
    try {
      const resp = await request('/api/sources');
      const data = resp.data || {};
      const list = data.sources || [];
      const enabledCount = list.filter(item => item.enabled && !item.error).length;
      setRuntimeStatus(enabledCount);
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
          <button class="danger-button" type="button" data-delete="${escapeHtml(item.id)}">删除</button>
        </article>`).join('');
      }

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

  $('sourceFile').addEventListener('change', event => {
    const files = Array.from(event.target.files || []);
    $('sourceFileLabel').textContent = files.length
      ? files.length === 1 ? files[0].name : `已选择 ${files.length} 个文件`
      : '选择 .js 或 .zip 文件';
  });

  $('uploadSource').addEventListener('click', async () => {
    const files = $('sourceFile').files;
    if (!files.length) return toast('请选择 .js 或 .zip 文件');
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
  $('saveSettings').addEventListener('click', () => {
    const value = $('defaultQualitySetting').value || '320k';
    localStorage.setItem('lxbridge:defaultQuality', value);
    syncQualityControls(value);
    toast('默认音质已保存');
  });
  $('quality').addEventListener('change', () => updateExternalExample($('quality').value));
  $('defaultQualitySetting').addEventListener('change', () => updateExternalExample($('defaultQualitySetting').value));

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

  try { state.selected = JSON.parse(localStorage.getItem('lxmusic:selected') || '[]'); }
  catch { state.selected = []; }

  syncQualityControls(defaultQuality());
  updateSelectionCount();
  renderImport();
  toggleNewPlaylistField('batchPlaylistTarget', 'batchNewPlaylistField');
  toggleNewPlaylistField('singlePlaylistTarget', 'singleNewPlaylistField');
  updatePlayerDock(null, '');
  loadStatus();
  loadDownloads();
  updateExternalExample(defaultQuality());
})();
