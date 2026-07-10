export interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, Math.min(bytes.length, i + chunk));
    out += String.fromCharCode(...Array.from(part));
  }
  return out;
}
function fromLatin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}
function headerValue(headers: Record<string,string>, key: string): string {
  return headers[key.toLowerCase()] || '';
}

export function parseMultipart(body: Uint8Array, contentType: string): MultipartFile[] {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('multipart 缺少 boundary');
  const boundary = match[1] || match[2];
  const raw = latin1(body);
  const parts = raw.split(`--${boundary}`);
  const files: MultipartFile[] = [];
  for (let part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    if (part.startsWith('\r\n')) part = part.slice(2);
    if (part.endsWith('\r\n')) part = part.slice(0, -2);
    if (part.endsWith('--')) part = part.slice(0, -2);
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const headerText = part.slice(0, split);
    let payload = part.slice(split + 4);
    if (payload.endsWith('\r\n')) payload = payload.slice(0, -2);
    const headers: Record<string,string> = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const disposition = headerValue(headers, 'content-disposition');
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] || '';
    let filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) { try { filename = decodeURIComponent(encoded); } catch { filename = encoded; } }
    if (!filename) continue;
    files.push({ fieldName: name, filename, contentType: headerValue(headers, 'content-type'), bytes: fromLatin1(payload) });
  }
  return files;
}
