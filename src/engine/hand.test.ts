import { describe, expect, it } from 'vitest';
import { Hand } from './hand.js';
import { Rng } from './rng.js';
import type { Action, TableEvent } from './types.js';

function mk(stacks: number[], seed = 1, button = 0) {
  const events: TableEvent[] = [];
  const hand = new Hand({ seats: stacks.map((stack, seat) => ({ seat, stack })), button, blinds: { small: 50, big: 100, ante: 0 }, rng: new Rng(seed), handNumber: 0 }, (e) => events.push(e));
  return { hand, events };
}

describe('Hand heads-up', () => {
  it('button posts SB and acts first preflop', () => {
    const { hand } = mk([10000, 10000]);
    expect(hand.toAct).toBe(0);
    const la = hand.legalActions(0);
    expect(la).toEqual({ canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 10000 });
  });
  it('fold ends hand and awards pot', () => {
    const { hand, events } = mk([10000, 10000]);
    hand.act(0, { type: 'fold' });
    expect(hand.isOver).toBe(true);
    expect(hand.finalStacks()).toEqual([{ seat: 0, stack: 9950 }, { seat: 1, stack: 10050 }]);
    expect(events.some((e) => e.type === 'HandEnded')).toBe(true);
    expect(hand.wentToShowdown).toBe(false);
  });
  it('call then check goes to flop, BB acts first postflop', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' });
    expect(hand.toAct).toBe(1);
    hand.act(1, { type: 'check' });
    expect(hand.street).toBe('flop');
    expect(hand.board).toHaveLength(3);
    expect(hand.toAct).toBe(1);
  });
  it('check-check through river reaches showdown and is zero-sum', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'check' });
    for (const s of ['flop', 'turn', 'river'] as const) {
      expect(hand.street).toBe(s);
      hand.act(1, { type: 'check' }); hand.act(0, { type: 'check' });
    }
    expect(hand.isOver).toBe(true);
    expect(hand.wentToShowdown).toBe(true);
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(20000);
  });
  it('raise / re-raise sets minRaise by last raise size', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'raise', amount: 300 });         // raise to 300 (raise size 200)
    expect(hand.legalActions(1).minRaiseTo).toBe(500);
    hand.act(1, { type: 'raise', amount: 900 });         // raise size 600
    expect(hand.legalActions(0).minRaiseTo).toBe(1500);
  });
  it('rejects illegal actions', () => {
    const { hand } = mk([10000, 10000]);
    expect(() => hand.act(1, { type: 'call' })).toThrow();          // not your turn
    expect(() => hand.act(0, { type: 'check' })).toThrow();         // facing SB->BB
    expect(() => hand.act(0, { type: 'raise', amount: 150 })).toThrow(); // below min
  });
  it('all-in call runs out the board', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'allin' });
    hand.act(1, { type: 'call' });
    expect(hand.isOver).toBe(true);
    expect(hand.board).toHaveLength(5);
  });
  it('is seed-reproducible', () => {
    const a = mk([10000, 10000], 9), b = mk([10000, 10000], 9);
    expect(a.hand.holeCards(0)).toEqual(b.hand.holeCards(0));
  });
});

describe('Hand 3+ players', () => {
  it('UTG acts first preflop; SB first postflop', () => {
    const { hand } = mk([10000, 10000, 10000]);
    expect(hand.toAct).toBe(0);                   // button=0, SB=1, BB=2, UTG=button in 3-handed
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'call' }); hand.act(2, { type: 'check' });
    expect(hand.street).toBe('flop');
    expect(hand.toAct).toBe(1);
  });
  it('side pots: short stack all-in, others continue', () => {
    const { hand } = mk([300, 10000, 10000]);
    hand.act(0, { type: 'allin' });                       // 300
    hand.act(1, { type: 'raise', amount: 1000 });
    hand.act(2, { type: 'call' });
    // seat 0 is all-in; seats 1 and 2 keep playing
    expect(hand.street).toBe('flop');
    expect(hand.toAct).toBe(1);
    while (!hand.isOver) hand.act(hand.toAct!, { type: 'check' });
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(20300);
  });
  it('short all-in raise does not reopen betting', () => {
    const { hand } = mk([10000, 10000, 350]);             // seat 2 = BB with 350
    hand.act(0, { type: 'raise', amount: 300 });
    hand.act(1, { type: 'call' });
    hand.act(2, { type: 'allin' });                       // to 350: not a full raise
    expect(hand.legalActions(0)).toMatchObject({ canFold: true, callAmount: 50, minRaiseTo: null });
  });
});

describe('Hand betting details', () => {
  it('gives the big blind the option when everyone limps', () => {
    const { hand } = mk([10000, 10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'call' });
    expect(hand.toAct).toBe(2);
    expect(hand.legalActions(2)).toEqual({ canFold: false, canCheck: true, callAmount: null, minRaiseTo: 200, maxRaiseTo: 10000 });
    hand.act(2, { type: 'raise', amount: 400 });
    expect(hand.street).toBe('preflop');
    expect(hand.toAct).toBe(0);
  });
  it('postflop bet uses the big blind as the minimum', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'check' });
    expect(hand.legalActions(1)).toEqual({ canFold: false, canCheck: true, callAmount: null, minRaiseTo: 100, maxRaiseTo: 9900 });
    expect(() => hand.act(1, { type: 'bet', amount: 50 })).toThrow();    // under the minimum
    expect(() => hand.act(1, { type: 'bet', amount: 9901 })).toThrow();  // over the stack
    hand.act(1, { type: 'bet', amount: 100 });
    expect(hand.legalActions(0)).toEqual({ canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 200, maxRaiseTo: 9900 });
  });
  it('accepts bet and raise interchangeably and records the canonical verb', () => {
    const { hand, events } = mk([10000, 10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'call' });
    hand.act(2, { type: 'bet', amount: 400 });   // BB option: a bet stands, so this is a raise
    expect(hand.view(0).history.at(-1)).toEqual({ street: 'preflop', seat: 2, action: { type: 'raise', amount: 400 } });
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'call' });
    expect(hand.street).toBe('flop');
    hand.act(1, { type: 'raise', amount: 200 }); // nothing to raise over, so this is a bet
    expect(hand.view(0).history.at(-1)).toEqual({ street: 'flop', seat: 1, action: { type: 'bet', amount: 200 } });
    const taken = events.filter((e) => e.type === 'ActionTaken') as { action: Action }[];
    expect(taken.at(-1)!.action).toEqual({ type: 'bet', amount: 200 });
  });
  it('rejects an all-in that a short all-in did not reopen', () => {
    const { hand } = mk([10000, 10000, 350]);
    hand.act(0, { type: 'raise', amount: 300 });
    hand.act(1, { type: 'call' });
    hand.act(2, { type: 'allin' });                      // to 350: not a full raise
    expect(hand.legalActions(0).minRaiseTo).toBe(null);
    expect(() => hand.act(0, { type: 'allin' })).toThrow();
    expect(() => hand.act(0, { type: 'raise', amount: 700 })).toThrow();
    hand.act(0, { type: 'call' });                       // calling is still fine
    expect(hand.toAct).toBe(1);
  });
  it('rejects folding when checking is free', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' });
    expect(() => hand.act(1, { type: 'fold' })).toThrow();
  });
  it('treats an all-in below the call as a call for less', () => {
    const { hand } = mk([10000, 10000, 220]);   // seat 2 = BB with 220
    hand.act(0, { type: 'raise', amount: 600 });
    hand.act(1, { type: 'fold' });
    expect(hand.legalActions(2).callAmount).toBe(120);   // capped by stack
    hand.act(2, { type: 'allin' });                      // 220 total, under the 600 bet
    expect(hand.isOver).toBe(true);
    expect(hand.board).toHaveLength(5);
    // uncalled part of seat 0's raise comes back
    const stacks = hand.finalStacks();
    expect(stacks.reduce((a, s) => a + s.stack, 0)).toBe(20220);
    expect(stacks[0]!.stack + stacks[2]!.stack).toBe(10270); // seat 1 lost its 50 blind
  });
  it('lets a player who has not acted re-raise over a short all-in', () => {
    const { hand } = mk([350, 10000, 10000, 10000], 3, 0); // SB=1, BB=2, UTG=3, BTN=0 (350)
    hand.act(3, { type: 'raise', amount: 300 });
    hand.act(0, { type: 'allin' });                       // to 350: not a full raise
    expect(hand.toAct).toBe(1);
    expect(hand.legalActions(1).minRaiseTo).toBe(550);    // seat 1 has not acted: full reopen
    expect(hand.legalActions(3).minRaiseTo).toBe(null);   // seat 3 already acted
  });
  it('closes raising when no opponent can act', () => {
    const { hand } = mk([10000, 60]);   // the big blind is all-in for less than the blind
    expect(hand.toAct).toBe(0);
    expect(hand.legalActions(0)).toEqual({ canFold: true, canCheck: false, callAmount: 10, minRaiseTo: null, maxRaiseTo: null });
    expect(() => hand.act(0, { type: 'raise', amount: 200 })).toThrow();
    expect(() => hand.act(0, { type: 'allin' })).toThrow();
    hand.act(0, { type: 'call' });
    expect(hand.isOver).toBe(true);
    expect(hand.board).toHaveLength(5);
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(10060);
    expect(hand.finalStacks()[0]!.stack).toBeGreaterThanOrEqual(9940);
  });
});

describe('Hand pots and showdown', () => {
  it('conserves chips when everyone is all-in preflop', () => {
    const { hand, events } = mk([300, 1200, 5000]);
    hand.act(0, { type: 'allin' });
    hand.act(1, { type: 'allin' });
    // both opponents are already all-in: seat 2 can only settle the call
    expect(() => hand.act(2, { type: 'allin' })).toThrow();
    expect(hand.legalActions(2)).toEqual({ canFold: true, canCheck: false, callAmount: 1100, minRaiseTo: null, maxRaiseTo: null });
    hand.act(2, { type: 'call' });
    expect(hand.isOver).toBe(true);
    expect(hand.wentToShowdown).toBe(true);
    expect(hand.board).toHaveLength(5);
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(6500);
    const awarded = events.filter((e) => e.type === 'PotAwarded');
    expect(awarded.length).toBeGreaterThanOrEqual(2);   // main pot + side pot(s)
    expect(events.some((e) => e.type === 'Showdown')).toBe(true);
  });
  it('awards the whole pot without a showdown when everyone folds', () => {
    const { hand, events } = mk([10000, 10000, 10000]);
    hand.act(0, { type: 'fold' });
    hand.act(1, { type: 'fold' });
    expect(hand.isOver).toBe(true);
    expect(hand.wentToShowdown).toBe(false);
    expect(hand.street).toBe('showdown');
    expect(events.filter((e) => e.type === 'Showdown')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'PotAwarded')).toEqual([{ type: 'PotAwarded', seat: 2, amount: 150, potIndex: 0 }]);
    expect(hand.finalStacks()).toEqual([{ seat: 0, stack: 10000 }, { seat: 1, stack: 9950 }, { seat: 2, stack: 10050 }]);
  });
  it('posts antes capped by stack before the blinds', () => {
    const events: TableEvent[] = [];
    const hand = new Hand({ seats: [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 15 }], button: 0, blinds: { small: 50, big: 100, ante: 25 }, rng: new Rng(4), handNumber: 0 }, (e) => events.push(e));
    const posted = events.find((e) => e.type === 'BlindsPosted');
    expect(posted).toBeDefined();
    // seat 2 is all-in from the ante alone and posts no big blind
    expect(hand.view(0).pot).toBe(25 + 25 + 15 + 50);
    expect(hand.toAct).toBe(0);
    expect(hand.legalActions(2)).toEqual({ canFold: false, canCheck: false, callAmount: null, minRaiseTo: null, maxRaiseTo: null });
    while (!hand.isOver) {
      const s = hand.toAct!;
      const la = hand.legalActions(s);
      hand.act(s, la.canCheck ? { type: 'check' } : { type: 'call' });
    }
    expect(hand.finalStacks().reduce((a, s) => a + s.stack, 0)).toBe(2015);
  });
  it('runs the board out when only one player can still act', () => {
    const { hand, events } = mk([300, 10000, 10000]);
    hand.act(0, { type: 'allin' });
    hand.act(1, { type: 'allin' });
    hand.act(2, { type: 'fold' });
    expect(hand.isOver).toBe(true);
    expect(hand.board).toHaveLength(5);
    expect(events.filter((e) => e.type === 'StreetDealt').map((e) => (e as { street: string }).street)).toEqual(['flop', 'turn', 'river']);
  });
});

describe('Hand view', () => {
  it('shows only the requesting seat its hole cards', () => {
    const { hand } = mk([10000, 10000, 10000]);
    const v = hand.view(1);
    expect(v.holeCards).toEqual(hand.holeCards(1));
    expect(v.holeCards).toHaveLength(2);
    expect(v.seat).toBe(1);
    expect(v.street).toBe('preflop');
    expect(v.pot).toBe(150);
    expect(v.toCall).toBe(50);
    expect(v.bigBlind).toBe(100);
    expect(v.board).toEqual([]);
    expect(v.stacks).toEqual([
      { seat: 0, stack: 10000, isAllIn: false, folded: false },
      { seat: 1, stack: 9950, isAllIn: false, folded: false },
      { seat: 2, stack: 9900, isAllIn: false, folded: false },
    ]);
    expect(v.history).toEqual([]);
  });
  it('records history per street', () => {
    const { hand } = mk([10000, 10000]);
    hand.act(0, { type: 'call' }); hand.act(1, { type: 'check' });
    hand.act(1, { type: 'bet', amount: 200 });
    const v = hand.view(0);
    expect(v.history).toEqual([
      { street: 'preflop', seat: 0, action: { type: 'call' } },
      { street: 'preflop', seat: 1, action: { type: 'check' } },
      { street: 'flop', seat: 1, action: { type: 'bet', amount: 200 } },
    ]);
    expect(v.toCall).toBe(200);
  });
});

describe('Hand invariants (randomised play)', () => {
  it('always terminates and conserves chips', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = new Rng(seed * 7919);
      const n = 2 + rng.int(5);
      const stacks = Array.from({ length: n }, () => 1 + rng.int(4000));
      const total = stacks.reduce((a, s) => a + s, 0);
      const button = rng.int(n);
      const events: TableEvent[] = [];
      const hand = new Hand({
        seats: stacks.map((stack, seat) => ({ seat, stack })),
        button,
        blinds: { small: 25, big: 50, ante: rng.int(2) === 0 ? 0 : 5 },
        rng: new Rng(seed),
        handNumber: seed,
      }, (e) => events.push(e));

      let guard = 0;
      while (!hand.isOver) {
        expect(++guard).toBeLessThan(400);
        const seat = hand.toAct;
        expect(seat).not.toBeNull();
        const la = hand.legalActions(seat!);
        const view = hand.view(seat!);
        const stack = view.stacks[seat!]!.stack;
        expect(stack).toBeGreaterThan(0);
        const choices: (() => void)[] = [];
        if (la.canFold) choices.push(() => hand.act(seat!, { type: 'fold' }));
        if (la.canCheck) choices.push(() => hand.act(seat!, { type: 'check' }));
        if (la.callAmount !== null) choices.push(() => hand.act(seat!, { type: 'call' }));
        if (la.minRaiseTo !== null && la.maxRaiseTo !== null) {
          const span = la.maxRaiseTo - la.minRaiseTo;
          const amount = la.minRaiseTo + (span > 0 ? rng.int(span + 1) : 0);
          // `bet` only opens a street; preflop the blinds always leave a bet standing.
          const type = view.toCall > 0 || view.street === 'preflop' ? 'raise' : 'bet';
          choices.push(() => hand.act(seat!, { type, amount }));
        }
        // all-in is legal as a raise, or as an all-in for less than (or exactly) a call
        if (la.minRaiseTo !== null || view.toCall === stack) choices.push(() => hand.act(seat!, { type: 'allin' }));
        expect(choices.length).toBeGreaterThan(0);
        rng.pick(choices)();
      }

      const final = hand.finalStacks();
      expect(final.reduce((a, s) => a + s.stack, 0)).toBe(total);
      expect(final.every((s) => s.stack >= 0)).toBe(true);
      expect(hand.toAct).toBeNull();
      expect(hand.street).toBe('showdown');
      if (hand.wentToShowdown) expect(hand.board).toHaveLength(5);
      const ended = events.filter((e) => e.type === 'HandEnded');
      expect(ended).toHaveLength(1);
      const awarded = events.filter((e) => e.type === 'PotAwarded') as { amount: number }[];
      expect(awarded.reduce((a, e) => a + e.amount, 0)).toBe(hand.view(0).pot);
    }
  });
});
