export interface ZipScriptEntry { filename: string; script: string }

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function signature(bytes: Uint8Array, offset: number, sig: number): boolean {
  return offset >= 0 && offset + 4 <= bytes.length && u32(bytes, offset) === sig;
}
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch { return Buffer.from(bytes).toString('utf8'); }
}
function decodeFilename(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return decodeUtf8(bytes);
  const latin1 = Buffer.from(bytes).toString('latin1');
  try {
    const maybe = decodeUtf8(bytes);
    return maybe.includes('\uFFFD') ? latin1 : maybe;
  } catch { return latin1; }
}
function shouldSkip(filename: string): boolean {
  const normalized = filename.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  return normalized.endsWith('/') || normalized.includes('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || !/\.js$/i.test(base);
}
function inflateRaw(compressed: Uint8Array): Uint8Array {
  return hexToBytes(__go_raw_inflate(bytesToHex(compressed)));
}
function extractPayload(bytes: Uint8Array, localOffset: number, method: number, compressedSize: number): Uint8Array {
  if (!signature(bytes, localOffset, 0x04034b50)) throw new Error('ZIP local header 无效');
  const nameLen = u16(bytes, localOffset + 26);
  const extraLen = u16(bytes, localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const end = start + compressedSize;
  if (end > bytes.length) throw new Error('ZIP 条目越界');
  const compressed = bytes.slice(start, end);
  if (method === 0) return compressed;
  if (method === 8) return inflateRaw(compressed);
  throw new Error(`ZIP 不支持的压缩方式: ${method}`);
}

function parseCentralDirectory(bytes: Uint8Array): ZipScriptEntry[] {
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (signature(bytes, i, 0x06054b50)) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const entries = u16(bytes, eocd + 10);
  const centralOffset = u32(bytes, eocd + 16);
  const result: ZipScriptEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entries; index++) {
    if (!signature(bytes, cursor, 0x02014b50)) break;
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLen);
    const filename = decodeFilename(nameBytes, Boolean(flags & 0x800));
    if (!shouldSkip(filename)) {
      try {
        const payload = extractPayload(bytes, localOffset, method, compressedSize);
        result.push({ filename, script: decodeUtf8(payload) });
      } catch (error) {
        songloft.log.warn(`跳过 ZIP 条目 ${filename}: ${String((error as Error)?.message || error)}`);
      }
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return result;
}

function parseLocalHeaders(bytes: Uint8Array): ZipScriptEntry[] {
  const result: ZipScriptEntry[] = [];
  let cursor = 0;
  while (cursor + 30 <= bytes.length) {
    if (!signature(bytes, cursor, 0x04034b50)) { cursor += 1; continue; }
    const flags = u16(bytes, cursor + 6);
    const method = u16(bytes, cursor + 8);
    const compressedSize = u32(bytes, cursor + 18);
    const nameLen = u16(bytes, cursor + 26);
    const extraLen = u16(bytes, cursor + 28);
    const filename = decodeFilename(bytes.slice(cursor + 30, cursor + 30 + nameLen), Boolean(flags & 0x800));
    const start = cursor + 30 + nameLen + extraLen;
    if ((flags & 0x08) !== 0 || compressedSize === 0) { cursor = start; continue; }
    if (!shouldSkip(filename)) {
      try {
        const compressed = bytes.slice(start, start + compressedSize);
        const payload = method === 0 ? compressed : method === 8 ? inflateRaw(compressed) : new Uint8Array();
        if (payload.length) result.push({ filename, script: decodeUtf8(payload) });
      } catch (error) {
        songloft.log.warn(`ZIP local fallback 跳过 ${filename}: ${String((error as Error)?.message || error)}`);
      }
    }
    cursor = start + compressedSize;
  }
  return result;
}

export function parseZipScripts(bytes: Uint8Array): ZipScriptEntry[] {
  const central = parseCentralDirectory(bytes);
  const result = central.length ? central : parseLocalHeaders(bytes);
  if (!result.length) throw new Error('ZIP 中未找到可导入的 .js 音源');
  return result;
}
