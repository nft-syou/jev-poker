import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import type { PlayerView } from '../engine/types.js';
import { compressState, TASK } from './compress.js';
import { getPersona } from './personas.js';
const view = { seat: 0, street: 'flop' as const, holeCards: parseCards('Ah Kh'), board: parseCards('Qh Jh 2c'), stacks: [{ seat: 0, stack: 9000, isAllIn: false, folded: false }, { seat: 1, stack: 5000, isAllIn: false, folded: false }, { seat: 2, stack: 0, isAllIn: true, folded: false }], pot: 1200, toCall: 400, currentBet: 400, committedThisStreet: 0, bigBlind: 100, position: 'BTN' as const, history: [{ street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 300 } }] };
const legal = { canFold: true, canCheck: false, callAmount: 400, minRaiseTo: 800, maxRaiseTo: 9000 };
describe('compressState', () => {
  it('matches snapshot shape', () => {
    const s = compressState(view, legal, getPersona('tag'));
    expect(s.persona.name).toBe('TAG');
    expect(s.hand).toMatchObject({ street: 'flop', holeCards: 'Ah Kh', board: 'Qh Jh 2c', madeHand: 'high_card', draws: ['flush_draw', 'gutshot'], preflopStrength: 'premium' });
    expect(s.table).toMatchObject({ position: 'BTN', playersInHand: 3, opponentsNotAllIn: 1, potBB: 12, toCallBB: 4, potOddsPct: 25, effectiveStackBB: 50 });
    expect(s.history).toEqual([{ street: 'preflop', seat: 1, isMe: false, action: 'raise', amountBB: 3 }]);
    expect('actor' in s).toBe(false); // an explicit actor object measurably hurt play; isMe flags carry identity
    expect(s.table.stacksBB.map((x) => x.isMe)).toEqual([true, false, false]);
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
      { seat: 0, isMe: true, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, isMe: false, stackBB: 50, isAllIn: false, folded: false },
      { seat: 2, isMe: false, stackBB: 0, isAllIn: true, folded: false },
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
      // two seats: no identity flags heads-up
      { seat: 0, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, stackBB: 50, isAllIn: false, folded: true },
    ]);
  });
  it('tolerates an empty stack list', () => {
    const s = compressState({ ...base, stacks: [] }, legal, getPersona('rock'));
    expect(s.table).toMatchObject({ playersInHand: 0, opponentsNotAllIn: 0, effectiveStackBB: 0 });
  });
});

describe('compressState street aggression', () => {
  const mk = (history: PlayerView['history']) => compressState({ ...view, history }, legal, getPersona('tag')).table;
  it('flags a raised bet on the current street only', () => {
    expect(mk([])).toMatchObject({ raisesThisStreet: 0, myBetWasRaisedThisStreet: false });
    const raisedOnFlop = [
      { street: 'flop' as const, seat: 0, action: { type: 'bet' as const, amount: 200 } },
      { street: 'flop' as const, seat: 1, action: { type: 'raise' as const, amount: 600 } },
    ];
    expect(mk(raisedOnFlop)).toMatchObject({ raisesThisStreet: 2, myBetWasRaisedThisStreet: true });
    const raisedPreflopOnly = [
      { street: 'preflop' as const, seat: 0, action: { type: 'raise' as const, amount: 300 } },
      { street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 900 } },
    ];
    expect(mk(raisedPreflopOnly)).toMatchObject({ raisesThisStreet: 0, myBetWasRaisedThisStreet: false });
    const iRaisedLast = [
      { street: 'flop' as const, seat: 1, action: { type: 'bet' as const, amount: 200 } },
      { street: 'flop' as const, seat: 0, action: { type: 'raise' as const, amount: 600 } },
    ];
    expect(mk(iRaisedLast)).toMatchObject({ raisesThisStreet: 2, myBetWasRaisedThisStreet: false });
  });
});

describe('compressState unopened pot', () => {
  const pre = (history: PlayerView['history']) => compressState({ ...view, street: 'preflop', board: [], history }, legal, getPersona('tag')).table;
  it('is true preflop when only folds precede the actor, false once someone enters, absent postflop', () => {
    expect(pre([]).unopenedPot).toBe(true);
    expect(pre([{ street: 'preflop', seat: 1, action: { type: 'fold' } }]).unopenedPot).toBe(true);
    expect(pre([{ street: 'preflop', seat: 1, action: { type: 'call' } }]).unopenedPot).toBe(false);
    expect(pre([{ street: 'preflop', seat: 2, action: { type: 'raise', amount: 300 } }]).unopenedPot).toBe(false);
    expect('unopenedPot' in compressState(view, legal, getPersona('tag')).table).toBe(false);
  });
});

describe('compressState split format', () => {
  it('gives preflop and postflop decisions different task and context, and leaves unified unchanged', () => {
    const unified = compressState(view, legal, getPersona('tag'));
    const post = compressState(view, legal, getPersona('tag'), 'split');
    const pre = compressState({ ...view, street: 'preflop', board: [] }, legal, getPersona('tag'), 'split');
    expect(unified.task).toBe(TASK);
    expect(post.task).not.toBe(pre.task);
    expect(post.importantContext.some((l) => l.includes('beatsPctOfHands'))).toBe(true);
    expect(pre.importantContext.some((l) => l.includes('beatsPctOfHands'))).toBe(false);
    expect(pre.importantContext.some((l) => l.includes('unopenedPot'))).toBe(true);
    expect(post.importantContext.some((l) => l.includes('unopenedPot'))).toBe(false);
    // Hand/table content is the same either way; only the wording differs.
    expect(post.hand).toEqual(unified.hand);
    expect(post.table).toEqual(unified.table);
  });
});

describe('compressState identity flags', () => {
  it('marks the actor only at tables with three or more seats', () => {
    const three = compressState(view, legal, getPersona('tag'));
    expect(three.table.stacksBB.map((x) => x.isMe)).toEqual([true, false, false]);
    expect(three.history.every((h) => h.isMe === false)).toBe(true);
    const headsUp = compressState({ ...view, stacks: view.stacks.slice(0, 2) }, legal, getPersona('tag'));
    expect(headsUp.table.stacksBB.some((x) => 'isMe' in x)).toBe(false);
    expect(headsUp.history.some((h) => 'isMe' in h)).toBe(false);
  });
});
