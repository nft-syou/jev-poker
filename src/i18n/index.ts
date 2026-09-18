import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

export type Language = "en" | "ja";
export const LANGUAGES: readonly Language[] = ["en", "ja"];
export const LANGUAGE_STORAGE_KEY = "jev-poker.lang";

export function detectLanguage(
  stored: string | null,
  navigatorLanguage: string | undefined,
): Language {
  if (stored === "ja" || stored === "en") return stored;
  return navigatorLanguage?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** Initializes i18next once; later calls return the same instance without changing language. */
export function initI18n(language: Language): typeof i18next {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources: { en: { translation: en }, ja: { translation: ja } },
      lng: language,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
  }
  return i18next;
}

export default i18next;
