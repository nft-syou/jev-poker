import type {
  Action,
  HandPlayerSnapshot,
  HandSnapshot,
  LegalActions,
  Rng,
  SeatId,
} from "@jev-poker/engine";
import {
  APIError,
  AuthenticationError,
  type EntryType,
  PermissionDeniedError,
} from "@typesafe-ai/sdk";
import type { JevBackend } from "./backend";
import type { DecisionFeatures } from "./features";
import { type ActionLabel, buildQuestions, legalLabels, type PromptStyle } from "./questions";

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

/** The part of a hand's state that sizing a bet needs; a `HandSnapshot` is one. */
export type SizingSnapshot = Pick<HandSnapshot, "street" | "currentBet" | "pot" | "bigBlind"> & {
  readonly players: readonly Pick<HandPlayerSnapshot, "seat" | "streetBet">[];
};

export interface DecideInput {
  backend: JevBackend;
  seat: SeatId;
  features: DecisionFeatures;
  legal: LegalActions;
  snapshot: SizingSnapshot;
  /** Must match the style the features were built with; default `unified`. */
  promptStyle?: PromptStyle;
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
        questions: buildQuestions(input.legal, {
          street: input.snapshot.street,
          ...(input.promptStyle === undefined ? {} : { style: input.promptStyle }),
        }),
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

/** Below this, tempering is numerically pointless: take the most likely label instead. */
const MIN_VARIANCE = 0.05;

/**
 * Picks a label. `variance` near 0 → argmax; 1 → sample by probability;
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
  const mostLikely = () => entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  if (v <= MIN_VARIANCE) return mostLikely();
  const exponent = 1 / v;
  const weights = entries.map(([, p]) => p ** exponent);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0) || !Number.isFinite(total)) return mostLikely();
  let roll = rng.next() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return (entries[i] as [ActionLabel, number])[0];
  }
  return (entries[entries.length - 1] as [ActionLabel, number])[0];
}

/** Postflop size as a fraction of the pot after calling, by rubric level (the last is all-in). */
const POT_FRACTIONS: readonly number[] = [0, 1 / 3, 2 / 3, 1, 1.5];
/**
 * Preflop sizes by rubric level: big blinds for an open, a multiple of the raise faced for a
 * re-raise. Preflop sizes are conventionally expressed that way, not as a fraction of the pot.
 */
const PREFLOP_FACTORS: readonly number[] = [2, 2.5, 3, 3.5, 4];

/** Rubric level (rounded) → total bet or raise-to amount, clamped to what is legal. */
export function sizingToAmount(
  score: number,
  legal: LegalActions,
  snapshot: SizingSnapshot,
  seat: SeatId,
): number {
  if (legal.minRaiseTo === null || legal.maxRaiseTo === null) {
    throw new Error("raising is not legal");
  }
  const level = Math.min(5, Math.max(0, Math.round(score)));
  if (level === 5) return legal.maxRaiseTo;
  let target: number;
  if (snapshot.street === "preflop") {
    const factor = PREFLOP_FACTORS[level] ?? 2;
    const raiseFaced = snapshot.currentBet > snapshot.bigBlind ? snapshot.currentBet : null;
    target = factor * (raiseFaced ?? snapshot.bigBlind);
  } else {
    const fraction = POT_FRACTIONS[level] ?? 0;
    const me = snapshot.players.find((p) => p.seat === seat);
    const toCall = Math.max(0, snapshot.currentBet - (me?.streetBet ?? 0));
    // A pot-fraction bet is measured against the pot after calling, and a raise-to total adds
    // that to the bet being matched. The minimum raise is only a floor, not a base.
    target =
      fraction === 0 ? legal.minRaiseTo : snapshot.currentBet + fraction * (snapshot.pot + toCall);
  }
  return Math.round(Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target)));
}

function toAction(
  label: ActionLabel,
  sizingScore: number,
  legal: LegalActions,
  snapshot: SizingSnapshot,
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

/** Our own proxy's verdicts on a connection it cannot turn into any upstream request. */
const CONNECTION_CONFIG_ERRORS: readonly string[] = ["invalid_route", "invalid_gateway_config"];

function isAuthError(error: unknown): boolean {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) return true;
  if (!(error instanceof APIError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  // A 400 is normally about the request, not the credentials — except when it is the proxy
  // refusing the stored connection itself, which only the connection modal can fix.
  if (error.status !== 400) return false;
  const body = error.body;
  if (typeof body !== "object" || body === null) return false;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" && CONNECTION_CONFIG_ERRORS.includes(code);
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
