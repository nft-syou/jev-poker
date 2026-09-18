import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import { compressState } from './compress.js';
import { getPersona } from './personas.js';
const view = { seat: 0, street: 'flop' as const, holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c'), stacks: [{ seat: 0, stack: 9000, isAllIn: false, folded: false }, { seat: 1, stack: 5000, isAllIn: false, folded: false }, { seat: 2, stack: 0, isAllIn: true, folded: false }], pot: 1200, toCall: 400, bigBlind: 100, position: 'BTN' as const, history: [{ street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 300 } }] };
const legal = { canFold: true, canCheck: false, callAmount: 400, minRaiseTo: 800, maxRaiseTo: 9000 };
describe('compressState', () => {
  it('matches snapshot shape', () => {
    const s = compressState(view, legal, getPersona('tag'));
    expect(s.persona.name).toBe('TAG');
    expect(s.hand).toMatchObject({ street: 'flop', holeCards: 'Ah Kh', board: 'Qh Jh 2c', madeHand: 'high_card', draws: ['flush_draw', 'gutshot'], preflopStrength: 'premium' });
    expect(s.table).toMatchObject({ position: 'BTN', playersInHand: 3, playersToAct: 1, potBB: 12, toCallBB: 4, potOddsPct: 25, effectiveStackBB: 50 });
    expect(s.history).toEqual([{ street: 'preflop', seat: 1, action: 'raise', amountBB: 3 }]);
    expect(s).toMatchSnapshot();
  });
  it('never includes other hole cards', () => {
    // Structural check: every card-looking token in the serialised state must be
    // one of the acting seat's hole cards or a board card. Seats 1 and 2 hold
    // cards too, and nothing about them may leak in.
    const json = JSON.stringify(compressState(view, legal, getPersona('tag')));
    const tokens = json.match(/\b[2-9TJQKA][cdhs]\b/g) ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    expect([...new Set(tokens)].sort()).toEqual(['2c', 'Ah', 'Jh', 'Kh', 'Qh']);
  });
});

describe('compressState omissions', () => {
  const base = { ...view, history: [] };
  it('omits madeHand and draws preflop', () => {
    const s = compressState({ ...base, street: 'preflop', board: [] }, legal, getPersona('rock'));
    expect('madeHand' in s.hand).toBe(false);
    expect('draws' in s.hand).toBe(false);
    expect(s.hand.board).toBe('');
  });
  it('omits draws but keeps madeHand on the river', () => {
    const s = compressState({ ...base, street: 'river', board: parseCards('Qh Jh 2c 7d 3s') }, legal, getPersona('rock'));
    expect(s.hand.madeHand).toBe('high_card');
    expect('draws' in s.hand).toBe(false);
  });
  it('reports zero pot odds when nothing is due and rounds bb to one decimal', () => {
    const s = compressState({ ...base, toCall: 0, pot: 1250 }, { ...legal, canCheck: true, canFold: false, callAmount: null }, getPersona('rock'));
    expect(s.table.potOddsPct).toBe(0);
    expect(s.table.toCallBB).toBe(0);
    expect(s.table.potBB).toBe(12.5);
    expect(s.table.stacksBB).toEqual([
      { seat: 0, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, stackBB: 50, isAllIn: false, folded: false },
      { seat: 2, stackBB: 0, isAllIn: true, folded: false },
    ]);
  });
  it('marks a folded seat', () => {
    const stacks = [
      { seat: 0, stack: 9000, isAllIn: false, folded: false },
      { seat: 1, stack: 5000, isAllIn: false, folded: true },
    ];
    const s = compressState({ ...base, stacks }, legal, getPersona('rock'));
    expect(s.table.playersInHand).toBe(1);
    expect(s.table.stacksBB).toEqual([
      { seat: 0, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, stackBB: 50, isAllIn: false, folded: true },
    ]);
  });
  it('tolerates an empty stack list', () => {
    const s = compressState({ ...base, stacks: [] }, legal, getPersona('rock'));
    expect(s.table).toMatchObject({ playersInHand: 0, playersToAct: 0, effectiveStackBB: 0 });
  });
});
