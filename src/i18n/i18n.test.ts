import { describe, expect, it } from "vitest";
import { detectLanguage, initI18n } from "./index";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix === "" ? k : `${prefix}.${k}`));
}

describe("i18n", () => {
  it("has identical key sets in en and ja", () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it("has no empty strings", () => {
    for (const dict of [en, ja]) {
      for (const key of keys(dict)) {
        const value = key
          .split(".")
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], dict);
        expect(typeof value === "string" && value.length > 0, key).toBe(true);
      }
    }
  });

  it("detects the language from storage first, then the browser", () => {
    expect(detectLanguage("ja", "en-US")).toBe("ja");
    expect(detectLanguage("en", "ja-JP")).toBe("en");
    expect(detectLanguage(null, "ja-JP")).toBe("ja");
    expect(detectLanguage(null, "fr")).toBe("en");
    expect(detectLanguage("xx", undefined)).toBe("en");
  });

  it("initializes once and translates", () => {
    const i18n = initI18n("ja");
    expect(i18n.t("actions.fold")).toBe(ja.actions.fold);
    initI18n("en");
    expect(i18n.language).toBe("ja");
  });
});
