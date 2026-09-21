import type { Card } from "./cards";
import type { HandValue } from "./evaluator";

export type SeatId = number;
export type SeatKind = "human" | "cpu";

export interface SeatConfig {
  readonly id: SeatId;
  readonly name: string;
  readonly kind: SeatKind;
  readonly personaId?: string;
}

export interface Blinds {
  readonly small: number;
  readonly big: number;
  readonly ante: number;
}

export interface BlindSchedule {
  /** Blinds for the given 0-based hand number and elapsed play time. */
  blindsFor(handNumber: number, elapsedMs: number): Blinds;
}

export type GameFormat = "cash" | "tournament";

export interface GameConfig {
  readonly format: GameFormat;
  readonly blinds: BlindSchedule;
  readonly startingStack: number;
  readonly seats: readonly SeatConfig[];
  /** RNG seed for reproducible games (tests). Random when omitted. */
  readonly seed?: number;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type Action =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call" }
  /** Open a betting round; `amount` is the total bet. */
  | { readonly type: "bet"; readonly amount: number }
  /** Raise to `amount` in total for this street ("raise to"). */
  | { readonly type: "raise"; readonly amount: number }
  | { readonly type: "allin" };

export interface LegalActions {
  readonly canFold: boolean;
  readonly canCheck: boolean;
  /** Chips needed to call (capped at stack), or null when checking is possible. */
  readonly callAmount: number | null;
  /** Smallest legal total bet/raise-to, or null when raising is impossible. */
  readonly minRaiseTo: number | null;
  /** Largest legal total bet/raise-to (all-in), or null when raising is impossible. */
  readonly maxRaiseTo: number | null;
}

export const NO_ACTIONS: LegalActions = {
  canFold: false,
  canCheck: false,
  callAmount: null,
  minRaiseTo: null,
  maxRaiseTo: null,
};

export interface HandPlayerSnapshot {
  readonly seat: SeatId;
  readonly stack: number;
  readonly holeCards: readonly [Card, Card];
  /** Total chips put in this hand (including blinds and antes). */
  readonly contributed: number;
  /** Chips put in during the current street (excluding antes). */
  readonly streetBet: number;
  readonly folded: boolean;
  readonly allIn: boolean;
}

export interface HandSnapshot {
  readonly handNumber: number;
  readonly button: SeatId;
  readonly street: Street;
  readonly board: readonly Card[];
  /** In clockwise seat order. */
  readonly players: readonly HandPlayerSnapshot[];
  readonly actingSeat: SeatId | null;
  /** Seats still to act this street, in order, starting with `actingSeat`. */
  readonly toAct: readonly SeatId[];
  readonly currentBet: number;
  readonly minRaise: number;
  readonly bigBlind: number;
  /** Sum of all contributions so far. */
  readonly pot: number;
  readonly complete: boolean;
}

export interface SeatStack {
  readonly id: SeatId;
  readonly stack: number;
}

export type GameEvent =
  | {
      readonly type: "HandStarted";
      readonly handNumber: number;
      readonly button: SeatId;
      readonly blinds: Blinds;
      readonly seats: readonly SeatStack[];
    }
  | {
      readonly type: "BlindsPosted";
      readonly posts: readonly {
        readonly seat: SeatId;
        readonly kind: "ante" | "small" | "big";
        readonly amount: number;
      }[];
    }
  | {
      readonly type: "HoleCardsDealt";
      readonly hands: readonly { readonly seat: SeatId; readonly cards: readonly [Card, Card] }[];
    }
  | {
      readonly type: "ActionTaken";
      readonly street: Street;
      readonly seat: SeatId;
      /** Normalized action: `allin` becomes `call`/`bet`/`raise` with the real total. */
      readonly action: Action;
      /** Chips moved into the pot by this action. */
      readonly amount: number;
      readonly allIn: boolean;
    }
  | { readonly type: "StreetDealt"; readonly street: Street; readonly board: readonly Card[] }
  | {
      readonly type: "Showdown";
      readonly hands: readonly {
        readonly seat: SeatId;
        readonly cards: readonly [Card, Card];
        readonly value: HandValue;
      }[];
    }
  | {
      readonly type: "PotAwarded";
      readonly pots: readonly { readonly amount: number; readonly eligible: readonly SeatId[] }[];
      readonly awards: readonly {
        readonly seat: SeatId;
        readonly amount: number;
        readonly potIndex: number;
      }[];
    }
  | { readonly type: "SeatRebought"; readonly seat: SeatId; readonly amount: number }
  | {
      readonly type: "HandEnded";
      readonly handNumber: number;
      readonly stacks: readonly SeatStack[];
    };
