import { httpFetch } from '../musicSdk/request';

export const SEARCH_HISTORY_KEY = 'search_history';
export const SEARCH_HISTORY_LIMIT = 20;
export const HOT_SEARCH_LIMIT = 20;
export const HOT_SEARCH_CACHE_MS = 30 * 60 * 1000;
export const NETEASE_HOT_SEARCH_URL = 'https://music.163.com/api/search/hot?type=1111';

const FALLBACK_HOT_SEARCHES = [
  '周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '孙燕姿', '五月天',
  '海阔天空', '晴天', '后来', '一路生花', '起风了', '稻香',
  '孤勇者', '如愿', '夜曲', '告白气球', '童话', '红豆',
  '光年之外', '平凡之路',
];

let hotSearchCache: { expiresAt: number; keywords: string[] } | null = null;

function normalizeKeyword(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function normalizeSearchHistory(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parsed) {
    const keyword = normalizeKeyword(item);
    const key = keyword.toLocaleLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length >= SEARCH_HISTORY_LIMIT) break;
  }
  return result;
}

export function updateSearchHistory(history: unknown, keywordValue: unknown): string[] {
  const keyword = normalizeKeyword(keywordValue);
  if (!keyword) throw new Error('搜索关键词不能为空');
  const key = keyword.toLocaleLowerCase();
  return [keyword, ...normalizeSearchHistory(history).filter(item => item.toLocaleLowerCase() !== key)]
    .slice(0, SEARCH_HISTORY_LIMIT);
}

export function parseHotSearches(body: unknown): string[] {
  const data = body as { result?: { hots?: Array<{ first?: unknown; searchWord?: unknown }> }; data?: Array<{ searchWord?: unknown }> };
  const candidates = Array.isArray(data?.result?.hots)
    ? data.result.hots.map(item => item?.first ?? item?.searchWord)
    : Array.isArray(data?.data) ? data.data.map(item => item?.searchWord) : [];
  return normalizeSearchHistory(candidates).slice(0, HOT_SEARCH_LIMIT);
}

export function supplementHotSearches(keywords: unknown): string[] {
  return normalizeSearchHistory([
    ...normalizeSearchHistory(keywords),
    ...FALLBACK_HOT_SEARCHES,
  ]).slice(0, HOT_SEARCH_LIMIT);
}

async function saveSearchHistory(history: string[]): Promise<string[]> {
  await songloft.persistentStorage.set(SEARCH_HISTORY_KEY, JSON.stringify(history));
  return history;
}

export async function getSearchHistory(): Promise<string[]> {
  return normalizeSearchHistory(await songloft.persistentStorage.get(SEARCH_HISTORY_KEY));
}

export async function addSearchHistory(keyword: unknown): Promise<string[]> {
  return saveSearchHistory(updateSearchHistory(await getSearchHistory(), keyword));
}

export async function removeSearchHistory(keywordValue: unknown): Promise<string[]> {
  const keyword = normalizeKeyword(keywordValue).toLocaleLowerCase();
  if (!keyword) return getSearchHistory();
  return saveSearchHistory((await getSearchHistory()).filter(item => item.toLocaleLowerCase() !== keyword));
}

export async function clearSearchHistory(): Promise<string[]> {
  return saveSearchHistory([]);
}

export async function getHotSearches(): Promise<{ keywords: string[]; source: 'netease_mixed' | 'fallback'; cached: boolean }> {
  if (hotSearchCache && hotSearchCache.expiresAt > Date.now()) {
    return { keywords: hotSearchCache.keywords, source: 'netease_mixed', cached: true };
  }
  try {
    let response = await httpFetch(NETEASE_HOT_SEARCH_URL, {
      headers: { Referer: 'https://music.163.com/' },
      timeout: 8000,
    }).promise;
    let keywords = response.statusCode >= 200 && response.statusCode < 300 ? parseHotSearches(response.body) : [];
    if (!keywords.length) {
      response = await httpFetch('https://music.163.com/api/search/hot', {
        method: 'POST',
        headers: { Referer: 'https://music.163.com/' },
        form: { type: 1111 },
        timeout: 8000,
      }).promise;
      keywords = response.statusCode >= 200 && response.statusCode < 300 ? parseHotSearches(response.body) : [];
    }
    if (keywords.length) {
      keywords = supplementHotSearches(keywords);
      hotSearchCache = { expiresAt: Date.now() + HOT_SEARCH_CACHE_MS, keywords };
      return { keywords, source: 'netease_mixed', cached: false };
    }
  } catch (error) {
    songloft.log.warn(`[neo-lxbridge] hot search fallback: ${String(error)}`);
  }
  return { keywords: FALLBACK_HOT_SEARCHES, source: 'fallback', cached: false };
}
