import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import type { LegalActions } from '../engine/types.js';
import { Rng } from '../engine/rng.js';
import { randomView, isLegal } from '../agents/testutil.js';
import { JevAgent, answersToAction } from './agent.js';
import { createMockBackend } from './backend.js';
import { getPersona } from './personas.js';
import type { JevAnswers } from './backend.js';

const legal = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 300, maxRaiseTo: 10000 };
const view = { seat: 0, street: 'flop' as const, holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c'), stacks: [], pot: 600, toCall: 100, bigBlind: 100, position: 'BTN' as const, history: [] };
const answers = (p: Record<string, number>, score = 3): JevAnswers => ({
  action: { type: 'choice', choice: 'fold', confidence: 1, probabilities: p } as never,
  sizing: { type: 'score', score, confidence: 1, legend: {} as never, probabilities: {} as never },
  bluff_intent: { type: 'noul', noul: 0.2 },
});

describe('answersToAction', () => {
  it('variance 0 takes argmax', () => {
    const r = answersToAction(answers({ fold: 0.2, check_or_call: 0.5, bet_or_raise: 0.3 }), legal, view, 0, new Rng(1));
    expect(r.action).toEqual({ type: 'call' });
  });
  it('variance 1 samples by probability', () => {
    const rng = new Rng(2); const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) { const r = answersToAction(answers({ fold: 0.5, check_or_call: 0.5, bet_or_raise: 0 }), legal, view, 1, rng); counts[r.choice] = (counts[r.choice] ?? 0) + 1; }
    expect(counts['fold']).toBeGreaterThan(400); expect(counts['check_or_call']).toBeGreaterThan(400); expect(counts['bet_or_raise']).toBeUndefined();
  });
  it('maps sizing to a clamped raise and all-in at the top', () => {
    expect(answersToAction(answers({ bet_or_raise: 1 }, 0), legal, view, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 300 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 3), legal, view, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 1000 });  // 300 + 1.0*(600+100)
    expect(answersToAction(answers({ bet_or_raise: 1 }, 5), legal, view, 0, new Rng(1)).action).toEqual({ type: 'allin' });
  });
  it('ignores illegal choices', () => {
    const r = answersToAction(answers({ fold: 0.9, check_or_call: 0.1, bet_or_raise: 0 }), { ...legal, canFold: false, canCheck: true, callAmount: null }, view, 0, new Rng(1));
    expect(r.action).toEqual({ type: 'check' });
  });
});

describe('JevAgent', () => {
  it('returns legal actions with the mock backend and records decisions', { timeout: 30_000 }, async () => {
    const records: unknown[] = [];
    const agent = new JevAgent({ persona: getPersona('tag'), backend: createMockBackend(), seed: 1, onDecision: (r) => records.push(r) });
    const rng = new Rng(4);
    for (let i = 0; i < 200; i++) { const { view, legal } = randomView(rng); expect(isLegal(await agent.decide(view, legal), legal)).toBe(true); }
    expect(records).toHaveLength(200);
  });
  it('fails open on backend error', async () => {
    const backend = { kind: 'mock' as const, systemOne: async () => { throw new Error('boom'); } };
    const records: { error?: string }[] = [];
    const agent = new JevAgent({ persona: getPersona('tag'), backend, seed: 1, onDecision: (r) => records.push(r) });
    expect(await agent.decide(view, legal)).toEqual({ type: 'fold' });
    expect(await agent.decide({ ...view, toCall: 0 }, { ...legal, canFold: false, canCheck: true, callAmount: null })).toEqual({ type: 'check' });
    expect(records[0]?.error).toBe('boom');
  });
});

describe('answersToAction sizing steps', () => {
  const at = (score: number, over: Partial<LegalActions> = {}) =>
    answersToAction(answers({ bet_or_raise: 1 }, score), { ...legal, ...over }, view, 0, new Rng(1)).action;

  it('maps the pot fractions between the extremes', () => {
    expect(at(1)).toEqual({ type: 'raise', amount: 533 }); // 300 + (1/3)*700
    expect(at(2)).toEqual({ type: 'raise', amount: 767 }); // 300 + (2/3)*700
    expect(at(4)).toEqual({ type: 'raise', amount: 1350 }); // 300 + 1.5*700
  });
  it('goes all-in when the clamped raise reaches the maximum', () => {
    expect(at(3, { maxRaiseTo: 900 })).toEqual({ type: 'allin' });
  });
  it('bets rather than raises when checking is free', () => {
    expect(at(3, { canCheck: true, canFold: false, callAmount: null })).toEqual({ type: 'bet', amount: 1000 });
  });
  it('never returns a raise when raising is impossible', () => {
    const r = answersToAction(answers({ fold: 0.1, check_or_call: 0.9, bet_or_raise: 1 }, 3), { ...legal, minRaiseTo: null, maxRaiseTo: null }, view, 0, new Rng(1));
    expect(r.choice).toBe('check_or_call');
    expect(r.action).toEqual({ type: 'call' });
    expect(r.sizingScore).toBeNull();
  });
});

describe('JevAgent records', () => {
  it('names itself after the persona and reports mock calls as offline', async () => {
    const records: import('./agent.js').DecisionRecord[] = [];
    const agent = new JevAgent({ persona: getPersona('rock'), backend: createMockBackend(), seed: 7, onDecision: (r) => records.push(r) });
    expect(agent.id).toBe('jev:rock');
    await agent.decide(view, legal);
    const record = records[0]!;
    expect(record.apiCall).toBe(false);
    expect(record.model).toBe('mock');
    expect(record.bluffIntent).toBe(0.1);
    expect(record.street).toBe('flop');
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    const total = Object.values(record.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });

  it('fails open when building the state throws', async () => {
    const records: import('./agent.js').DecisionRecord[] = [];
    const agent = new JevAgent({ persona: getPersona('tag'), backend: createMockBackend(), seed: 1, onDecision: (r) => records.push(r) });
    // No hole cards: `preflopStrength` throws inside `compressState`, before any backend call.
    expect(await agent.decide({ ...view, holeCards: [] }, legal)).toEqual({ type: 'fold' });
    expect(await agent.decide({ ...view, holeCards: [], toCall: 0 }, { ...legal, canFold: false, canCheck: true, callAmount: null })).toEqual({ type: 'check' });
    expect(records).toHaveLength(2);
    expect(records[0]?.error).toBeDefined();
    expect(records[0]).toMatchObject({ apiCall: false, choice: 'fold', sizingScore: null, bluffIntent: null });
    expect(records[1]?.error).toBeDefined();
    expect(records[1]?.choice).toBe('check_or_call');
  });

  it('counts a failed typesafe request as an api call', async () => {
    const records: import('./agent.js').DecisionRecord[] = [];
    const backend = { kind: 'typesafe' as const, systemOne: () => Promise.reject(new Error('offline')) };
    const agent = new JevAgent({ persona: getPersona('tag'), backend, seed: 1, onDecision: (r) => records.push(r) });
    expect(await agent.decide(view, legal)).toEqual({ type: 'fold' });
    expect(records[0]).toMatchObject({ apiCall: true, error: 'offline', sizingScore: null, bluffIntent: null });
  });
});

describe('answersToAction preflop sizing', () => {
  const pre = { ...view, street: 'preflop' as const, board: [], pot: 150, toCall: 100, bigBlind: 100 };
  const open = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 200, maxRaiseTo: 10000 };
  it('opens in big blinds, not pot fractions', () => {
    expect(answersToAction(answers({ bet_or_raise: 1 }, 0), open, pre, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 200 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 2), open, pre, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 300 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 4), open, pre, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 400 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 5), open, pre, 0, new Rng(1)).action).toEqual({ type: 'allin' });
  });
  it('re-raises as a multiple of the raise faced', () => {
    const faced = { ...pre, pot: 450, toCall: 300, history: [{ street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 300 } }] };
    const legal3 = { ...open, callAmount: 300, minRaiseTo: 500 };
    expect(answersToAction(answers({ bet_or_raise: 1 }, 2), legal3, faced, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 900 });
    expect(answersToAction(answers({ bet_or_raise: 1 }, 0), legal3, faced, 0, new Rng(1)).action).toEqual({ type: 'raise', amount: 600 });
  });
});
