import { describe, expect, it } from 'vitest';
import { normalizeCustomServerAddress } from '../../src/lx_sync/service';

describe('LX Music 自定义服务地址', () => {
  it('为外部 IP 和端口补齐协议及插件路径', () => {
    expect(normalizeCustomServerAddress('10.0.3.14:8080')).toBe(
      'http://10.0.3.14:8080/api/v1/jsplugin/neo-lxbridge',
    );
  });

  it('保留 HTTPS 域名和反向代理前缀', () => {
    expect(normalizeCustomServerAddress('https://music.example.com/songloft/')).toBe(
      'https://music.example.com/songloft/api/v1/jsplugin/neo-lxbridge',
    );
  });

  it('不会重复添加完整插件路径', () => {
    const address = 'https://music.example.com/api/v1/jsplugin/neo-lxbridge/';
    expect(normalizeCustomServerAddress(address)).toBe(address.slice(0, -1));
  });

  it('拒绝非 HTTP 协议', () => {
    expect(() => normalizeCustomServerAddress('ftp://music.example.com')).toThrow('HTTP');
  });
});
