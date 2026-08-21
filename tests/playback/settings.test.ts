import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('playback settings', () => {
  const values = new Map<string, unknown>();

  beforeEach(() => {
    values.clear();
    vi.resetModules();
    (globalThis as typeof globalThis & { songloft: unknown }).songloft = {
      persistentStorage: {
        get: vi.fn(async (key: string) => values.get(key)),
        set: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
      },
    };
  });

  it('enables the compatibility notice by default', async () => {
    const { getPlaybackSettings } = await import('../../src/playback/settings');
    await expect(getPlaybackSettings()).resolves.toMatchObject({
      show_compatibility_notice: true,
      configured: false,
    });
  });

  it('persists the compatibility notice preference', async () => {
    const { getPlaybackSettings, setPlaybackSettings } = await import('../../src/playback/settings');
    await expect(setPlaybackSettings({ show_compatibility_notice: false })).resolves.toMatchObject({
      show_compatibility_notice: false,
      configured: true,
    });
    await expect(getPlaybackSettings()).resolves.toMatchObject({
      show_compatibility_notice: false,
      configured: true,
    });
  });
});
