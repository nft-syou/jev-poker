import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards.js';
import type { LegalActions, PlayerView } from '../engine/types.js';
import { RulesAgent } from './rules.js';

const base = (o: Partial<PlayerView>): PlayerView => ({ seat: 0, street: 'preflop', holeCards: parseCards('Ah Ad'), board: [], stacks: [{ seat: 0, stack: 10000, isAllIn: false, folded: false }, { seat: 1, stack: 10000, isAllIn: false, folded: false }], pot: 150, toCall: 50, bigBlind: 100, position: 'BTN', history: [], ...o, currentBet: o.currentBet ?? (o.toCall ?? 50) + (o.committedThisStreet ?? 0), committedThisStreet: o.committedThisStreet ?? 0 });
const open: LegalActions = { canFold: true, canCheck: false, callAmount: 50, minRaiseTo: 200, maxRaiseTo: 10000 };
const agent = new RulesAgent(0);

describe('RulesAgent preflop', () => {
  it('opens premium to 3bb', async () => expect(await agent.decide(base({}), open)).toEqual({ type: 'raise', amount: 300 }));
  it('3-bets premium to 3x', async () => {
    const v = base({ history: [{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 300 } }], toCall: 250, pot: 450 });
    expect(await agent.decide(v, { ...open, callAmount: 250, minRaiseTo: 500 })).toEqual({ type: 'raise', amount: 900 });
  });
  it('medium calls an unraised pot and folds to a raise', async () => {
    expect(await agent.decide(base({ holeCards: parseCards('8h 8d') }), open)).toEqual({ type: 'call' });
    const v = base({ holeCards: parseCards('8h 8d'), history: [{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 300 } }] });
    expect(await agent.decide(v, open)).toEqual({ type: 'fold' });
  });
  it('trash checks when free, folds otherwise', async () => {
    expect(await agent.decide(base({ holeCards: parseCards('7h 2d') }), open)).toEqual({ type: 'fold' });
    expect(await agent.decide(base({ holeCards: parseCards('7h 2d'), toCall: 0 }), { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 200, maxRaiseTo: 10000 })).toEqual({ type: 'check' });
  });
});
describe('RulesAgent postflop', () => {
  const flop = (hole: string, board: string, toCall: number, pot = 300) => base({ street: 'flop', holeCards: parseCards(hole), board: parseCards(board), toCall, pot });
  const free: LegalActions = { canFold: false, canCheck: true, callAmount: null, minRaiseTo: 100, maxRaiseTo: 10000 };
  it('bets two pair+ for 2/3 pot', async () => expect(await agent.decide(flop('Ah Kd', 'As Kc 2d', 0), free)).toEqual({ type: 'bet', amount: 200 }));
  it('calls with a pair when cheap, folds when expensive', async () => {
    expect(await agent.decide(flop('Ah 5d', 'As Kc 2d', 100), { ...open, callAmount: 100, minRaiseTo: 200 })).toEqual({ type: 'call' });
    expect(await agent.decide(flop('Ah 5d', 'As Kc 2d', 300), { ...open, callAmount: 300, minRaiseTo: 600 })).toEqual({ type: 'fold' });
  });
  it('calls a draw only when very cheap', async () => {
    expect(await agent.decide(flop('9h 8h', 'Th 7c 2h', 50), { ...open, callAmount: 50, minRaiseTo: 100 })).toEqual({ type: 'call' });
    expect(await agent.decide(flop('9h 8h', 'Th 7c 2h', 200), { ...open, callAmount: 200, minRaiseTo: 400 })).toEqual({ type: 'fold' });
  });
  it('goes all-in when the clamp hits the max', async () => {
    expect(await agent.decide(flop('Ah Kd', 'As Kc 2d', 0, 30000), { ...free, maxRaiseTo: 10000 })).toEqual({ type: 'allin' });
  });
});
