import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import type { LegalActions, PlayerView } from '../engine/types.js';
import { compressState } from './compress.js';
import { buildQuestions, SIZING_LABELS } from './questions.js';
import { createMockBackend, createTypeSafeBackend } from './backend.js';
import { getPersona } from './personas.js';

const baseView: PlayerView = {
  seat: 0,
  street: 'preflop',
  holeCards: parseCards('Ah Ad'),
  board: [],
  stacks: [{ seat: 0, stack: 9000, isAllIn: false, folded: false }],
  pot: 300,
  toCall: 100,
  bigBlind: 100,
  position: 'BTN',
  history: [],
};
const allLegal: LegalActions = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 300, maxRaiseTo: 9000 };

function ask(view: PlayerView, legal: LegalActions = allLegal) {
  const backend = createMockBackend();
  return backend.systemOne(compressState(view, legal, getPersona('tag')), buildQuestions(legal));
}

describe('createMockBackend', () => {
  it('is deterministic and reports the mock model', async () => {
    const a = await ask(baseView);
    const b = await ask(baseView);
    expect(a.model).toBe('mock');
    expect(a.answers).toEqual(b.answers);
    expect(a.answers.bluff_intent).toEqual({ type: 'noul', noul: 0.1 });
  });

  it('raises premium preflop hands and folds trash', async () => {
    const aces = await ask(baseView);
    expect(aces.answers.action.choice).toBe('bet_or_raise');
    expect(aces.answers.action.probabilities.bet_or_raise).toBeCloseTo(1);
    expect(aces.answers.sizing.score).toBeCloseTo(4);

    const trash = await ask({ ...baseView, holeCards: parseCards('7c 2d') });
    expect(trash.answers.action.choice).toBe('fold');
    expect(trash.answers.sizing.score).toBeCloseTo(1.45);
  });

  it('only answers with legal choices and normalises them', async () => {
    const legal: LegalActions = { canFold: false, canCheck: true, callAmount: null, minRaiseTo: null, maxRaiseTo: null };
    const { answers } = await ask({ ...baseView, toCall: 0 }, legal);
    expect(Object.keys(answers.action.probabilities)).toEqual(['check_or_call']);
    expect(answers.action.choice).toBe('check_or_call');
    expect(answers.action.confidence).toBeCloseTo(1);
  });

  it('sums the restricted probabilities to one', async () => {
    const legal: LegalActions = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: null, maxRaiseTo: null };
    const { answers } = await ask({ ...baseView, holeCards: parseCards('Ts 9s') }, legal);
    const total = Object.values(answers.action.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    expect(Object.keys(answers.action.probabilities)).toEqual(['fold', 'check_or_call']);
  });

  it('returns a score legend covering the six sizing labels', async () => {
    const { answers } = await ask(baseView);
    expect(Object.values(answers.sizing.legend)).toEqual([...SIZING_LABELS]);
    const mass = Object.values(answers.sizing.probabilities).reduce((a, b) => a + b, 0);
    expect(mass).toBeCloseTo(1);
  });

  it('scores postflop strength from the made hand and draws', async () => {
    // Ah Kh on Qh Jh 2c: high_card (index 0) + a draw => t = 0.15
    const flop = await ask({ ...baseView, street: 'flop', holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c') });
    expect(flop.answers.sizing.score).toBeCloseTo(1.45);
    // A set of aces on the same board: three_of_a_kind (index 3) => t = 3/8
    const set = await ask({ ...baseView, street: 'flop', holeCards: parseCards('Ah Ad'), board: parseCards('As Jc 2c') });
    expect(set.answers.sizing.score).toBeCloseTo(1 + 3 * (3 / 8));
  });
});

describe('createTypeSafeBackend', () => {
  it('builds a typesafe backend without touching the network', () => {
    const backend = createTypeSafeBackend({ apiKey: 'test-key', model: 'jev-latest', timeoutMs: 1234 });
    expect(backend.kind).toBe('typesafe');
  });
});
