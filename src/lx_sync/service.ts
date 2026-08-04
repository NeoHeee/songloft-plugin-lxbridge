import { clearAuthRateLimits } from './auth_rate_limit';
import { DEFAULT_SERVER_NAME, LX_SYNC_CONFIG_KEY, SYNC_CODE } from './constants';
import {
  authCodeToAesKey,
  createClientSessionKey,
  createServerId,
  generatePassword,
} from './crypto_lx';
import { LxDeviceStore } from './devices';
import { applyListActionToData } from './list_merge';
import { LxPlaylistMapper } from './playlist_mapper';
import type {
  LxClientKeyInfo,
  LxListData,
  LxSyncConfig,
  LxSyncConfigPatch,
  LxSyncConfigPublic,
} from './types';

export type LxListSyncPeer = {
  clientId: string;
  isListReady: () => boolean;
  notifyListAction: (action: unknown) => Promise<void>;
  close: () => void;
};

function parseConfig(value: unknown): LxSyncConfig | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<LxSyncConfig>;
  if (!row.password || !row.serverId) return null;
  return {
    password: String(row.password),
    serverId: String(row.serverId),
    serverName: String(row.serverName || DEFAULT_SERVER_NAME),
    enabled: row.enabled !== false,
    ...(row.customServerAddress ? { customServerAddress: String(row.customServerAddress) } : {}),
    ...(row.lastSyncAt ? { lastSyncAt: String(row.lastSyncAt) } : {}),
  };
}

const LX_SYNC_PLUGIN_PATH = '/api/v1/jsplugin/neo-lxbridge';

export function normalizeCustomServerAddress(value: unknown): string {
  let text = String(value || '').trim();
  if (!text) return '';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new Error('自定义服务地址只支持 HTTP 或 HTTPS');
  }
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('自定义服务地址格式无效，请填写域名或 IP 地址'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('自定义服务地址只支持 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('自定义服务地址不能包含用户名或密码');
  const pathname = url.pathname.replace(/\/+$/, '');
  const finalPath = pathname.endsWith(LX_SYNC_PLUGIN_PATH)
    ? pathname
    : `${pathname}${LX_SYNC_PLUGIN_PATH}`;
  return `${url.origin}${finalPath}`;
}

export class LxSyncService {
  private readonly devices = new LxDeviceStore();
  private readonly mapper = new LxPlaylistMapper();
  private readonly peers = new Map<string, LxListSyncPeer>();
  private syncChain: Promise<void> = Promise.resolve();
  private configChain: Promise<void> = Promise.resolve();
  private importChain: Promise<void> = Promise.resolve();
  private serverAddresses: string[] = [];

  setServerAddresses(addresses: string[]): void {
    this.serverAddresses = Array.from(new Set(addresses.map(value => value.replace(/\/$/, '')).filter(Boolean)));
  }

  async withSyncLock<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.syncChain;
    this.syncChain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private async withConfigLock<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.configChain;
    this.configChain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private async ensureConfig(): Promise<LxSyncConfig> {
    const stored = parseConfig(await songloft.persistentStorage.get(LX_SYNC_CONFIG_KEY));
    if (stored) return stored;
    const created: LxSyncConfig = {
      password: generatePassword(),
      serverId: createServerId(),
      serverName: DEFAULT_SERVER_NAME,
      enabled: false,
    };
    await this.saveConfig(created);
    return created;
  }

  private async saveConfig(config: LxSyncConfig): Promise<void> {
    await songloft.persistentStorage.set(LX_SYNC_CONFIG_KEY, JSON.stringify(config));
  }

  async getConfig(): Promise<LxSyncConfigPublic> {
    const config = await this.ensureConfig();
    const devices = await this.devices.loadAll();
    const mappings = await this.mapper.loadMappings();
    const automaticServerAddresses = [...this.serverAddresses];
    const serverAddresses = Array.from(new Set([
      ...(config.customServerAddress ? [config.customServerAddress] : []),
      ...automaticServerAddresses,
    ]));
    return {
      ...config,
      customServerAddress: config.customServerAddress || '',
      serverAddress: serverAddresses[0] || '',
      serverAddresses,
      automaticServerAddresses,
      devices: devices.map(({ clientId, deviceName, isMobile, lastConnectDate }) => ({ clientId, deviceName, isMobile, lastConnectDate })),
      connectedCount: this.peers.size,
      mappedPlaylists: mappings.length,
    };
  }

  async updateConfig(patch: LxSyncConfigPatch): Promise<LxSyncConfigPublic> {
    await this.withConfigLock(async () => {
      const current = await this.ensureConfig();
      const password = patch.regeneratePassword
        ? generatePassword()
        : typeof patch.password === 'string' && patch.password.trim() ? patch.password.trim() : current.password;
      const passwordChanged = password !== current.password;
      const next: LxSyncConfig = {
        ...current,
        password,
        enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
        serverName: patch.serverName == null ? current.serverName : String(patch.serverName).trim() || DEFAULT_SERVER_NAME,
        customServerAddress: patch.customServerAddress == null
          ? current.customServerAddress
          : normalizeCustomServerAddress(patch.customServerAddress),
        ...(passwordChanged ? { serverId: createServerId() } : {}),
      };
      await this.saveConfig(next);
      if (passwordChanged) {
        await this.devices.clearAll();
        clearAuthRateLimits();
        this.dropAllConnections();
      }
      if (!next.enabled) this.dropAllConnections();
    });
    return this.getConfig();
  }

  async getServerMeta(): Promise<{ serverId: string; serverName: string; enabled: boolean; helloMsg: string }> {
    const config = await this.ensureConfig();
    return { serverId: config.serverId, serverName: config.serverName, enabled: config.enabled, helloMsg: SYNC_CODE.helloMsg };
  }

  async getAuthPasswordKey(): Promise<string> {
    return authCodeToAesKey((await this.ensureConfig()).password);
  }

  async issueClientKey(deviceName: string, isMobile: boolean): Promise<LxClientKeyInfo & { serverName: string }> {
    const config = await this.ensureConfig();
    if (!config.enabled) throw new Error('洛雪同步服务已关闭');
    const session = createClientSessionKey();
    const info: LxClientKeyInfo = {
      clientId: session.clientId,
      key: session.key,
      deviceName: deviceName || 'Unknown',
      isMobile,
      lastConnectDate: Date.now(),
      serverName: config.serverName,
    };
    await this.devices.save(info);
    return { ...info, serverName: config.serverName };
  }

  async getDevice(clientId: string): Promise<LxClientKeyInfo | null> { return this.devices.get(clientId); }

  async touchDevice(clientId: string, deviceName?: string): Promise<LxClientKeyInfo | null> {
    const info = await this.devices.get(clientId);
    if (!info) return null;
    info.lastConnectDate = Date.now();
    if (deviceName) info.deviceName = deviceName;
    await this.devices.save(info);
    return info;
  }

  async getDeviceListSnapshotKey(clientId: string): Promise<string | undefined> {
    return (await this.devices.get(clientId))?.listSnapshotKey;
  }

  async setDeviceListSnapshotKey(clientId: string, key: string): Promise<void> {
    const info = await this.devices.get(clientId);
    if (!info) return;
    info.listSnapshotKey = key;
    await this.devices.save(info);
  }

  async getLocalListData(): Promise<LxListData> {
    const stored = await this.mapper.loadListData();
    return this.mapper.refreshFromSongloft(stored);
  }

  async setLocalListData(data: LxListData): Promise<void> {
    await this.mapper.saveListData(data);
    this.ensureSongloftImportAfterSync();
  }

  async applyListAction(action: unknown): Promise<void> {
    const current = await this.mapper.loadListData();
    await this.mapper.saveListData(applyListActionToData(current, action));
    this.ensureSongloftImportAfterSync();
  }

  ensureSongloftImportAfterSync(): void {
    this.importChain = this.importChain
      .then(async () => this.mapper.importToSongloft(await this.mapper.loadListData()))
      .catch(error => songloft.log.error(`[LxSync] Songloft 歌单映射失败: ${String(error)}`));
  }

  async markSynced(): Promise<void> {
    await this.withConfigLock(async () => {
      const config = await this.ensureConfig();
      await this.saveConfig({ ...config, lastSyncAt: new Date().toISOString() });
    });
  }

  registerListPeer(peer: LxListSyncPeer): void {
    const existing = this.peers.get(peer.clientId);
    if (existing && existing !== peer) existing.close();
    this.peers.set(peer.clientId, peer);
  }

  unregisterListPeer(clientId: string, peer?: LxListSyncPeer): void {
    const current = this.peers.get(clientId);
    if (peer && current && current !== peer) return;
    this.peers.delete(clientId);
  }

  async broadcastListAction(fromClientId: string, action: unknown): Promise<void> {
    await Promise.all(Array.from(this.peers.entries()).map(async ([id, peer]) => {
      if (id === fromClientId || !peer.isListReady()) return;
      try { await peer.notifyListAction(action); } catch (error) {
        songloft.log.warn(`[LxSync] 设备广播失败 ${id}: ${String(error)}`);
      }
    }));
  }

  dropAllConnections(): void {
    const peers = Array.from(this.peers.values());
    this.peers.clear();
    peers.forEach(peer => { try { peer.close(); } catch { /* ignore */ } });
  }
}
