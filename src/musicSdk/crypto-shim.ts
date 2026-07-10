function toBuffer(input: string | BufferLike, encoding: string = 'utf8'): BufferLike {
  return typeof input === 'string' ? Buffer.from(input, encoding) : input;
}

export function md5(input: string): string { return crypto.md5(input); }
export function sha1(input: string): string { return crypto.sha1(input); }
export function sha256Hex(input: string | BufferLike): string { return crypto.sha256Bytes(input).toString('hex'); }
export function randomBytes(size: number): BufferLike { return crypto.randomBytes(size); }
export function base64Encode(input: string | BufferLike): string { return toBuffer(input).toString('base64'); }
export function base64Decode(input: string): string { return Buffer.from(input, 'base64').toString('utf8'); }
export function hexEncode(input: string | BufferLike): string { return toBuffer(input).toString('hex'); }
export function hexDecode(input: string): string { return Buffer.from(input, 'hex').toString('utf8'); }

export function aesEncrypt(
  input: string | BufferLike,
  key: string | BufferLike,
  iv: string | BufferLike = Buffer.alloc(16),
  mode: 'cbc' | 'ecb' = 'cbc',
  output: 'hex' | 'base64' = 'base64',
): string {
  return crypto.aesEncrypt(toBuffer(input), mode, toBuffer(key), toBuffer(iv)).toString(output);
}

export function aesDecrypt(
  input: string | BufferLike,
  key: string | BufferLike,
  iv: string | BufferLike = Buffer.alloc(16),
  mode: 'cbc' | 'ecb' = 'cbc',
  output: 'utf8' | 'hex' = 'utf8',
): string {
  return crypto.aesDecrypt(input, mode, toBuffer(key), toBuffer(iv)).toString(output);
}

export function rsaEncrypt(input: string | BufferLike, publicKeyPEM: string, output: 'hex' | 'base64' = 'base64'): string {
  return crypto.rsaEncrypt(toBuffer(input), publicKeyPEM).toString(output);
}

// 纯 JS HMAC-SHA256。宿主目前只暴露 SHA256 bytes，没有增量 hash，因此按标准 ipad/opad 拼接实现。
export function hmacSha256(message: string, key: string): string {
  const blockSize = 64;
  let keyBuf = Buffer.from(key, 'utf8');
  if ((keyBuf.length || 0) > blockSize) keyBuf = Buffer.from(sha256Hex(keyBuf), 'hex');
  const keyHex = keyBuf.toString('hex').padEnd(blockSize * 2, '0');
  const ipad: number[] = [];
  const opad: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    const b = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16) || 0;
    ipad.push(b ^ 0x36); opad.push(b ^ 0x5c);
  }
  const inner = crypto.sha256Bytes(Buffer.concat([Buffer.from(ipad), Buffer.from(message, 'utf8')]));
  return crypto.sha256Bytes(Buffer.concat([Buffer.from(opad), inner])).toString('hex');
}
