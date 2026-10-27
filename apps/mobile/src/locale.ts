import { resolveLocale, RTL_LOCALES, type Locale } from '@nomad/i18n';
import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
import { I18nManager } from 'react-native';

import { appStorage } from './storage';

let override: Locale | null = null;

export const setLocaleOverride = (locale: Locale | null) => {
  override = locale;
};

/** App locale: explicit override, else the device's first supported language, else en. */
export const currentLocale = (): Locale => override ?? resolveLocale(getLocales().map((l) => l.languageTag));

/** The layout direction the app last reloaded itself for (guards against a reload loop). */
const RELOADED_FOR_KEY = 'layout-direction-reloaded-for';

/**
 * Lines the native layout direction up with `locale` (ar, he are RTL). RN applies a direction change only after a
 * reload: with expo-updates enabled (release builds, and the dev client, which reloads from Metro) the app reloads
 * straight away, otherwise the change applies on the next launch. Reloads at most once per direction, so a
 * direction that doesn't stick can never loop.
 */
export function syncLayoutDirection(locale: Locale): void {
  const rtl = RTL_LOCALES.has(locale);
  const direction = rtl ? 'rtl' : 'ltr';
  if (I18nManager.isRTL === rtl) {
    appStorage.remove(RELOADED_FOR_KEY);
    return;
  }
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  if (!Updates.isEnabled || appStorage.getString(RELOADED_FOR_KEY) === direction) return;
  appStorage.set(RELOADED_FOR_KEY, direction);
  // Rejects when no reload is possible (e.g. Expo Go): the change still applies on the next launch.
  Updates.reloadAsync().catch(() => {});
}
