import { describe, expect, it } from 'vitest';
import { buildQuestions, legalChoices } from './questions.js';
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
