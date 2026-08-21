export const DEFAULT_QUALITY_KEY = 'playback_default_quality';
export const ALLOW_AUTO_DOWNGRADE_KEY = 'playback_allow_auto_downgrade';
export const SHOW_COMPATIBILITY_NOTICE_KEY = 'playback_show_compatibility_notice';
export const PLAYBACK_SETTINGS_CONFIGURED_KEY = 'playback_settings_configured';

export interface PlaybackSettings {
  default_quality: string;
  allow_auto_downgrade: boolean;
  show_compatibility_notice: boolean;
  configured: boolean;
}

function normalizeQuality(value: unknown, fallback = '320k'): string {
  const quality = String(value || '').trim().toLowerCase();
  if (!quality) return fallback;
  if (quality.length > 64 || !/^[a-z0-9][a-z0-9._+-]*$/.test(quality)) {
    throw new Error('默认音质标识无效');
  }
  return quality;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() !== 'false';
}

export async function getPlaybackSettings(): Promise<PlaybackSettings> {
  const [quality, allowDowngrade, showCompatibilityNotice, configured] = await Promise.all([
    songloft.persistentStorage.get(DEFAULT_QUALITY_KEY),
    songloft.persistentStorage.get(ALLOW_AUTO_DOWNGRADE_KEY),
    songloft.persistentStorage.get(SHOW_COMPATIBILITY_NOTICE_KEY),
    songloft.persistentStorage.get(PLAYBACK_SETTINGS_CONFIGURED_KEY),
  ]);
  return {
    default_quality: normalizeQuality(quality),
    allow_auto_downgrade: normalizeBoolean(allowDowngrade, true),
    show_compatibility_notice: normalizeBoolean(showCompatibilityNotice, true),
    configured: normalizeBoolean(configured, false),
  };
}

export async function setPlaybackSettings(value: Partial<PlaybackSettings>): Promise<PlaybackSettings> {
  const current = await getPlaybackSettings();
  const settings = {
    default_quality: normalizeQuality(value.default_quality, current.default_quality),
    allow_auto_downgrade: normalizeBoolean(value.allow_auto_downgrade, current.allow_auto_downgrade),
    show_compatibility_notice: normalizeBoolean(value.show_compatibility_notice, current.show_compatibility_notice),
    configured: true,
  };
  await Promise.all([
    songloft.persistentStorage.set(DEFAULT_QUALITY_KEY, settings.default_quality),
    songloft.persistentStorage.set(ALLOW_AUTO_DOWNGRADE_KEY, settings.allow_auto_downgrade),
    songloft.persistentStorage.set(SHOW_COMPATIBILITY_NOTICE_KEY, settings.show_compatibility_notice),
    songloft.persistentStorage.set(PLAYBACK_SETTINGS_CONFIGURED_KEY, true),
  ]);
  return settings;
}
