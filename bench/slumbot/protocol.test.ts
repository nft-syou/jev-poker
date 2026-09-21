import { describe, expect, it } from 'vitest';
import { encodeAction, heroView, replay } from './protocol.js';

describe('replay', () => {
  it('starts with the blinds posted and the small blind to act', () => {
    expect(replay('')).toMatchObject({ street: 0, toAct: 1, total: [100, 50], currentBet: 100, lastBetSize: 50 });
  });
  it('tracks a raise and a call into the flop, big blind first', () => {
    const s = replay('b200c');
    expect(s).toMatchObject({ street: 1, toAct: 0, total: [200, 200], onStreet: [0, 0], currentBet: 0 });
  });
  it("follows the documentation's example: a pot-sized flop bet to 400", () => {
    const s = replay('b200c/kb400');
    expect(s).toMatchObject({ street: 1, toAct: 0, total: [200, 600], currentBet: 400, lastBetSize: 400 });
  });
  it('gives the big blind the option after a limp, then moves to the flop on a check', () => {
    expect(replay('c')).toMatchObject({ street: 0, toAct: 0, total: [100, 100], lastBetSize: 0 });
    expect(replay('ck')).toMatchObject({ street: 1, toAct: 0 });
    expect(replay('ck/')).toMatchObject({ street: 1, toAct: 0 });
  });
  it('ends on a fold, on a river showdown and on a called all-in', () => {
    expect(replay('b200f')).toMatchObject({ toAct: null, folded: 0 });
    expect(replay('b200c/kk/kk/kk')).toMatchObject({ toAct: null, folded: null, street: 3 });
    expect(replay('b20000c///')).toMatchObject({ toAct: null, total: [20000, 20000], street: 3 });
  });
  it('rejects nonsense', () => {
    expect(() => replay('k')).toThrow(); // the small blind cannot check preflop
    expect(() => replay('b200c/c')).toThrow(); // nothing to call
    expect(() => replay('x')).toThrow();
  });
});

describe('heroView', () => {
  it('describes the big blind facing a 2 bb open', () => {
    const { view, legal } = heroView('b200', 0, ['Jd', '9h'], []);
    expect(view).toMatchObject({ seat: 0, street: 'preflop', position: 'BB', pot: 300, toCall: 100, currentBet: 200, committedThisStreet: 100, bigBlind: 100 });
    expect(view.stacks).toEqual([
      { seat: 0, stack: 19900, isAllIn: false, folded: false },
      { seat: 1, stack: 19800, isAllIn: false, folded: false },
    ]);
    expect(view.history).toEqual([{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 200 } }]);
    expect(legal).toEqual({ canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 300, maxRaiseTo: 20000 });
  });
  it('describes the button first to act', () => {
    const { view, legal } = heroView('', 1, ['As', 'Kd'], []);
    expect(view).toMatchObject({ position: 'BTN', pot: 150, toCall: 50, currentBet: 100, committedThisStreet: 50 });
    expect(legal).toEqual({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 20000 });
  });
  it('labels a first postflop bet as a bet and a raise over it as a raise', () => {
    const { view, legal } = heroView('b200c/kb400', 0, ['As', 'Kd'], ['2c', '7d', 'Th']);
    expect(view.street).toBe('flop');
    expect(view.history.map((h) => [h.seat, h.action.type])).toEqual([[1, 'raise'], [0, 'call'], [0, 'check'], [1, 'bet']]);
    expect(legal).toEqual({ canFold: true, canCheck: false, callAmount: 400, minRaiseTo: 800, maxRaiseTo: 19800 });
  });
  it('offers no raise when the opponent is all-in', () => {
    const { legal } = heroView('b20000', 0, ['As', 'Kd'], []);
    expect(legal).toEqual({ canFold: true, canCheck: false, callAmount: 19900, minRaiseTo: null, maxRaiseTo: null });
  });
  it("refuses to build a view when it is not the client's turn", () => {
    expect(() => heroView('', 0, ['As', 'Kd'], [])).toThrow();
  });
});

describe('encodeAction', () => {
  const facing = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 300, maxRaiseTo: 20000 };
  const free = { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 100, maxRaiseTo: 19800 };
  it('maps engine actions to incr strings', () => {
    expect(encodeAction({ type: 'fold' }, facing)).toBe('f');
    expect(encodeAction({ type: 'call' }, facing)).toBe('c');
    expect(encodeAction({ type: 'check' }, free)).toBe('k');
    expect(encodeAction({ type: 'raise', amount: 600 }, facing)).toBe('b600');
    expect(encodeAction({ type: 'bet', amount: 250.4 }, free)).toBe('b250');
    expect(encodeAction({ type: 'allin' }, facing)).toBe('b20000');
  });
  it('clamps and degrades instead of sending an illegal action', () => {
    expect(encodeAction({ type: 'raise', amount: 150 }, facing)).toBe('b300');
    expect(encodeAction({ type: 'fold' }, free)).toBe('k');
    expect(encodeAction({ type: 'raise', amount: 900 }, { ...facing, minRaiseTo: null, maxRaiseTo: null })).toBe('c');
  });
});
