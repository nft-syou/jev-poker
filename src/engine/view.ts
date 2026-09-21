import type { Card } from "./cards";
import type { Action, GameEvent, HandSnapshot, SeatId, Street } from "./types";

export type Position = "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO";
export type ActionTakenEvent = Extract<GameEvent, { type: "ActionTaken" }>;

export interface SeatState {
  readonly seat: SeatId;
  readonly stack: number;
  readonly isAllIn: boolean;
  readonly folded: boolean;
}

export interface HistoryEntry {
  readonly street: Street;
  readonly seat: SeatId;
  /** A bet or raise that put the seat all in is recorded as `allin`. */
  readonly action: Action;
}

/**
 * What one seat knows when it has to act: its own cards, the public state and the hand so far.
 * Anything that decides for a seat (a CPU, a benchmark bot) works from this alone, so the same
 * decision code runs on the game's own hands and on hands played elsewhere.
 */
export interface PlayerView {
  readonly seat: SeatId;
  readonly street: Street;
  readonly holeCards: readonly Card[];
  readonly board: readonly Card[];
  /** Every seat dealt into the hand, in clockwise order. */
  readonly stacks: readonly SeatState[];
  readonly pot: number;
  readonly toCall: number;
  /** The bet every player must match on this street (a raise-to total); 0 when nobody has bet. */
  readonly currentBet: number;
  /** Chips this seat has already put in on the current street (blinds included). */
  readonly committedThisStreet: number;
  readonly bigBlind: number;
  readonly position: Position;
  readonly history: readonly HistoryEntry[];
}

export function positionOf(seat: SeatId, snapshot: HandSnapshot): Position {
  const seats = snapshot.players.map((p) => p.seat);
  const n = seats.length;
  const buttonIndex = seats.indexOf(snapshot.button);
  if (buttonIndex < 0) throw new Error("button is not seated");
  const order = seats.map((_, i) => seats[(buttonIndex + 1 + i) % n] as SeatId);
  const index = order.indexOf(seat);
  if (index < 0) throw new Error(`seat ${seat} is not in the hand`);
  // Heads-up the button posts the small blind; it is named for the seat that acts last postflop.
  if (n === 2) return seat === snapshot.button ? "BTN" : "BB";
  if (index === 0) return "SB";
  if (index === 1) return "BB";
  if (index === n - 1) return "BTN";
  if (index === n - 2) return "CO";
  if (index === 2) return "UTG";
  return "MP";
}

export function historyEntry(event: ActionTakenEvent): HistoryEntry {
  const { action } = event;
  const shoved = event.allIn && (action.type === "bet" || action.type === "raise");
  return { street: event.street, seat: event.seat, action: shoved ? { type: "allin" } : action };
}

export function playerView(
  snapshot: HandSnapshot,
  seat: SeatId,
  actions: readonly ActionTakenEvent[],
): PlayerView {
  const me = snapshot.players.find((p) => p.seat === seat);
  if (me === undefined) throw new Error(`seat ${seat} is not in the hand`);
  return {
    seat,
    street: snapshot.street,
    holeCards: me.holeCards,
    board: snapshot.board,
    stacks: snapshot.players.map((p) => ({
      seat: p.seat,
      stack: p.stack,
      isAllIn: p.allIn,
      folded: p.folded,
    })),
    pot: snapshot.pot,
    toCall: Math.min(Math.max(0, snapshot.currentBet - me.streetBet), me.stack),
    currentBet: snapshot.currentBet,
    committedThisStreet: me.streetBet,
    bigBlind: snapshot.bigBlind,
    position: positionOf(seat, snapshot),
    history: actions.map(historyEntry),
  };
}

/** A bet opens the street; putting in more than a bet that is already there (the big blind included) is a raise. */
export function betOrRaiseTo(view: Pick<PlayerView, "currentBet">, amount: number): Action {
  return view.currentBet === 0 ? { type: "bet", amount } : { type: "raise", amount };
}
