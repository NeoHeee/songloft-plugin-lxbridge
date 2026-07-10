export function sizeFormate(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function decodeName(value: unknown): string {
  const text = String(value ?? '');
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function formatPlayTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function dateFormat(input: number | string | Date, format = 'yyyy-MM-dd hh:mm:ss'): string {
  const d = input instanceof Date ? input : new Date(input);
  const map: Record<string, string> = {
    yyyy: String(d.getFullYear()), MM: String(d.getMonth() + 1).padStart(2, '0'),
    dd: String(d.getDate()).padStart(2, '0'), hh: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'), ss: String(d.getSeconds()).padStart(2, '0'),
  };
  return Object.keys(map).reduce((out, key) => out.replace(key, map[key]), format);
}

export function formatPlayCount(value: number): string {
  const n = Number(value) || 0;
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function stripHtml(value: unknown): string {
  return decodeName(value).replace(/\s+/g, ' ').trim();
}

export function durationSeconds(value: unknown): number {
  const n = Number(value) || 0;
  return n > 10000 ? Math.round(n / 1000) : Math.round(n);
}
