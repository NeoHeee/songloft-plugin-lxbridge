import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('发布版本一致性', () => {
  it('package、插件清单和页面徽标使用同一版本', () => {
    const root = resolve(import.meta.dirname, '..');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
    const pluginJson = JSON.parse(readFileSync(resolve(root, 'plugin.json'), 'utf8')) as { version: string };
    const html = readFileSync(resolve(root, 'static/index.html'), 'utf8');
    const badgeVersion = html.match(/class="version-badge">v([^<]+)</)?.[1];

    expect(pluginJson.version).toBe(packageJson.version);
    expect(badgeVersion).toBe(packageJson.version);
  });
});
