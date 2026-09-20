import { newDeck } from '../engine/cards.js';
import { Rng } from '../engine/rng.js';
import type { Action, HistoryEntry, LegalActions, PlayerView, Position, SeatState, Street } from '../engine/types.js';

export function isLegal(action: Action, legal: LegalActions): boolean {
  switch (action.type) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.callAmount !== null;
    case 'bet':
    case 'raise':
      return (
        legal.minRaiseTo !== null &&
        legal.maxRaiseTo !== null &&
        legal.minRaiseTo <= action.amount &&
        action.amount <= legal.maxRaiseTo &&
        Number.isInteger(action.amount)
      );
    case 'allin':
      return legal.minRaiseTo !== null || legal.callAmount !== null;
  }
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

export function randomView(rng: Rng): { view: PlayerView; legal: LegalActions } {
  const deck = rng.shuffle(newDeck());
  const holeCards = [deck[0]!, deck[1]!];
  const street = rng.pick(STREETS);
  const boardLen = BOARD_LEN[street];
  const board = deck.slice(2, 2 + boardLen);

  const numSeats = 2 + rng.int(5); // 2..6
  const seat = rng.int(numSeats);
  const stacks: SeatState[] = Array.from({ length: numSeats }, (_, i) => ({
    seat: i,
    stack: 1000 + rng.int(9000),
    isAllIn: false,
    folded: false,
  }));
  const position = rng.pick(POSITIONS);

  const bigBlind = 100;
  const pot = bigBlind + rng.int(2000);
  const toCallZero = rng.next() < 0.5;
  const toCall = toCallZero ? 0 : bigBlind + rng.int(2000);

  // 80%: a raise is allowed. 15%: `minRaiseTo === null` with a non-null
  // `maxRaiseTo` — the engine-real case where the seat has already acted and
  // faces an incomplete raise, so it may call but not raise. 5%: neither.
  const raiseRoll = rng.next();
  const hasMinRaise = raiseRoll >= 0.2;
  const minRaiseTo = hasMinRaise ? (toCall === 0 ? bigBlind : toCall + bigBlind) : null;
  const maxRaiseTo = hasMinRaise || raiseRoll < 0.15 ? 10000 : null;

  const legal: LegalActions = toCall === 0
    ? { canFold: false, canCheck: true, callAmount: null, minRaiseTo, maxRaiseTo }
    : { canFold: true, canCheck: false, callAmount: toCall, minRaiseTo, maxRaiseTo };

  // 20%: somebody has already raised preflop, which is what drives the 3-bet
  // branches of `RulesAgent` (`raisedPreflop` / `lastRaiseTo`).
  const history: HistoryEntry[] = [];
  if (rng.next() < 0.2) {
    const opener = (seat + 1) % numSeats;
    if (rng.next() < 0.5) history.push({ street: 'preflop', seat: opener, action: { type: 'call' } });
    history.push({
      street: 'preflop',
      seat: opener,
      action: { type: 'raise', amount: 2 * bigBlind + rng.int(9) * bigBlind },
    });
  }

  // Chips already in on this street: none, or a previous bet that has now been raised.
  const committedThisStreet = toCall > 0 && rng.next() < 0.3 ? bigBlind * (1 + rng.int(4)) : 0;
  const view: PlayerView = {
    seat,
    street,
    holeCards,
    board,
    stacks,
    pot,
    toCall,
    currentBet: toCall + committedThisStreet,
    committedThisStreet,
    bigBlind,
    position,
    history,
  };

  return { view, legal };
}
