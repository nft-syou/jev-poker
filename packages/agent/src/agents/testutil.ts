import {
  type Action,
  createDeck,
  type HistoryEntry,
  type LegalActions,
  type PlayerView,
  type Position,
  type Rng,
  randomInt,
  type SeatId,
  type SeatState,
  type Street,
  shuffle,
} from "@jev-poker/engine";

/**
 * Whether the engine would accept `action` from a seat with these legal actions. With the `view`
 * it also checks what the legal actions alone cannot tell: a wager is a `bet` only when nobody has
 * bet on the street (`view.currentBet === 0`) and a `raise` otherwise, and an all-in without the
 * right to raise is accepted only as a call for less.
 */
export function isLegal(action: Action, legal: LegalActions, view?: PlayerView): boolean {
  switch (action.type) {
    case "fold":
      return legal.canFold;
    case "check":
      return legal.canCheck;
    case "call":
      return legal.callAmount !== null;
    case "bet":
    case "raise": {
      if (view !== undefined && (action.type === "bet") !== (view.currentBet === 0)) return false;
      return (
        legal.minRaiseTo !== null &&
        legal.maxRaiseTo !== null &&
        legal.minRaiseTo <= action.amount &&
        action.amount <= legal.maxRaiseTo &&
        Number.isInteger(action.amount)
      );
    }
    case "allin": {
      if (legal.minRaiseTo !== null) return true;
      if (legal.callAmount === null) return false;
      if (view === undefined) return true;
      const stack = view.stacks.find((s) => s.seat === view.seat)?.stack ?? 0;
      return view.committedThisStreet + stack <= view.currentBet;
    }
  }
}

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];
const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };
/** Position names clockwise from the small blind, by table size (what `positionOf` produces). */
const POSITIONS: Record<number, readonly Position[]> = {
  2: ["BTN", "BB"],
  3: ["SB", "BB", "BTN"],
  4: ["SB", "BB", "CO", "BTN"],
  5: ["SB", "BB", "UTG", "CO", "BTN"],
  6: ["SB", "BB", "UTG", "MP", "CO", "BTN"],
};

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, items.length)] as T;
}

/**
 * A random but self-consistent decision point, shaped like the ones `playerView` and
 * `Hand.legalActions` produce: `currentBet = toCall + committedThisStreet` unless the stack caps
 * the call, the blinds count as chips committed preflop (so the big blind's option is
 * `canCheck` with `currentBet > 0`), the history explains the bet being faced, and the legal
 * actions follow the engine's rules (no raise for a seat that cannot cover the call, or that
 * already acted before a short all-in; `maxRaiseTo` is the seat's whole stack).
 */
export function randomView(rng: Rng): { view: PlayerView; legal: LegalActions } {
  const deck = shuffle(createDeck(), rng);
  const holeCards = deck.slice(0, 2);
  const street = pick(rng, STREETS);
  const board = deck.slice(2, 2 + BOARD_LEN[street]);

  const numSeats = 2 + randomInt(rng, 5); // 2..6
  const seat: SeatId = randomInt(rng, numSeats);
  const villain: SeatId = (seat + 1 + randomInt(rng, numSeats - 1)) % numSeats;
  const bigBlind = 100;
  const stacks: SeatState[] = Array.from({ length: numSeats }, (_, i) => ({
    seat: i,
    stack: 1000 + randomInt(rng, 9000),
    isAllIn: false,
    // Seats other than the hero and the one opponent the history is about may be out of the hand.
    folded: i !== seat && i !== villain && rng.next() < 0.25,
  }));
  const myStack = (stacks[seat] as SeatState).stack;

  let position = pick(rng, POSITIONS[numSeats] as readonly Position[]);
  const history: HistoryEntry[] = [];
  let currentBet = 0;
  let committedThisStreet = 0;

  if (street === "preflop") {
    const raised = rng.next() < 0.3;
    // Half of the unraised pots are the big blind's option: nothing to call against a live bet.
    if (!raised && rng.next() < 0.5) position = "BB";
    const postsSmallBlind = position === "SB" || (numSeats === 2 && position === "BTN");
    committedThisStreet = position === "BB" ? bigBlind : postsSmallBlind ? bigBlind / 2 : 0;
    currentBet = bigBlind;
    if (raised) {
      // Somebody has already raised, which is what drives the 3-bet branches of the agents.
      if (rng.next() < 0.3) {
        // The hero opened and was re-raised.
        committedThisStreet = 2 * bigBlind + randomInt(rng, 3) * bigBlind;
        currentBet = committedThisStreet;
        history.push({ street, seat, action: { type: "raise", amount: committedThisStreet } });
      }
      currentBet = 2 * currentBet + randomInt(rng, 9) * bigBlind;
      history.push({ street, seat: villain, action: { type: "raise", amount: currentBet } });
    } else if (position === "BB" || rng.next() < 0.3) {
      // A limper. The big blind only gets its option when somebody called.
      history.push({ street, seat: villain, action: { type: "call" } });
    }
  } else {
    // A preflop raise in the history of a later street; agents must not read it as this street's.
    if (rng.next() < 0.2) {
      const amount = 2 * bigBlind + randomInt(rng, 9) * bigBlind;
      history.push({ street: "preflop", seat: villain, action: { type: "raise", amount } });
      history.push({ street: "preflop", seat, action: { type: "call" } });
    }
    const roll = rng.next();
    if (roll < 0.5) {
      // Checked to the hero, or the hero is first to act.
      if (rng.next() < 0.5) history.push({ street, seat: villain, action: { type: "check" } });
    } else if (roll < 0.85) {
      currentBet = bigBlind + randomInt(rng, 2000);
      history.push({ street, seat: villain, action: { type: "bet", amount: currentBet } });
    } else {
      // The hero bet and was raised.
      committedThisStreet = bigBlind * (1 + randomInt(rng, 4));
      currentBet = 2 * committedThisStreet + randomInt(rng, 2000);
      history.push({ street, seat, action: { type: "bet", amount: committedThisStreet } });
      history.push({ street, seat: villain, action: { type: "raise", amount: currentBet } });
    }
  }

  // The hero's stack is what is left behind after the chips already committed on this street.
  const owed = currentBet - committedThisStreet;
  const toCall = Math.min(owed, myStack);
  const pot = bigBlind + randomInt(rng, 2000) + currentBet + committedThisStreet;

  // A raise is impossible when the call already takes the whole stack, and (15% of the bets
  // faced) when the hero already acted and the bet is a short all-in that did not reopen the action.
  const maxRaiseTo = committedThisStreet + myStack;
  const closed = owed > 0 && rng.next() < 0.15;
  let minRaiseTo: number | null = currentBet === 0 ? bigBlind : currentBet + bigBlind;
  if (closed || myStack <= owed) minRaiseTo = null;
  else if (maxRaiseTo < minRaiseTo) minRaiseTo = maxRaiseTo;

  const legal: LegalActions = {
    canFold: owed > 0,
    canCheck: owed === 0,
    callAmount: owed === 0 ? null : toCall,
    minRaiseTo,
    maxRaiseTo: minRaiseTo === null ? null : maxRaiseTo,
  };

  const view: PlayerView = {
    seat,
    street,
    holeCards,
    board,
    stacks,
    pot,
    toCall,
    currentBet,
    committedThisStreet,
    bigBlind,
    position,
    history,
  };

  return { view, legal };
}
