import { describe, expect, it } from 'vitest';
import { buildQuestions, legalChoices, SIZING_LABELS } from './questions.js';
describe('buildQuestions', () => {
  it('drops illegal choices', () => {
    expect(legalChoices({ canFold: false, canCheck: true, callAmount: null, minRaiseTo: null, maxRaiseTo: null })).toEqual(['check_or_call']);
    expect(Object.keys(buildQuestions({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 1000 }).action.criteria)).toEqual(['fold', 'check_or_call', 'bet_or_raise']);
  });
  it('sizing has 6 labels and bluff is a noul', () => {
    const q = buildQuestions({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 1000 });
    expect(q.sizing.criteria).toHaveLength(6); expect(q.bluff_intent.type).toBe('noul');
  });
});

describe('buildQuestions split format', () => {
  const legal = { canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 1000 };
  it('uses a big-blind rubric preflop and the pot rubric postflop, six labels each', () => {
    const pre = buildQuestions(legal, { street: 'preflop', style: 'split' });
    const post = buildQuestions(legal, { street: 'flop', style: 'split' });
    const unified = buildQuestions(legal, { street: 'preflop', style: 'unified' });
    expect(pre.sizing.criteria).toHaveLength(6);
    expect(pre.sizing.criteria[1]).toContain('2.5 big blinds');
    expect(post.sizing.criteria).toEqual(SIZING_LABELS);
    expect(unified.sizing.criteria).toEqual(SIZING_LABELS);
  });
});
