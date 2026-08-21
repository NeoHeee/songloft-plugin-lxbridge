export type LocalFileStatus = 'exists' | 'missing' | 'unknown';

function pathCandidates(value: unknown): string[] {
  const stored = String(value || '').trim().replace(/\\/g, '/');
  const candidates = new Set<string>();
  const add = (path: string) => { if (path) candidates.add(path); };
  if (stored.startsWith('/app/music/')) {
    const relative = stored.slice('/app/music/'.length);
    add(stored); add(`/music/${relative}`);
  } else if (stored.startsWith('/music/')) {
    const relative = stored.slice('/music/'.length);
    add(`/app/music/${relative}`); add(stored);
  } else if (/^music\//i.test(stored)) {
    const relative = stored.slice('music/'.length);
    add(`/app/music/${relative}`); add(`/music/${relative}`);
  } else if (/^app\/music\//i.test(stored)) add(`/${stored}`);
  else if (stored && !stored.startsWith('/')) add(`/app/music/${stored}`);
  add(stored);
  return Array.from(candidates);
}

export async function localAudioFileStatus(filePath: unknown): Promise<LocalFileStatus> {
  const candidates = pathCandidates(filePath);
  if (!candidates.length) return 'missing';
  let checked = false;
  for (const path of candidates) {
    try {
      const result = await songloft.command.exec('sh', ['-c', 'test -f "$1" && test -r "$1"', 'neo-lxbridge-file-check', path], { timeout: 5000 });
      checked = true;
      if (result.exitCode === 0) return 'exists';
    } catch { /* keep checking mapped candidates */ }
  }
  return checked ? 'missing' : 'unknown';
}
