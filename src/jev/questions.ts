import { choice, noul, score } from '@typesafe-ai/sdk';
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '@typesafe-ai/sdk';
import type { LegalActions } from '../engine/types.js';

export type ActionChoice = 'fold' | 'check_or_call' | 'bet_or_raise';

export const SIZING_LABELS = [
  'minimum',
  'about one third of the pot',
  'about two thirds of the pot',
  'about the pot',
  'an overbet',
  'all in',
] as const;

export type SizingLabels = typeof SIZING_LABELS;

const CHOICE_DESCRIPTIONS: Record<ActionChoice, string> = {
  fold: 'Give up the hand.',
  check_or_call: 'Check if free, otherwise match the current bet.',
  bet_or_raise: 'Put in a bet or raise.',
};

/** The three questions asked in a single `systemOne` call. */
export type JevQuestions = {
  /** Criteria hold only the currently legal choices, but are typed over all three so answers stay uniform. */
  action: ChoiceQuestion<Record<ActionChoice, string>>;
  sizing: ScoreQuestion<SizingLabels>;
  bluff_intent: NoulQuestion;
};

/** The legal choices, always in a stable fold → call → raise order. */
export function legalChoices(legal: LegalActions): ActionChoice[] {
  const choices: ActionChoice[] = [];
  if (legal.canFold) choices.push('fold');
  if (legal.canCheck || legal.callAmount !== null) choices.push('check_or_call');
  if (legal.minRaiseTo !== null) choices.push('bet_or_raise');
  return choices;
}

export function buildQuestions(legal: LegalActions): JevQuestions {
  const available = legalChoices(legal);
  // A seat always has at least a check or a call; keep the question answerable if it somehow does not.
  const keys = available.length > 0 ? available : (['check_or_call'] as ActionChoice[]);
  const criteria: Record<string, string> = {};
  for (const key of keys) criteria[key] = CHOICE_DESCRIPTIONS[key];

  return {
    action: choice('What should the acting player do?', criteria) as ChoiceQuestion<Record<ActionChoice, string>>,
    sizing: score('If betting or raising, how large?', SIZING_LABELS),
    bluff_intent: noul('Would a bet or raise here be primarily a bluff?'),
  };
}
