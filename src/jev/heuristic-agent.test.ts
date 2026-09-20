import { describe, expect, it } from 'vitest';
import { isLegal, randomView } from '../agents/testutil.js';
import { parseCards } from '../engine/cards.js';
import { Rng } from '../engine/rng.js';
import type { LegalActions, PlayerView } from '../engine/types.js';
import { HeuristicAgent } from './heuristic-agent.js';

const agent = new HeuristicAgent();
const seats = (n: number) => Array.from({ length: n }, (_, seat) => ({ seat, stack: 10000, isAllIn: false, folded: false }));
const base = (o: Partial<PlayerView>): PlayerView => ({
  seat: 0,
  street: 'preflop',
  holeCards: parseCards('Ah Ad'),
  board: [],
  stacks: seats(6),
  pot: 150,
  toCall: 100,
  currentBet: 100,
  committedThisStreet: 0,
  bigBlind: 100,
  position: 'UTG',
  history: [],
  ...o,
});
const open: LegalActions = { canFold: true, canCheck: false, callAmount: 100, minRaiseTo: 200, maxRaiseTo: 10000 };

describe('HeuristicAgent', () => {
  it('always returns a legal action and is deterministic', async () => {
    const rng = new Rng(21);
    for (let i = 0; i < 300; i++) {
      const { view, legal } = randomView(rng);
      const a = await agent.decide(view, legal);
      expect(isLegal(a, legal), JSON.stringify({ a, legal })).toBe(true);
      expect(await agent.decide(view, legal)).toEqual(a);
    }
  }, 60_000);

  it('opens by position in an unopened pot', async () => {
    expect(await agent.decide(base({}), open)).toEqual({ type: 'raise', amount: 250 });
    expect(await agent.decide(base({ holeCards: parseCards('9h 8h') }), open)).toEqual({ type: 'fold' }); // weak from UTG
    expect(await agent.decide(base({ holeCards: parseCards('9h 8h'), position: 'BTN' }), open)).toEqual({ type: 'raise', amount: 250 });
    expect(await agent.decide(base({ holeCards: parseCards('7h 2d'), position: 'BTN' }), open)).toEqual({ type: 'fold' });
  });

  it('continues against a re-raise only with premium hands', async () => {
    const history = [
      { street: 'preflop' as const, seat: 0, action: { type: 'raise' as const, amount: 250 } },
      { street: 'preflop' as const, seat: 1, action: { type: 'raise' as const, amount: 750 } },
    ];
    const v = (hole: string) => base({ holeCards: parseCards(hole), history, toCall: 500, currentBet: 750, committedThisStreet: 250, pot: 1150 });
    const l = { ...open, callAmount: 500, minRaiseTo: 1250 };
    expect(await agent.decide(v('Ah Ad'), l)).toEqual({ type: 'call' });
    expect(await agent.decide(v('Th Td'), l)).toEqual({ type: 'fold' });
  });

  it('bets strong hands and folds air postflop', async () => {
    const flop = (hole: string) => base({ street: 'flop', holeCards: parseCards(hole), board: parseCards('Kc 7s 2d'), pot: 600, toCall: 0, currentBet: 0 });
    const free: LegalActions = { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 100, maxRaiseTo: 10000 };
    expect(await agent.decide(flop('Kh Kd'), free)).toEqual({ type: 'bet', amount: 600 }); // top set: pot
    const facing = base({ street: 'flop', holeCards: parseCards('5h 4d'), board: parseCards('Kc 7s 2d'), pot: 900, toCall: 300, currentBet: 300 });
    expect(await agent.decide(facing, { ...open, callAmount: 300, minRaiseTo: 600 })).toEqual({ type: 'fold' });
  });
});
