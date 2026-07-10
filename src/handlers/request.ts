import type { HTTPRequest } from '@songloft/plugin-sdk';

/**
 * 将宿主传入的请求体转换为原始字节。
 *
 * Songloft 对二进制 HTTP body 会在桥接层以 latin1/binary string 形式交给
 * QuickJS，而 SDK 类型仍声明为 Uint8Array。这里同时兼容两种形态，避免
 * multipart 上传被误判为“缺少二进制 body”。
 */
export function bodyToBytes(body: HTTPRequest['body']): Uint8Array {
  const value = body as unknown;
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value as ArrayBufferView)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === 'string') {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
    return bytes;
  }
  throw new Error('无法识别上传请求体格式');
}

export function bodyToText(body: HTTPRequest['body']): string {
  const value = body as unknown;
  if (value == null) return '';
  if (typeof value === 'string') return value;
  const bytes = value as Uint8Array;
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch { return Buffer.from(bytes).toString('utf8'); }
}

export function parseJSONBody<T = Record<string, unknown>>(req: HTTPRequest): T {
  const text = bodyToText(req.body);
  if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error('请求体不是合法 JSON'); }
}

export function header(req: HTTPRequest, name: string): string {
  const target = name.toLowerCase();
  for (const key of Object.keys(req.headers || {})) if (key.toLowerCase() === target) return req.headers[key];
  return '';
}
