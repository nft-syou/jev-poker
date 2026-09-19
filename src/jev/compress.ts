import { cardToString, type Card } from '../engine/cards.js';
import { estimateEquity } from '../engine/equity.js';
import type { HandCategory } from '../engine/evaluate.js';
import { draws, madeHand, pairKind, preflopStrength, type Draw, type PairKind, type PreflopStrength } from '../engine/strength.js';
import type { Action, LegalActions, PlayerView, Position, SeatId, Street } from '../engine/types.js';
import type { Persona } from './personas.js';

export const TASK = "Decide the next poker action for the acting player in No-Limit Texas Hold'em.";

export const IMPORTANT_CONTEXT: readonly string[] = [
  'Only legal actions are offered.',
  'Amounts are in big blinds.',
  "You cannot see other players' hole cards.",
  'Stay in character as the persona.',
  'equityVsRandomPct is your estimated chance to win at showdown against random hands. Opponents who have bet or raised usually hold far better than random hands, so discount it heavily against aggression.',
  'Before calling, compare your equity with requiredEquityPct (the pot odds). Do not call large bets or raises without a strong made hand (two pair or better) or a strong draw getting the right price.',
  'Do not raise as a bluff if you would fold to a re-raise; a bluff only works when the opponent can fold.',
  'When myBetWasRaisedThisStreet is true, your bet has been raised: re-raise only for value with two pair or better; with a draw call only if the price is right, otherwise fold. Never bluff re-raise and then fold.',
  'raisesThisStreet counts the bets and raises so far on this street; two or more means someone is very strong, so one pair or a weak draw should fold.',
  'On the turn and river, a bet from an opponent usually beats one pair; call with one pair only when the bet is small relative to the pot, and fold to big bets and raises.',
  'pairKind tells how good a one-pair hand is: top_pair and overpair are decent, middle_pair, bottom_pair, underpair and board_pair are weak.',
  'Heads-up, the button should open-raise most hands and the big blind should defend against small raises; folding the small blind too often bleeds chips.',
];

export interface JevHand {
  street: Street;
  /** Space separated, e.g. `"As Kd"`. */
  holeCards: string;
  board: string;
  /** Present only once the board has at least three cards. */
  madeHand?: HandCategory;
  /** Present only when `madeHand` is `'pair'`: how the pair rates against the board. */
  pairKind?: PairKind;
  /** Present only on the flop and the turn, where a draw can still come in. */
  draws?: Draw[];
  preflopStrength: PreflopStrength;
  /** Monte Carlo showdown equity against random hands for every live opponent, in percent. */
  equityVsRandomPct: number;
}

export interface JevSeat {
  seat: SeatId;
  stackBB: number;
  isAllIn: boolean;
  /** A folded seat is still listed, so the model can tell "0 bb, all-in" from "out of the hand". */
  folded: boolean;
}

export interface JevTable {
  position: Position;
  playersInHand: number;
  playersToAct: number;
  potBB: number;
  toCallBB: number;
  potOddsPct: number;
  /** Equity needed to break even on a call; equals the pot odds. 0 when nothing is due. */
  requiredEquityPct: number;
  effectiveStackBB: number;
  /** Number of bets/raises made on the current street so far (by anyone). */
  raisesThisStreet: number;
  /** True when the acting player bet or raised on this street and an opponent raised after that. */
  myBetWasRaisedThisStreet: boolean;
  stacksBB: JevSeat[];
}

export interface JevHistoryEntry {
  street: Street;
  seat: SeatId;
  action: Action['type'];
  amountBB?: number;
}

export interface JevState {
  task: string;
  persona: { name: string; description: string };
  importantContext: string[];
  hand: JevHand;
  table: JevTable;
  history: JevHistoryEntry[];
}

/** Big blinds, rounded to one decimal so the state stays short and stable. */
function bb(amount: number, bigBlind: number): number {
  if (bigBlind <= 0) return 0;
  return Math.round((amount / bigBlind) * 10) / 10;
}

function cards(cs: readonly Card[]): string {
  return cs.map(cardToString).join(' ');
}

/**
 * Reduce a `PlayerView` to the compact, already-computed state Jev sees.
 * Everything a program can work out exactly (hand category, draws, pot odds) is
 * worked out here; no raw event log and no opponent hole cards are included.
 *
 * `_legal` is accepted so callers pass the view and its legal actions together —
 * the legal actions shape the question set (`buildQuestions`), not the state.
 */
export function compressState(view: PlayerView, _legal: LegalActions, persona: Persona): JevState {
  const { bigBlind } = view;
  const live = view.stacks.filter((s) => !s.folded);
  const me = view.stacks.find((s) => s.seat === view.seat);
  const otherStacks = live.filter((s) => s.seat !== view.seat).map((s) => s.stack);
  const maxOther = otherStacks.length > 0 ? Math.max(...otherStacks) : 0;

  // A seat always holds exactly two hole cards; `preflopStrength` throws otherwise,
  // and `JevAgent` fails open on that. `madeHand`/`draws` depend only on the board.
  const showMade = view.board.length >= 3;
  const showDraws = view.board.length === 3 || view.board.length === 4;

  const hand: JevHand = {
    street: view.street,
    holeCards: cards(view.holeCards),
    board: cards(view.board),
    ...(showMade ? { madeHand: madeHand(view.holeCards, view.board) } : {}),
    ...(showMade && pairKind(view.holeCards, view.board) !== null
      ? { pairKind: pairKind(view.holeCards, view.board)! }
      : {}),
    ...(showDraws ? { draws: draws(view.holeCards, view.board) } : {}),
    preflopStrength: preflopStrength(view.holeCards),
    equityVsRandomPct: estimateEquity(view.holeCards, view.board, Math.max(1, live.length - 1)),
  };

  const potOddsPct = view.toCall > 0 ? Math.round((100 * view.toCall) / (view.pot + view.toCall)) : 0;
  const aggressive = (t: Action['type']) => t === 'bet' || t === 'raise' || t === 'allin';
  const thisStreet = view.history.filter((h) => h.street === view.street);
  const raisesThisStreet = thisStreet.filter((h) => aggressive(h.action.type)).length;
  const myLastAggression = thisStreet.map((h, i) => ({ h, i })).filter(({ h }) => h.seat === view.seat && aggressive(h.action.type)).pop();
  const myBetWasRaisedThisStreet =
    myLastAggression !== undefined &&
    thisStreet.slice(myLastAggression.i + 1).some((h) => h.seat !== view.seat && aggressive(h.action.type));
  const table: JevTable = {
    position: view.position,
    playersInHand: live.length,
    playersToAct: live.filter((s) => s.seat !== view.seat && !s.isAllIn).length,
    potBB: bb(view.pot, bigBlind),
    toCallBB: bb(view.toCall, bigBlind),
    potOddsPct,
    requiredEquityPct: potOddsPct,
    raisesThisStreet,
    myBetWasRaisedThisStreet,
    effectiveStackBB: bb(Math.min(me?.stack ?? 0, maxOther), bigBlind),
    stacksBB: view.stacks.map((s) => ({
      seat: s.seat,
      stackBB: bb(s.stack, bigBlind),
      isAllIn: s.isAllIn,
      folded: s.folded,
    })),
  };

  const history: JevHistoryEntry[] = view.history.map((h) => ({
    street: h.street,
    seat: h.seat,
    action: h.action.type,
    ...(h.action.type === 'bet' || h.action.type === 'raise'
      ? { amountBB: bb(h.action.amount, bigBlind) }
      : {}),
  }));

  return {
    task: TASK,
    persona: { name: persona.name.en, description: persona.description.en },
    importantContext: [...IMPORTANT_CONTEXT],
    hand,
    table,
    history,
  };
}
