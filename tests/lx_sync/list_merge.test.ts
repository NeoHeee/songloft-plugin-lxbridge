import { describe, expect, it } from 'vitest';
import { applyListActionToData, emptyListData, mergeListData } from '../../src/lx_sync/list_merge';
import type { LxMusicInfo } from '../../src/lx_sync/types';

const song = (id: string): LxMusicInfo => ({
  id,
  name: id,
  singer: '歌手',
  source: 'kw',
  interval: '01:00',
  meta: { songId: id },
});

describe('LX Music 歌单协议合并', () => {
  it('新增歌曲时按 ID 去重', () => {
    const data = emptyListData();
    data.loveList = [song('a')];
    const next = applyListActionToData(data, {
      action: 'list_music_add',
      data: { id: 'love', musicInfos: [song('a'), song('b')], addMusicLocationType: 'bottom' },
    });
    expect(next.loveList.map(item => item.id)).toEqual(['a', 'b']);
  });

  it('同一自建歌单会合并两端歌曲', () => {
    const local = emptyListData();
    local.userList = [{ id: 'u1', name: '收藏', list: [song('a'), song('b')] }];
    const remote = emptyListData();
    remote.userList = [{ id: 'u1', name: '收藏', list: [song('b'), song('c')] }];
    const merged = mergeListData(local, remote);
    expect(merged.userList[0].list.map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('同一歌单内移动歌曲不会把旧顺序恢复', () => {
    const data = emptyListData();
    data.loveList = [song('a'), song('b'), song('c')];
    const next = applyListActionToData(data, {
      action: 'list_music_move',
      data: { fromId: 'love', toId: 'love', musicInfos: [song('a')], addMusicLocationType: 'bottom' },
    });
    expect(next.loveList.map(item => item.id)).toEqual(['b', 'c', 'a']);
  });
});
