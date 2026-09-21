import {
  type Action,
  type HistoryEntry,
  type LegalActions,
  type PlayerView,
  parseCard,
  type Street,
} from "../../src/engine";

/** Slumbot's fixed game: heads-up no-limit hold'em, blinds 50/100, 200 bb stacks that reset every hand. */
export const SMALL_BLIND = 50;
export const BIG_BLIND = 100;
export const STACK_SIZE = 20_000;

const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];

/** Our seat numbers in the `PlayerView` handed to agents: the client is always seat 0. */
export const HERO_SEAT = 0;
export const SLUMBOT_SEAT = 1;

/**
 * Position as Slumbot numbers it: 0 is the big blind (acts second preflop, first postflop),
 * 1 is the small blind / button.
 */
export type Pos = 0 | 1;

export interface ReplayState {
  /** 0 preflop .. 3 river. */
  street: number;
  /** Who acts next, or `null` when the hand is over. */
  toAct: Pos | null;
  /** Chips put in by each position over the whole hand, indexed by position. */
  total: [number, number];
  /** Chips put in by each position on the current street. */
  onStreet: [number, number];
  /** The street bet-to everyone must match (Slumbot's `street_last_bet_to`). */
  currentBet: number;
  /** Size of the last bet or raise on this street; the minimum raise increment. 0 when nobody has bet. */
  lastBetSize: number;
  folded: Pos | null;
  /** Every action in order, with the amount of a bet as the street bet-to total. */
  actions: { street: number; pos: Pos; type: "fold" | "check" | "call" | "bet"; amount?: number }[];
}

function other(p: Pos): Pos {
  return p === 0 ? 1 : 0;
}

/** `undefined` (past the end of the string) is not a digit. */
function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Replay a Slumbot action string such as `b200c/kk/kb400`. Bet sizes are the chips a player has
 * put in on that street. Mirrors the reference `ParseAction` of Slumbot's sample client, and
 * additionally tracks who put in what.
 */
export function replay(action: string): ReplayState {
  const s: ReplayState = {
    street: 0,
    toAct: 1,
    total: [BIG_BLIND, SMALL_BLIND],
    onStreet: [BIG_BLIND, SMALL_BLIND],
    currentBet: BIG_BLIND,
    lastBetSize: BIG_BLIND - SMALL_BLIND,
    folded: null,
    actions: [],
  };
  let closes = false; // the next check or call ends the street
  let i = 0;

  const nextStreet = (): void => {
    if (s.street === STREETS.length - 1) {
      s.toAct = null; // showdown
      return;
    }
    s.street += 1;
    s.onStreet = [0, 0];
    s.currentBet = 0;
    s.lastBetSize = 0;
    s.toAct = 0;
    closes = false;
    if (action[i] === "/") i += 1;
  };

  while (i < action.length) {
    const c = action[i] as string;
    i += 1;
    if (c === "/") continue; // trailing separators of an all-in run-out
    const pos = s.toAct;
    if (pos === null) throw new Error(`action continues after the hand ended: ${action}`);

    if (c === "k") {
      if (s.currentBet > s.onStreet[pos]) throw new Error(`illegal check in ${action}`);
      s.actions.push({ street: s.street, pos, type: "check" });
      if (closes) nextStreet();
      else {
        s.toAct = other(pos);
        closes = true;
      }
    } else if (c === "c") {
      const owed = s.currentBet - s.onStreet[pos];
      if (owed <= 0) throw new Error(`illegal call in ${action}`);
      s.total[pos] += owed;
      s.onStreet[pos] = s.currentBet;
      s.lastBetSize = 0;
      s.actions.push({ street: s.street, pos, type: "call" });
      if (s.total[0] >= STACK_SIZE && s.total[1] >= STACK_SIZE) {
        s.toAct = null; // an all-in was called: the board runs out
        s.street = STREETS.length - 1;
      } else if (closes) nextStreet();
      else {
        s.toAct = other(pos); // the small blind limped; the big blind has the option
        closes = true;
      }
    } else if (c === "f") {
      s.actions.push({ street: s.street, pos, type: "fold" });
      s.folded = pos;
      s.toAct = null;
    } else if (c === "b") {
      const start = i;
      while (isDigit(action[i])) i += 1;
      if (i === start) throw new Error(`missing bet size in ${action}`);
      const betTo = Number(action.slice(start, i));
      s.lastBetSize = betTo - s.currentBet;
      s.total[pos] += betTo - s.onStreet[pos];
      s.onStreet[pos] = betTo;
      s.currentBet = betTo;
      s.actions.push({ street: s.street, pos, type: "bet", amount: betTo });
      s.toAct = other(pos);
      closes = true;
    } else {
      throw new Error(`unexpected character '${c}' in ${action}`);
    }
  }
  return s;
}

/** What the client sees and may do, in the engine's own types, so any `Agent` can play. */
export function heroView(
  action: string,
  clientPos: Pos,
  holeCards: readonly string[],
  board: readonly string[],
): { view: PlayerView; legal: LegalActions } {
  const s = replay(action);
  if (s.toAct !== clientPos)
    throw new Error(`it is not the client's turn (action ${action}, client_pos ${clientPos})`);
  const me = clientPos;
  const opp = other(me);
  const myStack = STACK_SIZE - s.total[me];
  const oppStack = STACK_SIZE - s.total[opp];
  const toCall = Math.min(Math.max(0, s.currentBet - s.onStreet[me]), myStack);
  const seatOf = (p: Pos): number => (p === me ? HERO_SEAT : SLUMBOT_SEAT);

  const history: HistoryEntry[] = s.actions.map((a) => {
    const street = STREETS[a.street] as Street;
    const seat = seatOf(a.pos);
    if (a.type === "bet") {
      // A bet into an unbet street is a bet; anything over a standing bet (the blinds included) is a raise.
      const raised = s.actions.some(
        (b) =>
          b !== a &&
          b.street === a.street &&
          b.type === "bet" &&
          s.actions.indexOf(b) < s.actions.indexOf(a),
      );
      const type = a.street === 0 || raised ? "raise" : "bet";
      return { street, seat, action: { type, amount: a.amount ?? 0 } };
    }
    return { street, seat, action: { type: a.type } };
  });

  const view: PlayerView = {
    seat: HERO_SEAT,
    street: STREETS[s.street] as Street,
    holeCards: holeCards.map(parseCard),
    board: board.map(parseCard),
    stacks: [
      { seat: HERO_SEAT, stack: myStack, isAllIn: myStack === 0, folded: false },
      { seat: SLUMBOT_SEAT, stack: oppStack, isAllIn: oppStack === 0, folded: false },
    ],
    pot: s.total[0] + s.total[1],
    toCall,
    currentBet: s.currentBet,
    committedThisStreet: s.onStreet[me],
    bigBlind: BIG_BLIND,
    position: me === 1 ? "BTN" : "BB",
    history,
  };

  const canRaise = myStack > toCall && oppStack > 0;
  const maxRaiseTo = s.onStreet[me] + myStack;
  const minRaiseTo = Math.min(s.currentBet + Math.max(s.lastBetSize, BIG_BLIND), maxRaiseTo);
  const legal: LegalActions = {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? toCall : null,
    minRaiseTo: canRaise ? minRaiseTo : null,
    maxRaiseTo: canRaise ? maxRaiseTo : null,
  };
  return { view, legal };
}

/** The `incr` string for an engine action. Anything the position does not allow degrades to a check or a call. */
export function encodeAction(action: Action, legal: LegalActions): string {
  const passive = legal.canCheck ? "k" : "c";
  switch (action.type) {
    case "fold":
      return legal.canFold ? "f" : "k";
    case "check":
    case "call":
      return passive;
    case "allin":
      return legal.maxRaiseTo === null ? passive : `b${legal.maxRaiseTo}`;
    case "bet":
    case "raise": {
      if (legal.minRaiseTo === null || legal.maxRaiseTo === null) return passive;
      const amount = Math.round(
        Math.min(Math.max(action.amount, legal.minRaiseTo), legal.maxRaiseTo),
      );
      return `b${amount}`;
    }
  }
}
