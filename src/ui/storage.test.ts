// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearApiKey,
  DEFAULT_SETTINGS,
  loadApiKey,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  saveApiKey,
  saveSettings,
  validateSettings,
} from "./storage";

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the api key", () => {
    expect(loadApiKey()).toBeNull();
    saveApiKey("  sk-1 ");
    expect(loadApiKey()).toBe("sk-1");
    clearApiKey();
    expect(loadApiKey()).toBeNull();
  });

  it("returns defaults for missing or broken settings", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{bad");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ seats: "nope", bigBlind: 4 }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, bigBlind: 4 });
  });

  it("round-trips settings", () => {
    const settings = { ...DEFAULT_SETTINGS, speed: "max" as const, startingStack: 500 };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it("validates blinds and stack", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, smallBlind: 5, bigBlind: 2 })).toBe(
      "invalidBlinds",
    );
    expect(validateSettings({ ...DEFAULT_SETTINGS, smallBlind: 0 })).toBe("invalidBlinds");
    expect(validateSettings({ ...DEFAULT_SETTINGS, startingStack: 15 })).toBe("invalidStack");
    expect(validateSettings({ ...DEFAULT_SETTINGS, startingStack: 10.5 })).toBe("invalidStack");
  });
});
