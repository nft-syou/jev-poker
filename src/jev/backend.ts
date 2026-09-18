import { TypeSafeClient } from '@typesafe-ai/sdk';
import type {
  ChoiceResponse,
  JsonValue,
  NoulResponse,
  ScoreLegend,
  ScoreResponse,
  SystemOneResult,
  TypeSafeClientConfig,
} from '@typesafe-ai/sdk';
import { CATEGORY_ORDER } from '../engine/evaluate.js';
import type { PreflopStrength } from '../engine/strength.js';
import type { JevHand, JevState } from './compress.js';
import { SIZING_LABELS, type ActionChoice, type JevQuestions, type SizingLabels } from './questions.js';

/** Answers to `buildQuestions`, typed by the question set. */
export type JevAnswers = SystemOneResult<JevQuestions>['answers'];

export interface JevBackend {
  kind: 'typesafe' | 'mock';
  systemOne(state: JevState, questions: JevQuestions): Promise<{ answers: JevAnswers; model: string }>;
}

export interface TypeSafeBackendOptions {
  /** Falls back to `TYPESAFE_API_KEY` in the SDK when omitted. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** The real backend: one `systemOne` round trip per decision. */
export function createTypeSafeBackend(opts: TypeSafeBackendOptions = {}): JevBackend {
  const config: TypeSafeClientConfig = {
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    ...(opts.model !== undefined ? { defaultModel: opts.model } : {}),
  };
  const client = new TypeSafeClient(config);

  return {
    kind: 'typesafe',
    async systemOne(state, questions) {
      const result = await client.systemOne({
        // The compressed state is already JSON-shaped; it is sent as built.
        state: state as unknown as { [key: string]: JsonValue },
        questions,
      });
      return { answers: result.answers, model: result.model };
    },
  };
}

const PREFLOP_T: Record<PreflopStrength, number> = {
  premium: 1,
  strong: 0.8,
  medium: 0.55,
  weak: 0.35,
  trash: 0.15,
};

/** A crude hand strength in [0, 1], used only by the mock backend. */
function strengthOf(hand: JevHand): number {
  if (hand.madeHand === undefined) return PREFLOP_T[hand.preflopStrength ?? 'trash'];
  const index = CATEGORY_ORDER.indexOf(hand.madeHand);
  const drawBonus = (hand.draws?.length ?? 0) > 0 ? 0.15 : 0;
  return Math.min(1, index / (CATEGORY_ORDER.length - 1) + drawBonus);
}

function mockAction(hand: JevHand, questions: JevQuestions): ChoiceResponse<Record<ActionChoice, string>> {
  const t = strengthOf(hand);
  const raw: Record<ActionChoice, number> = {
    fold: (1 - t) ** 2,
    check_or_call: Math.max(0, 1 - t ** 2 - (1 - t) ** 2),
    bet_or_raise: t ** 2,
  };

  const keys = Object.keys(questions.action.criteria) as ActionChoice[];
  const total = keys.reduce((sum, key) => sum + raw[key], 0);
  const probabilities: Partial<Record<ActionChoice, number>> = {};
  for (const key of keys) probabilities[key] = total > 0 ? raw[key] / total : 1 / keys.length;

  let best = keys[0] ?? 'check_or_call';
  for (const key of keys) if ((probabilities[key] ?? 0) > (probabilities[best] ?? 0)) best = key;

  return {
    type: 'choice',
    choice: best,
    confidence: probabilities[best] ?? 0,
    probabilities: probabilities as Record<ActionChoice, number>,
  };
}

function mockSizing(hand: JevHand): ScoreResponse<SizingLabels> {
  const score = 1 + 3 * strengthOf(hand);
  const peak = Math.min(SIZING_LABELS.length - 1, Math.max(0, Math.round(score)));
  const legend: Record<string, string> = {};
  const probabilities: Record<string, number> = {};
  SIZING_LABELS.forEach((label, i) => {
    legend[String(i)] = label;
    probabilities[String(i)] = i === peak ? 1 : 0;
  });

  return {
    type: 'score',
    score,
    confidence: 1,
    legend: legend as unknown as ScoreLegend<SizingLabels>,
    probabilities: probabilities as unknown as ScoreResponse<SizingLabels>['probabilities'],
  };
}

const MOCK_BLUFF: NoulResponse = { type: 'noul', noul: 0.1 };

/** A deterministic offline backend derived from `state.hand`, for tests and development. */
export function createMockBackend(): JevBackend {
  return {
    kind: 'mock',
    systemOne(state, questions) {
      return Promise.resolve({
        answers: {
          action: mockAction(state.hand, questions),
          sizing: mockSizing(state.hand),
          bluff_intent: MOCK_BLUFF,
        },
        model: 'mock',
      });
    },
  };
}
