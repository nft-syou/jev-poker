// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "../jev/connection";
import { EMPTY_STATS, type PlayerStats } from "./stats";
import {
  CONNECTION_STORAGE_KEY,
  clearConnection,
  clearCumulativeStats,
  DEFAULT_SETTINGS,
  LEGACY_API_KEY_STORAGE_KEY,
  loadConnection,
  loadCumulativeStats,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  STATS_STORAGE_KEY,
  saveConnection,
  saveCumulativeStats,
  saveSettings,
  validateSettings,
} from "./storage";

const CF: Connection = {
  route: "cloudflare",
  apiKey: "sk-cf",
  accountId: "0123456789abcdef0123456789abcdef",
  gatewayId: "my-gateway",
  providerSlug: "typesafe",
  gatewayToken: "tok-1",
};

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a connection on every route", () => {
    expect(loadConnection()).toBeNull();
    for (const connection of [
      { route: "typesafe", apiKey: "sk-1" } as const,
      { route: "vercel", apiKey: "vck_1" } as const,
      CF,
    ]) {
      saveConnection(connection);
      expect(loadConnection()).toEqual(connection);
    }
    clearConnection();
    expect(loadConnection()).toBeNull();
  });

  it("migrates a legacy api key to the typesafe route exactly once", () => {
    localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, "  sk-old ");
    expect(loadConnection()).toEqual({ route: "typesafe", apiKey: "sk-old" });
    // The migration persisted under the new key and removed the old one.
    expect(localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(CONNECTION_STORAGE_KEY) ?? "null")).toEqual({
      route: "typesafe",
      apiKey: "sk-old",
    });
    expect(loadConnection()).toEqual({ route: "typesafe", apiKey: "sk-old" });
  });

  it("leaves a stored connection alone when a legacy key is also present", () => {
    saveConnection({ route: "vercel", apiKey: "vck_1" });
    localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, "sk-old");
    expect(loadConnection()).toEqual({ route: "vercel", apiKey: "vck_1" });
    clearConnection();
    expect(loadConnection()).toBeNull();
  });

  it("treats corrupt, empty or no-longer-valid records as no connection", () => {
    for (const raw of [
      "{bad",
      "null",
      "[]",
      '"sk-1"',
      JSON.stringify({ route: "openai", apiKey: "sk-1" }),
      JSON.stringify({ route: "typesafe", apiKey: "" }),
      JSON.stringify({ route: "cloudflare", apiKey: "k", accountId: "../", gatewayId: "gw" }),
    ]) {
      localStorage.setItem(CONNECTION_STORAGE_KEY, raw);
      expect(loadConnection(), raw).toBeNull();
    }
    localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, "   ");
    localStorage.removeItem(CONNECTION_STORAGE_KEY);
    expect(loadConnection()).toBeNull();
  });

  it("returns defaults for missing or broken settings", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{bad");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ seats: "nope", bigBlind: 4 }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, bigBlind: 4 });
  });

  it("falls back to defaults for an invalid prefetch or prefetchMaxInFlight", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ prefetch: "nope", prefetchMaxInFlight: 5 }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ prefetch: false, prefetchMaxInFlight: 8 }),
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      prefetch: false,
      prefetchMaxInFlight: 8,
    });
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

  it("round-trips cumulative stats", () => {
    expect(loadCumulativeStats()).toEqual({});
    const stats: PlayerStats = { ...EMPTY_STATS, handsPlayed: 4, handsWon: 1, netChips: -12 };
    saveCumulativeStats({ "persona:rock": stats, "human:You": EMPTY_STATS });
    expect(loadCumulativeStats()).toEqual({ "persona:rock": stats, "human:You": EMPTY_STATS });
    clearCumulativeStats();
    expect(loadCumulativeStats()).toEqual({});
  });

  it("tolerates broken or partial cumulative stats", () => {
    localStorage.setItem(STATS_STORAGE_KEY, "{bad");
    expect(loadCumulativeStats()).toEqual({});
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify([1, 2]));
    expect(loadCumulativeStats()).toEqual({});
    // Fields added after an old record was written fall back to zero.
    localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({ "persona:rock": { handsPlayed: 3, netChips: "nope" }, bogus: 7 }),
    );
    expect(loadCumulativeStats()).toEqual({ "persona:rock": { ...EMPTY_STATS, handsPlayed: 3 } });
  });
});
