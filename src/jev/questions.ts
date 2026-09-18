import { choice, noul, score } from "@typesafe-ai/sdk";
import type { LegalActions } from "../engine/types";

export const ACTION_LABELS = {
  fold: "Give up the hand and lose what is already in the pot.",
  check_or_call: "Check if nobody has bet, otherwise call the current bet.",
  bet_or_raise: "Bet if nobody has bet, otherwise raise. Sizing is asked separately.",
} as const;

export type ActionLabel = keyof typeof ACTION_LABELS;

export const SIZING_RUBRIC = [
  "the minimum bet or raise",
  "about one third of the pot",
  "about two thirds of the pot",
  "about the size of the pot",
  "an overbet of about 1.5 times the pot",
  "all in",
] as const;

export function legalLabels(legal: LegalActions): ActionLabel[] {
  const labels: ActionLabel[] = [];
  if (legal.canFold) labels.push("fold");
  if (legal.canCheck || legal.callAmount !== null) labels.push("check_or_call");
  if (legal.minRaiseTo !== null) labels.push("bet_or_raise");
  return labels;
}

export function buildQuestions(legal: LegalActions) {
  const criteria: Partial<Record<ActionLabel, string>> = {};
  for (const label of legalLabels(legal)) criteria[label] = ACTION_LABELS[label];
  return {
    action: choice(
      "What should the acting player do now?",
      // Only legal labels exist at runtime; the full-record type keeps the SDK's answer
      // typing usable. Consumers MUST treat `answers.action.probabilities` as Partial.
      criteria as Record<ActionLabel, string>,
    ),
    sizing: score(
      "If the player bets or raises, how large should it be relative to the pot?",
      SIZING_RUBRIC,
    ),
    bluff_intent: noul("Would a bet or raise here be primarily a bluff rather than a value bet?"),
  };
}

export type PokerQuestions = ReturnType<typeof buildQuestions>;
