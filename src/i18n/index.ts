/**
 * i18n setup — react-i18next with OS/browser language detection and
 * persistence via LocalBro's settings store.
 *
 * We deliberately do NOT use `i18next-browser-languagedetector`'s
 * localStorage probe: LocalBro already has a settings.json file on
 * disk, and we want one source of truth.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as api from "../api";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export const LOCALE_KEY = "ui.locale";
export const SUPPORTED = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED)[number];

/** Pick the closest supported locale for a raw BCP-47 tag. */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return "en";
  const t = tag.toLowerCase();
  if (t === "zh-cn" || t === "zh" || t.startsWith("zh-cn")) return "zh-CN";
  if (t.startsWith("zh")) return "zh-CN"; // zh-TW etc. — best effort, we only ship zh-CN
  return "en";
}

/** Synchronously initialise with the navigator's guess, then async-upgrade. */
export async function initI18n(): Promise<void> {
  // 1. Synchronous init with the best guess available before awaiting.
  const navGuess = resolveLocale(typeof navigator !== "undefined" ? navigator.language : null);

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
    lng: navGuess,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  // 2. Override from persisted user choice if any.
  try {
    const saved = await api.settingsGet<string>(LOCALE_KEY);
    if (saved && SUPPORTED.includes(saved as Locale) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    /* first run or settings unavailable — stick with navGuess */
  }
}

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  await api.settingsSet(LOCALE_KEY, locale);
}

export default i18n;
