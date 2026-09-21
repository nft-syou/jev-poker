import type { PersonaPrompt } from "./features";

export type LocalizedText = { ja: string; en: string };

export interface Persona {
  readonly id: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  /** 0 = always the most likely action, 1 = sample exactly by Jev's probabilities. */
  readonly variance: number;
  readonly isPreset: boolean;
}

export const PERSONA_STORAGE_KEY = "jev-poker.personas";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PRESET_PERSONAS: readonly Persona[] = [
  {
    id: "rock",
    name: { en: "Rock", ja: "ロック" },
    description: {
      en: "Extremely tight and passive. Plays only premium hands, almost never bluffs, prefers calling to raising, and folds to aggression unless holding a very strong made hand.",
      ja: "超タイトでパッシブ。プレミアムハンドしか参加せず、ほぼブラフしない。レイズよりコールを好み、強い完成役がなければ攻められると降りる。",
    },
    variance: 0.2,
    isPreset: true,
  },
  {
    id: "tag",
    name: { en: "TAG", ja: "TAG" },
    description: {
      en: "Tight-aggressive. Plays a narrow range of strong hands but bets and raises them for value, continuation-bets often, semi-bluffs good draws, and folds marginal hands to pressure.",
      ja: "タイト・アグレッシブ。参加レンジは狭いが、入ったらバリューでベット・レイズする。CB を多用し、良いドローではセミブラフ。微妙なハンドは圧力に降りる。",
    },
    // Measured: at 0.3 a strong hand still folded about 9% of the time (bench/EXPERIMENTS.md).
    variance: 0.15,
    isPreset: true,
  },
  {
    id: "lag",
    name: { en: "LAG", ja: "LAG" },
    description: {
      en: "Loose-aggressive. Plays many hands, applies constant pressure with bets and raises, bluffs and semi-bluffs frequently, and uses position aggressively. Still folds when clearly beaten.",
      ja: "ルース・アグレッシブ。多くのハンドで参加し、ベットとレイズで常に圧力をかける。ブラフとセミブラフが多く、ポジションを積極的に使う。明らかに負けている時は降りる。",
    },
    variance: 0.6,
    isPreset: true,
  },
  {
    id: "maniac",
    name: { en: "Maniac", ja: "マニアック" },
    description: {
      en: "Hyper-aggressive gambler. Raises and re-raises with almost anything, rarely folds, loves big bets and all-ins, and treats every pot as worth fighting for.",
      ja: "超アグレッシブなギャンブラー。ほぼ何でもレイズ・リレイズし、めったに降りない。大きなベットとオールインが大好きで、全てのポットを取りに行く。",
    },
    variance: 0.8,
    isPreset: true,
  },
  {
    id: "station",
    name: { en: "Calling Station", ja: "コーリングステーション" },
    description: {
      en: "Calling station. Calls almost any bet to see more cards, rarely raises even with strong hands, hardly ever folds a pair or a draw, and almost never bluffs.",
      ja: "コーリングステーション。次のカードを見たくてほぼ何でもコールする。強い手でもあまりレイズせず、ペアやドローがあればほとんど降りない。ブラフはほぼしない。",
    },
    variance: 0.5,
    isPreset: true,
  },
];

export function clampVariance(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function personaPrompt(persona: Persona): PersonaPrompt {
  return { name: persona.name.en, description: persona.description.en };
}

export function duplicatePersona(source: Persona, id: string): Persona {
  return {
    id,
    name: { en: `${source.name.en} (copy)`, ja: `${source.name.ja} (コピー)` },
    description: { ...source.description },
    variance: source.variance,
    isPreset: false,
  };
}

export function loadPersonas(
  storage: KeyValueStorage | null | undefined = defaultStorage(),
): Persona[] {
  const presets = [...PRESET_PERSONAS];
  if (storage === null || storage === undefined) return presets;
  let raw: string | null;
  try {
    raw = storage.getItem(PERSONA_STORAGE_KEY);
  } catch {
    return presets;
  }
  if (raw === null) return presets;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return presets;
    const seenIds = new Set(presets.map((p) => p.id));
    const custom = parsed
      .filter(isPersona)
      .map((p) => ({ ...p, isPreset: false }))
      .filter((p) => {
        if (seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        return true;
      });
    return [...presets, ...custom];
  } catch {
    return presets;
  }
}

export function saveCustomPersonas(personas: readonly Persona[], storage: KeyValueStorage): void {
  const custom = personas.filter((p) => !p.isPreset);
  try {
    storage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // Storage may be unavailable (private mode); the game still works without persistence.
  }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isLocalized(value: unknown): value is LocalizedText {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LocalizedText).ja === "string" &&
    typeof (value as LocalizedText).en === "string"
  );
}

function isPersona(value: unknown): value is Persona {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<Persona>;
  return (
    typeof p.id === "string" &&
    isLocalized(p.name) &&
    isLocalized(p.description) &&
    typeof p.variance === "number"
  );
}
