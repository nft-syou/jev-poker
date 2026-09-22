import type { SeatKind } from "@jev-poker/engine";
import { LANGUAGE_STORAGE_KEY, type Language } from "../i18n";
import { type Connection, validateConnection } from "../jev/connection";
import { EMPTY_STATS, type PlayerStats, type StatsKey } from "./stats";

export const CONNECTION_STORAGE_KEY = "jev-poker.connection";
/** Versions before the gateway routes stored a bare TypeSafe key here. */
export const LEGACY_API_KEY_STORAGE_KEY = "jev-poker.apiKey";
export const SETTINGS_STORAGE_KEY = "jev-poker.settings";
export const STATS_STORAGE_KEY = "jev-poker.stats";

export type Speed = "slow" | "normal" | "fast" | "max";
export const SPEEDS: readonly Speed[] = ["slow", "normal", "fast", "max"];

/** Allowed caps for `Settings.prefetchMaxInFlight`. */
export const PREFETCH_MAX_IN_FLIGHT_OPTIONS: readonly number[] = [2, 4, 6, 8];

export interface SeatSetting {
  name: string;
  kind: SeatKind;
  personaId: string;
}

export interface Settings {
  seats: SeatSetting[];
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  speed: Speed;
  model: string;
  /** Whether CPU turns are speculatively prefetched ahead of the acting seat's turn. */
  prefetch: boolean;
  /** Cap on concurrent speculative Jev requests; one of `PREFETCH_MAX_IN_FLIGHT_OPTIONS`. */
  prefetchMaxInFlight: number;
}

export const DEFAULT_SEATS: readonly SeatSetting[] = [
  { name: "You", kind: "human", personaId: "tag" },
  { name: "Rocky", kind: "cpu", personaId: "rock" },
  { name: "Tessa", kind: "cpu", personaId: "tag" },
  { name: "Lars", kind: "cpu", personaId: "lag" },
  { name: "Max", kind: "cpu", personaId: "maniac" },
  { name: "Callie", kind: "cpu", personaId: "station" },
];

export const DEFAULT_SETTINGS: Settings = {
  seats: [...DEFAULT_SEATS],
  startingStack: 200,
  smallBlind: 1,
  bigBlind: 2,
  speed: "normal",
  model: "jev-latest",
  prefetch: true,
  prefetchMaxInFlight: 6,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the app keeps working for this session only.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * The saved connection, or `null` when there is none. A record written by an older version
 * (a bare TypeSafe key) is migrated to the TypeSafe route once, then the old key is dropped.
 * Anything unparseable or no longer valid is treated as absent rather than trusted.
 */
export function loadConnection(): Connection | null {
  const raw = read(CONNECTION_STORAGE_KEY);
  if (raw !== null) {
    try {
      const result = validateConnection(JSON.parse(raw));
      if (result.ok) return result.connection;
    } catch {
      // Corrupt JSON: the modal asks for the credentials again.
    }
    return null;
  }
  const legacy = read(LEGACY_API_KEY_STORAGE_KEY);
  if (legacy === null) return null;
  const migrated = validateConnection({ route: "typesafe", apiKey: legacy });
  // Either way the old record goes: a key that cannot be migrated is a secret with no use
  // left, and keeping it would only leave it lying in storage.
  if (migrated.ok) saveConnection(migrated.connection);
  remove(LEGACY_API_KEY_STORAGE_KEY);
  return migrated.ok ? migrated.connection : null;
}

export function saveConnection(connection: Connection): void {
  write(CONNECTION_STORAGE_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  remove(CONNECTION_STORAGE_KEY);
  remove(LEGACY_API_KEY_STORAGE_KEY);
}

export function loadSettings(): Settings {
  const raw = read(SETTINGS_STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SEATS] };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      seats: isSeatArray(parsed.seats) ? parsed.seats : [...DEFAULT_SEATS],
      startingStack: numberOr(parsed.startingStack, DEFAULT_SETTINGS.startingStack),
      smallBlind: numberOr(parsed.smallBlind, DEFAULT_SETTINGS.smallBlind),
      bigBlind: numberOr(parsed.bigBlind, DEFAULT_SETTINGS.bigBlind),
      speed: isSpeed(parsed.speed) ? parsed.speed : DEFAULT_SETTINGS.speed,
      model:
        typeof parsed.model === "string" && parsed.model.length > 0
          ? parsed.model
          : DEFAULT_SETTINGS.model,
      prefetch: typeof parsed.prefetch === "boolean" ? parsed.prefetch : DEFAULT_SETTINGS.prefetch,
      prefetchMaxInFlight: isPrefetchMaxInFlight(parsed.prefetchMaxInFlight)
        ? parsed.prefetchMaxInFlight
        : DEFAULT_SETTINGS.prefetchMaxInFlight,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SEATS] };
  }
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Cumulative stats survive reloads, so they must survive a record written by an older
 * version too: anything unreadable degrades to zeroes instead of throwing at the table.
 */
export function loadCumulativeStats(): Record<StatsKey, PlayerStats> {
  const raw = read(STATS_STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<StatsKey, PlayerStats> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const fields = value as Partial<Record<keyof PlayerStats, unknown>>;
      const stats = { ...EMPTY_STATS };
      for (const field of Object.keys(EMPTY_STATS) as (keyof PlayerStats)[]) {
        stats[field] = numberOr(fields[field], 0);
      }
      result[key] = stats;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveCumulativeStats(record: Record<StatsKey, PlayerStats>): void {
  write(STATS_STORAGE_KEY, JSON.stringify(record));
}

export function clearCumulativeStats(): void {
  remove(STATS_STORAGE_KEY);
}

export function loadLanguage(): string | null {
  return read(LANGUAGE_STORAGE_KEY);
}

export function saveLanguage(language: Language): void {
  write(LANGUAGE_STORAGE_KEY, language);
}

export function validateSettings(settings: Settings): "invalidBlinds" | "invalidStack" | null {
  const { smallBlind, bigBlind, startingStack } = settings;
  if (!Number.isInteger(bigBlind) || bigBlind <= 0) return "invalidBlinds";
  if (!Number.isInteger(smallBlind) || smallBlind <= 0 || smallBlind > bigBlind)
    return "invalidBlinds";
  if (!Number.isInteger(startingStack) || startingStack < bigBlind * 10) return "invalidStack";
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isSpeed(value: unknown): value is Speed {
  return typeof value === "string" && (SPEEDS as readonly string[]).includes(value);
}

function isPrefetchMaxInFlight(value: unknown): value is number {
  return typeof value === "number" && PREFETCH_MAX_IN_FLIGHT_OPTIONS.includes(value);
}

function isSeatArray(value: unknown): value is SeatSetting[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 6 &&
    value.every(
      (s: Partial<SeatSetting>) =>
        typeof s.name === "string" &&
        (s.kind === "human" || s.kind === "cpu") &&
        typeof s.personaId === "string",
    )
  );
}
