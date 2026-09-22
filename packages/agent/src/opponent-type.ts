import { choice, type EntryType } from "@typesafe-ai/sdk";
import type { JevBackend } from "./backend.js";

/** How an opponent has played so far in this session. */
export interface OpponentStats {
  hands: number;
  /** Share of hands in which they voluntarily put chips in preflop. */
  vpipPct: number;
  /** Share of hands in which they raised preflop. */
  pfrPct: number;
  /** Share of their postflop actions that were bets or raises. */
  postflopAggressionPct: number;
  /** Share of the postflop bets they faced that they folded to; absent until they have faced one. */
  foldToBetPct?: number;
}

export const OPPONENT_TYPES = {
  calling_station:
    "Enters many pots and calls far too often, rarely raises and rarely folds once in a hand.",
  nit: "Plays very few hands and gives up easily; when this player bets or raises the hand is strong.",
  maniac: "Bets and raises very often with a wide range of hands, many of them weak.",
  regular: "None of the above: a balanced player without an obvious leak.",
} as const;

export type OpponentType = keyof typeof OPPONENT_TYPES;

/** What to do about each type; only the lines for types present at the table are sent. */
export const OPPONENT_TYPE_GUIDANCE: Record<OpponentType, string | null> = {
  calling_station:
    "Against a calling_station: never bluff, because they do not fold. Bet good hands for value more often and larger than usual, including top pair, and keep betting on later streets.",
  nit: "Against a nit: steal their blinds and bet when they check, because they fold too much. When a nit bets or raises, believe them and fold everything but very strong hands.",
  maniac:
    "Against a maniac: their bets and raises mean much less than usual, so do not fold top pair or better to them; call and let them keep bluffing rather than bluffing them yourself, and raise for value with strong hands.",
  regular: null,
};

export const OPPONENT_TYPES_INTRO =
  "opponentTypes says what kind of player each live opponent has been in this session; adjust to the opponents who are actually in the hand with you.";

/** Below this many hands a percentage is noise, so no type is given. */
export const MIN_HANDS_FOR_TYPE = 20;

/**
 * When a player's tendencies are worth adjusting to: only once the player has lost this much
 * over at least this many hands. Tendency statistics alone do not tell a player whose leaks
 * cost money from one whose do not; the result does. Measured in bench/EXPERIMENTS.md (exp10).
 */
export const LOSING_PLAYER = { minHands: 100, maxBB100: -150 } as const;

/** True once `hands` and the result in bb/100 pass `LOSING_PLAYER`. */
export function isLosingPlayer(hands: number, bb100: number): boolean {
  return hands >= LOSING_PLAYER.minHands && bb100 <= LOSING_PLAYER.maxBB100;
}

/** Fixed thresholds over the session statistics. `null` while too few hands have been seen. */
export function classifyByThresholds(stats: OpponentStats): OpponentType | null {
  if (stats.hands < MIN_HANDS_FOR_TYPE) return null;
  if (stats.pfrPct >= 35 || (stats.vpipPct >= 50 && stats.postflopAggressionPct >= 50)) {
    return "maniac";
  }
  if (stats.vpipPct >= 45 && stats.pfrPct <= 15) return "calling_station";
  if (stats.vpipPct <= 18) return "nit";
  return "regular";
}

const CLASSIFY_TASK =
  "Classify a No-Limit Texas Hold'em opponent by how they have played in this session.";

const CLASSIFY_CONTEXT: readonly string[] = [
  "vpipPct: share of hands in which the player voluntarily put chips in before the flop. Around 20-30 is normal at a six-handed table; below 15 is very tight, above 45 is very loose.",
  "pfrPct: share of hands in which the player raised before the flop. Around 15-22 is normal; close to 0 means the player almost never raises.",
  "postflopAggressionPct: share of the player's postflop actions that were bets or raises. Around 25-40 is normal; below 15 is very passive, above 55 is very aggressive.",
  "foldToBetPct: share of the postflop bets the player faced that they folded to. Around 40-55 is normal; below 25 means the player almost never folds.",
  "Judge from the numbers together, not from a single one.",
];

export function buildClassifyQuestions() {
  return { opponent_type: choice("What kind of player is this opponent?", OPPONENT_TYPES) };
}

/**
 * Asks Jev what kind of player the statistics describe. Returns `null` instead of throwing:
 * a missing label just means the decision is made without one.
 */
export async function classifyWithJev(
  backend: JevBackend,
  stats: OpponentStats,
  options: { model?: string; signal?: AbortSignal } = {},
): Promise<OpponentType | null> {
  if (stats.hands < MIN_HANDS_FOR_TYPE) return null;
  try {
    const result = await backend.systemOne(
      {
        state: {
          task: CLASSIFY_TASK,
          importantContext: [...CLASSIFY_CONTEXT],
          opponent: { ...stats },
        } as unknown as EntryType,
        questions: buildClassifyQuestions(),
        ...(options.model === undefined ? {} : { model: options.model }),
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    const answer = result.answers.opponent_type.choice;
    return Object.hasOwn(OPPONENT_TYPES, answer) ? (answer as OpponentType) : null;
  } catch {
    return null;
  }
}
