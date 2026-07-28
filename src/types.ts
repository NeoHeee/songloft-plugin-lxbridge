export type PlatformId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';

export interface QualityInfo {
  type: string;
  size?: string;
}

export interface MusicInfo {
  source: PlatformId;
  name: string;
  singer: string;
  albumName?: string;
  duration: number;
  interval?: string;
  img?: string;
  songmid?: string;
  musicId?: string;
  hash?: string;
  copyrightId?: string;
  strMediaMid?: string;
  albumMid?: string;
  albumId?: string;
  types?: QualityInfo[];
  _types?: Record<string, { size?: string }>;
  [key: string]: unknown;
}

export interface SearchResultPage {
  list: MusicInfo[];
  total: number;
  page: number;
  limit: number;
  allPage: number;
  source: PlatformId;
}

export interface LyricResult {
  lyric: string;
  tlyric?: string;
  lxlyric?: string;
  raw?: unknown;
}

export interface ListPage<T = unknown> {
  list: T[];
  total?: number;
  page?: number;
  limit?: number;
  source: PlatformId;
  [key: string]: unknown;
}

export interface MusicPlatform {
  id: PlatformId;
  name: string;
  musicSearch: { search(keyword: string, page?: number, limit?: number): Promise<SearchResultPage> };
  getLyric(songInfo: MusicInfo): Promise<LyricResult>;
  songList: {
    tags(): Promise<unknown>;
    list(params: Record<string, string>): Promise<unknown>;
    detail(id: string, page?: number, limit?: number): Promise<unknown>;
    search(keyword: string, page?: number, limit?: number): Promise<unknown>;
    sorts(): Promise<unknown>;
  };
  leaderboard: {
    boards(): Promise<unknown>;
    list(id: string, page?: number, limit?: number): Promise<unknown>;
  };
}

export interface ResolvedUrl {
  url: string;
  headers?: Record<string, string>;
  runtimeId?: string;
  requestedQuality?: string;
  actualQuality?: string;
  downgraded?: boolean;
}

export interface SourceMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  filename: string;
  enabled: boolean;
  loading: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceCapability {
  name?: string;
  type?: string;
  actions?: string[];
  qualitys?: string[];
  [key: string]: unknown;
}

export interface SourceRuntimeInfo {
  id: string;
  envName: string;
  sources: Partial<Record<PlatformId, SourceCapability>>;
  totalCalls: number;
  successCalls: number;
  lastError?: string;
}
