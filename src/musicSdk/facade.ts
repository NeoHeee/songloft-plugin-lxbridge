import type { MusicPlatform, PlatformId } from '../types';
import kw from './kw';
import kg from './kg';
import tx from './tx';
import wy from './wy';
import mg from './mg';

if (!(globalThis as unknown as { window?: typeof globalThis }).window) {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
if (!(globalThis as unknown as { global?: typeof globalThis }).global) {
  (globalThis as unknown as { global: typeof globalThis }).global = globalThis;
}

export const sources = [
  { id: 'kw', name: '酷我音乐' }, { id: 'kg', name: '酷狗音乐' },
  { id: 'tx', name: 'QQ音乐' }, { id: 'wy', name: '网易云音乐' },
  { id: 'mg', name: '咪咕音乐' },
] as const;

export const musicSdk: Record<PlatformId, MusicPlatform> = { kw, kg, tx, wy, mg };
export { kw, kg, tx, wy, mg };
export default { sources, kw, kg, tx, wy, mg };
