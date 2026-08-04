export interface LxMusicInfoMeta {
  songId?: string | number;
  albumName?: string;
  picUrl?: string | null;
  hash?: string;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string | number;
  copyrightId?: string;
  songmid?: string;
  [key: string]: unknown;
}

export interface LxMusicInfo {
  id: string;
  name: string;
  singer: string;
  source: string;
  interval: string | null;
  meta: LxMusicInfoMeta;
}

export interface LxUserListInfo {
  id: string;
  name: string;
  source?: string;
  sourceListId?: string | number;
  locationUpdateTime?: number | null;
  list: LxMusicInfo[];
}

export interface LxListData {
  defaultList: LxMusicInfo[];
  loveList: LxMusicInfo[];
  userList: LxUserListInfo[];
  tempList?: LxMusicInfo[];
}

export type LxSyncMode =
  | 'merge_local_remote' | 'merge_remote_local'
  | 'overwrite_local_remote' | 'overwrite_remote_local'
  | 'overwrite_local_remote_full' | 'overwrite_remote_local_full' | 'cancel';

export interface LxClientKeyInfo {
  clientId: string;
  key: string;
  deviceName: string;
  isMobile: boolean;
  lastConnectDate: number;
  serverName?: string;
  listSnapshotKey?: string;
}

export interface LxSyncConfig {
  password: string;
  serverId: string;
  serverName: string;
  enabled: boolean;
  customServerAddress?: string;
  lastSyncAt?: string;
}

export interface LxSyncConfigPatch {
  password?: string;
  serverName?: string;
  enabled?: boolean;
  regeneratePassword?: boolean;
  customServerAddress?: string;
}

export interface LxSyncConfigPublic extends LxSyncConfig {
  serverAddress: string;
  serverAddresses: string[];
  automaticServerAddresses: string[];
  devices: Array<Pick<LxClientKeyInfo, 'clientId' | 'deviceName' | 'isMobile' | 'lastConnectDate'>>;
  connectedCount: number;
  mappedPlaylists: number;
}

export interface LxPlaylistMapping {
  lxListId: string;
  songloftPlaylistId: number;
  name: string;
  kind: 'love' | 'default' | 'user';
}
