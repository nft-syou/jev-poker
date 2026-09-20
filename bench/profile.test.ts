import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/engine/cards.js';
import { createMockBackend } from '../src/jev/backend.js';
import { compressState } from '../src/jev/compress.js';
import { getPersona } from '../src/jev/personas.js';
import { ProfileTracker } from './profile.js';
import { runMatch } from './runner.js';
import type { HandAction } from './types.js';

const hand = (seat1: HandAction[]): HandAction[] => [{ street: 'preflop', seat: 0, type: 'fold' }, ...seat1];

describe('ProfileTracker', () => {
  it('stays silent until enough hands have been seen, then reports rounded percentages', () => {
    const t = new ProfileTracker();
    const seats = new Map([[1, 'rules']]);
    for (let i = 0; i < 19; i++) t.record(hand([{ street: 'preflop', seat: 1, type: 'fold' }]), seats);
    expect(t.statsFor('rules')).toBeNull();
    t.record(
      hand([
        { street: 'preflop', seat: 1, type: 'raise', amountBB: 3 },
        { street: 'flop', seat: 1, type: 'bet', amountBB: 4 },
        { street: 'turn', seat: 1, type: 'check' },
      ]),
      seats,
    );
    expect(t.statsFor('rules')).toEqual({ hands: 20, vpipPct: 5, pfrPct: 5, postflopAggressionPct: 50 });
    expect(t.statsFor('random')).toBeNull();
  });
  it('ignores seats it was not asked about', () => {
    const t = new ProfileTracker();
    for (let i = 0; i < 25; i++) t.record([{ street: 'preflop', seat: 0, type: 'raise', amountBB: 3 }], new Map([[1, 'caller']]));
    expect(t.statsFor('caller')).toEqual({ hands: 25, vpipPct: 0, pfrPct: 0, postflopAggressionPct: 0 });
  });
});

describe('opponent statistics in the state', () => {
  const view = {
    seat: 0, street: 'preflop' as const, holeCards: parseCards('Ah Kh'), board: [],
    stacks: [0, 1, 2].map((seat) => ({ seat, stack: 10000, isAllIn: false, folded: seat === 2 })),
    pot: 150, toCall: 100, currentBet: 100, committedThisStreet: 0, bigBlind: 100, position: 'BTN' as const, history: [],
  };
  const legal = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 200, maxRaiseTo: 10000 };
  it('lists known live opponents and adds the guidance only then', () => {
    const stats = { hands: 40, vpipPct: 12, pfrPct: 8, postflopAggressionPct: 30 };
    const s = compressState(view, legal, getPersona('tag'), 'unified', { opponentStatsFor: (seat) => (seat === 1 ? stats : null) });
    expect(s.table.opponentStats).toEqual([{ seat: 1, ...stats }]); // seat 2 folded, seat 0 is the actor
    expect(s.importantContext.some((l) => l.startsWith('opponentStats describes'))).toBe(true);
    const none = compressState(view, legal, getPersona('tag'), 'unified', { opponentStatsFor: () => null });
    expect('opponentStats' in none.table).toBe(false);
    expect(none.importantContext.some((l) => l.startsWith('opponentStats describes'))).toBe(false);
    expect(compressState(view, legal, getPersona('tag'))).toEqual(none);
  });
});

describe('runMatch with --profile', () => {
  it('feeds statistics to later hands without changing the deals', async () => {
    const base = { opponent: 'rules' as const, format: 'hu' as const, seeds: 30, baseSeed: 5, concurrency: 1, persona: getPersona('tag'), backend: createMockBackend() };
    const plain = await runMatch(base);
    const profiled = await runMatch({ ...base, profile: true });
    expect(profiled.hands).toHaveLength(plain.hands.length);
    expect(profiled.hands.map((h) => [h.seedIndex, h.rotation])).toEqual(plain.hands.map((h) => [h.seedIndex, h.rotation]));
  });
});
