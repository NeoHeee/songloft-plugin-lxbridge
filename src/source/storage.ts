import type { SourceMeta } from '../types';

export const SOURCE_INDEX_KEY = 'source_index';
export const SOURCE_SCRIPT_PREFIX = 'source_script_';
export const SOURCE_RUNTIME_REVISION_KEY = 'source_runtime_revision';

export async function loadSourceIndex(): Promise<SourceMeta[]> {
  const raw = await songloft.storage.get(SOURCE_INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(item => item && typeof item === 'object').map(item => ({
    ...(item as SourceMeta),
    enabled: Boolean((item as SourceMeta).enabled),
    loading: false,
  }));
}

export async function saveSourceIndex(items: SourceMeta[]): Promise<void> {
  await songloft.storage.set(SOURCE_INDEX_KEY, items);
}

export async function loadSourceScript(id: string): Promise<string | null> {
  const value = await songloft.storage.get(`${SOURCE_SCRIPT_PREFIX}${id}`);
  return typeof value === 'string' ? value : null;
}

export async function saveSourceScript(id: string, script: string): Promise<void> {
  await songloft.storage.set(`${SOURCE_SCRIPT_PREFIX}${id}`, script);
}

export async function deleteSourceScript(id: string): Promise<void> {
  await songloft.storage.delete(`${SOURCE_SCRIPT_PREFIX}${id}`);
}

export async function loadSourceRuntimeRevision(): Promise<number> {
  const value = await songloft.storage.get(SOURCE_RUNTIME_REVISION_KEY);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function saveSourceRuntimeRevision(revision: number): Promise<void> {
  await songloft.storage.set(SOURCE_RUNTIME_REVISION_KEY, revision);
}
