import { describe, expect, it } from 'vitest';
import {
  aesDecrypt,
  aesEncrypt,
  authCodeToAesKey,
  decodeData,
  encodeData,
  generatePassword,
} from '../../src/lx_sync/crypto_lx';

describe('LX Music 协议加密与压缩', () => {
  it('按同步密码派生密钥并完成 AES 往返', () => {
    const key = authCodeToAesKey('LxBridge-test');
    const plain = 'lx-music auth::\n测试设备';
    expect(aesDecrypt(aesEncrypt(plain, key), key)).toBe(plain);
  });

  it('完成协议 gzip 数据封装往返', async () => {
    const plain = JSON.stringify({ action: 'list_sync_get_list_data', data: ['中文'.repeat(700), 1] });
    const encoded = await encodeData(plain);
    expect(encoded.startsWith('cg_')).toBe(true);
    expect(await decodeData(encoded)).toBe(plain);
  });

  it('生成适合直接输入 LX Music 的高强度密码', () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
