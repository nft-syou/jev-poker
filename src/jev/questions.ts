import type { LegalActions, Street } from "@jev-poker/engine";
import { choice, noul, score } from "@typesafe-ai/sdk";

export const ACTION_LABELS = {
  fold: "Give up the hand.",
  check_or_call: "Check if free, otherwise match the current bet.",
  bet_or_raise: "Put in a bet or raise.",
} as const;

export type ActionLabel = keyof typeof ACTION_LABELS;

/** How the state and questions are phrased: one shared format, or one per street group. */
export type PromptStyle = "unified" | "split";

/** Six sizing levels; `sizingToAmount` maps the level index to an amount. */
export type SizingRubric = readonly [string, string, string, string, string, string];

/** Pot-fraction rubric: every street in the unified format, postflop in the split format. */
export const SIZING_RUBRIC: SizingRubric = [
  "minimum",
  "about one third of the pot",
  "about two thirds of the pot",
  "about the pot",
  "an overbet",
  "all in",
];

/** Preflop rubric of the split format: opens in big blinds, re-raises as a multiple of the raise faced. */
export const PREFLOP_SIZING_RUBRIC: SizingRubric = [
  "minimum raise",
  "about 2.5 big blinds to open, or 2.5 times the raise faced",
  "about 3 big blinds to open, or 3 times the raise faced",
  "about 3.5 big blinds to open, or 3.5 times the raise faced",
  "about 4 big blinds to open, or 4 times the raise faced",
  "all in",
];

export interface QuestionOptions {
  street?: Street;
  style?: PromptStyle;
}

export function legalLabels(legal: LegalActions): ActionLabel[] {
  const labels: ActionLabel[] = [];
  if (legal.canFold) labels.push("fold");
  if (legal.canCheck || legal.callAmount !== null) labels.push("check_or_call");
  if (legal.minRaiseTo !== null) labels.push("bet_or_raise");
  return labels;
}

/** Which sizing rubric a decision uses. */
export function sizingRubricFor(street: Street | undefined, style: PromptStyle): SizingRubric {
  return style === "split" && street === "preflop" ? PREFLOP_SIZING_RUBRIC : SIZING_RUBRIC;
}

export function buildQuestions(legal: LegalActions, options: QuestionOptions = {}) {
  const criteria: Partial<Record<ActionLabel, string>> = {};
  for (const label of legalLabels(legal)) criteria[label] = ACTION_LABELS[label];
  return {
    action: choice(
      "What should the acting player do?",
      // Only legal labels exist at runtime; the full-record type keeps the SDK's answer
      // typing usable. Consumers MUST treat `answers.action.probabilities` as Partial.
      criteria as Record<ActionLabel, string>,
    ),
    sizing: score(
      "If betting or raising, how large?",
      sizingRubricFor(options.street, options.style ?? "unified"),
    ),
    bluff_intent: noul("Would a bet or raise here be primarily a bluff?"),
  };
}

export type PokerQuestions = ReturnType<typeof buildQuestions>;
