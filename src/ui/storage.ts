import type { SeatKind } from "../engine/types";
import { LANGUAGE_STORAGE_KEY, type Language } from "../i18n";

export const API_KEY_STORAGE_KEY = "jev-poker.apiKey";
export const SETTINGS_STORAGE_KEY = "jev-poker.settings";

export type Speed = "slow" | "normal" | "fast" | "max";
export const SPEEDS: readonly Speed[] = ["slow", "normal", "fast", "max"];

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

export function loadApiKey(): string | null {
  const key = read(API_KEY_STORAGE_KEY)?.trim() ?? "";
  return key.length > 0 ? key : null;
}

export function saveApiKey(key: string): void {
  write(API_KEY_STORAGE_KEY, key.trim());
}

export function clearApiKey(): void {
  remove(API_KEY_STORAGE_KEY);
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
    };
  } catch {
    return { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SEATS] };
  }
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
