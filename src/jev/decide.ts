import {
  APIError,
  AuthenticationError,
  type EntryType,
  PermissionDeniedError,
} from "@typesafe-ai/sdk";
import type { Rng } from "../engine/rng";
import type { Action, HandSnapshot, LegalActions, SeatId } from "../engine/types";
import type { JevBackend } from "./backend";
import type { DecisionFeatures } from "./features";
import { type ActionLabel, buildQuestions, legalLabels } from "./questions";

export interface DecisionJev {
  readonly chosen: ActionLabel;
  readonly probabilities: Partial<Record<ActionLabel, number>>;
  readonly sizingScore: number;
  readonly bluffIntent: number;
  readonly model: string;
}

export interface DecisionRecord {
  readonly seat: SeatId;
  readonly action: Action;
  readonly jev: DecisionJev | null;
  readonly error: string | null;
  readonly errorKind: "auth" | "billing" | "other" | null;
  /** True when the action came from `fallbackAction`, not from Jev. */
  readonly fallback: boolean;
  readonly latencyMs: number;
}

export interface DecideInput {
  backend: JevBackend;
  seat: SeatId;
  features: DecisionFeatures;
  legal: LegalActions;
  snapshot: HandSnapshot;
  /** Persona variance, 0..1. */
  variance: number;
  rng: Rng;
  model?: string;
  signal?: AbortSignal;
}

const ALL_LABELS: readonly ActionLabel[] = ["fold", "check_or_call", "bet_or_raise"];

/** Never throws: any failure becomes a fallback action with `error` set. */
export async function decideAction(input: DecideInput): Promise<DecisionRecord> {
  const started = Date.now();
  const offered = legalLabels(input.legal);
  const finish = (partial: Omit<DecisionRecord, "seat" | "latencyMs">): DecisionRecord => ({
    seat: input.seat,
    latencyMs: Date.now() - started,
    ...partial,
  });

  if (offered.length === 0) {
    return finish({
      action: fallbackAction(input.legal),
      jev: null,
      error: "no legal actions",
      errorKind: "other",
      fallback: true,
    });
  }

  try {
    const result = await input.backend.systemOne(
      {
        state: input.features as unknown as EntryType,
        questions: buildQuestions(input.legal),
        ...(input.model === undefined ? {} : { model: input.model }),
      },
      input.signal === undefined ? undefined : { signal: input.signal },
    );
    const raw = result.answers.action.probabilities as Partial<Record<string, number>>;
    const probabilities: Partial<Record<ActionLabel, number>> = {};
    for (const label of offered) {
      const p = raw[label];
      if (typeof p === "number" && p > 0) probabilities[label] = p;
    }
    const jevBase = {
      probabilities,
      sizingScore: result.answers.sizing.score,
      bluffIntent: result.answers.bluff_intent.noul,
      model: result.model,
    };
    if (Object.keys(probabilities).length === 0) {
      return finish({
        action: fallbackAction(input.legal),
        jev: { ...jevBase, chosen: fallbackLabel(input.legal) },
        error: `Jev chose "${String(result.answers.action.choice)}", which was not offered`,
        errorKind: "other",
        fallback: true,
      });
    }
    const chosen = sampleLabel(probabilities, input.variance, input.rng);
    const action = toAction(chosen, jevBase.sizingScore, input.legal, input.snapshot, input.seat);
    return finish({
      action,
      jev: { ...jevBase, chosen },
      error: null,
      errorKind: null,
      fallback: false,
    });
  } catch (error) {
    return finish({
      action: fallbackAction(input.legal),
      jev: null,
      error: describeError(error),
      errorKind: errorKindFor(error),
      fallback: true,
    });
  }
}

export function fallbackAction(legal: LegalActions): Action {
  return legal.canCheck ? { type: "check" } : { type: "fold" };
}

function fallbackLabel(legal: LegalActions): ActionLabel {
  return legal.canCheck ? "check_or_call" : "fold";
}

/**
 * Picks a label. `variance` 0 → argmax; 1 → sample by probability;
 * in between → sharpen with exponent 1/variance.
 */
export function sampleLabel(
  probabilities: Partial<Record<ActionLabel, number>>,
  variance: number,
  rng: Rng,
): ActionLabel {
  const entries = ALL_LABELS.flatMap((label) => {
    const p = probabilities[label];
    return p !== undefined && p > 0 ? ([[label, p]] as [ActionLabel, number][]) : [];
  });
  if (entries.length === 0) throw new Error("no labels to sample");
  const v = Math.min(1, Math.max(0, variance));
  if (v === 0) {
    return entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  }
  const exponent = 1 / v;
  const weights = entries.map(([, p]) => p ** exponent);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return (entries[i] as [ActionLabel, number])[0];
  }
  return (entries[entries.length - 1] as [ActionLabel, number])[0];
}

/** Rubric index → pot fraction: [min, 1/3, 2/3, 1, 1.5, all-in]; interpolates between levels. */
export function sizingToAmount(
  score: number,
  legal: LegalActions,
  snapshot: HandSnapshot,
  seat: SeatId,
): number {
  if (legal.minRaiseTo === null || legal.maxRaiseTo === null) {
    throw new Error("raising is not legal");
  }
  if (score >= 4.5) return legal.maxRaiseTo;
  const fractions = [0, 1 / 3, 2 / 3, 1, 1.5];
  const clamped = Math.min(4, Math.max(0, score));
  const index = Math.min(3, Math.floor(clamped));
  const t = clamped - index;
  const fraction =
    (fractions[index] ?? 0) + ((fractions[index + 1] ?? 0) - (fractions[index] ?? 0)) * t;
  const me = snapshot.players.find((p) => p.seat === seat);
  const streetBet = me?.streetBet ?? 0;
  const toCall = Math.max(0, snapshot.currentBet - streetBet);
  const target =
    fraction === 0
      ? legal.minRaiseTo
      : Math.round(snapshot.currentBet + fraction * (snapshot.pot + toCall));
  return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target));
}

function toAction(
  label: ActionLabel,
  sizingScore: number,
  legal: LegalActions,
  snapshot: HandSnapshot,
  seat: SeatId,
): Action {
  switch (label) {
    case "fold":
      return legal.canFold ? { type: "fold" } : fallbackAction(legal);
    case "check_or_call":
      if (legal.canCheck) return { type: "check" };
      return legal.callAmount === null ? fallbackAction(legal) : { type: "call" };
    case "bet_or_raise": {
      if (legal.minRaiseTo === null) return fallbackAction(legal);
      const amount = sizingToAmount(sizingScore, legal, snapshot, seat);
      return snapshot.currentBet === 0 ? { type: "bet", amount } : { type: "raise", amount };
    }
  }
}

function isAuthError(error: unknown): boolean {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) return true;
  return error instanceof APIError && (error.status === 401 || error.status === 403);
}

/** HTTP 402: the TypeSafe account has run out of credit. */
function isBillingError(error: unknown): boolean {
  return error instanceof APIError && error.status === 402;
}

function errorKindFor(error: unknown): "auth" | "billing" | "other" {
  if (isAuthError(error)) return "auth";
  if (isBillingError(error)) return "billing";
  return "other";
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
