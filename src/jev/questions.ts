import { choice, noul, score } from '@typesafe-ai/sdk';
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '@typesafe-ai/sdk';
import type { LegalActions, Street } from '../engine/types.js';

export type ActionChoice = 'fold' | 'check_or_call' | 'bet_or_raise';

/** How the state and questions are phrased: one shared format, or one per street group. */
export type PromptStyle = 'unified' | 'split';

/** Six sizing levels; `answersToAction` maps the level index to an amount, so every label set has exactly six entries. */
export type SizingLabels = readonly [string, string, string, string, string, string];

/** Pot-fraction rubric used for every street in the unified format and postflop in the split format. */
export const SIZING_LABELS: SizingLabels = [
  'minimum',
  'about one third of the pot',
  'about two thirds of the pot',
  'about the pot',
  'an overbet',
  'all in',
];

/** Preflop rubric for the split format: opens in big blinds, re-raises as a multiple of the raise faced. */
export const PREFLOP_SIZING_LABELS: SizingLabels = [
  'minimum raise',
  'about 2.5 big blinds to open, or 2.5 times the raise faced',
  'about 3 big blinds to open, or 3 times the raise faced',
  'about 3.5 big blinds to open, or 3.5 times the raise faced',
  'about 4 big blinds to open, or 4 times the raise faced',
  'all in',
];

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

export interface QuestionOptions {
  street?: Street;
  style?: PromptStyle;
}

/** Which sizing rubric a decision uses. */
export function sizingLabelsFor(street: Street | undefined, style: PromptStyle): SizingLabels {
  return style === 'split' && street === 'preflop' ? PREFLOP_SIZING_LABELS : SIZING_LABELS;
}

/** The legal choices, always in a stable fold → call → raise order. */
export function legalChoices(legal: LegalActions): ActionChoice[] {
  const choices: ActionChoice[] = [];
  if (legal.canFold) choices.push('fold');
  if (legal.canCheck || legal.callAmount !== null) choices.push('check_or_call');
  if (legal.minRaiseTo !== null) choices.push('bet_or_raise');
  return choices;
}

export function buildQuestions(legal: LegalActions, opts: QuestionOptions = {}): JevQuestions {
  const available = legalChoices(legal);
  // A seat always has at least a check or a call; keep the question answerable if it somehow does not.
  const keys = available.length > 0 ? available : (['check_or_call'] as ActionChoice[]);
  const criteria: Record<string, string> = {};
  for (const key of keys) criteria[key] = CHOICE_DESCRIPTIONS[key];
  const labels = sizingLabelsFor(opts.street, opts.style ?? 'unified');

  return {
    action: choice('What should the acting player do?', criteria) as ChoiceQuestion<Record<ActionChoice, string>>,
    sizing: score('If betting or raising, how large?', labels) as ScoreQuestion<SizingLabels>,
    bluff_intent: noul('Would a bet or raise here be primarily a bluff?'),
  };
}
