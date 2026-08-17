import { describe, expect, it } from 'vitest';
import { HOT_SEARCH_LIMIT, NETEASE_HOT_SEARCH_URL, normalizeSearchHistory, parseHotSearches, SEARCH_HISTORY_LIMIT, supplementHotSearches, updateSearchHistory } from '../../src/search/discovery';

describe('search discovery helpers', () => {
  it('deduplicates history, moves the latest keyword first and limits the list', () => {
    const history = Array.from({ length: SEARCH_HISTORY_LIMIT + 4 }, (_, index) => `歌曲 ${index}`);
    const result = updateSearchHistory(history, '  歌曲   4  ');
    expect(result[0]).toBe('歌曲 4');
    expect(result).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(result.filter(item => item === '歌曲 4')).toHaveLength(1);
  });

  it('accepts persisted JSON and removes empty or repeated values', () => {
    expect(normalizeSearchHistory('["周杰伦", "", "周杰伦", " 林俊杰 "]')).toEqual(['周杰伦', '林俊杰']);
  });

  it('parses the NetEase hot-search response', () => {
    expect(parseHotSearches({ result: { hots: [{ first: '晴天' }, { first: '夜曲' }] } })).toEqual(['晴天', '夜曲']);
    expect(NETEASE_HOT_SEARCH_URL).toContain('type=1111');
  });

  it('supplements a short live list to 20 unique recommendations', () => {
    const result = supplementHotSearches(['周杰伦', '实时歌曲', '周杰伦']);
    expect(result).toHaveLength(HOT_SEARCH_LIMIT);
    expect(result.slice(0, 2)).toEqual(['周杰伦', '实时歌曲']);
    expect(new Set(result).size).toBe(HOT_SEARCH_LIMIT);
  });
});
