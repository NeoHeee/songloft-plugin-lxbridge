import type { SearchResultItem } from '@songloft/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { firstExternalCandidate } from '../../src/handlers/search';

function item(title: string): SearchResultItem {
  return { title, artist: '', album: '', duration: 0, cover_url: '', source_data: { platform: 'kw', quality: '320k', songInfo: {} } };
}

describe('best external result selection', () => {
  it('keeps external/search order and returns the first item without rescoring', () => {
    const first = item('原始第一条');
    const second = item('看似匹配分更高的候选');
    expect(firstExternalCandidate([first, second])).toBe(first);
  });

  it('returns null when external/search has no result', () => {
    expect(firstExternalCandidate([])).toBeNull();
  });
});
