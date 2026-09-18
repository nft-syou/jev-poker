import type { Card } from './cards.js';
import type { HandValue } from './evaluate.js';

export type SeatId = number;
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'CO';

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allin' };

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number | null;
  /** Smallest legal raise-to amount, or `null` when raising is not allowed at all. */
  minRaiseTo: number | null;
  /**
   * Largest legal raise-to amount (the seat's whole stack), or `null`.
   *
   * Invariant: `minRaiseTo !== null` implies `maxRaiseTo !== null`. The converse
   * does **not** hold — `maxRaiseTo` can be a number while `minRaiseTo` is
   * `null` (e.g. a seat that has already acted and faces an incomplete all-in
   * raise: it may call, but no raise is legal). So agents must gate raises
   * **and all-ins-as-a-raise** on `minRaiseTo`, never on `maxRaiseTo`.
   */
  maxRaiseTo: number | null;
}

export interface SeatConfig {
  id: SeatId;
  name: string;
  kind: 'human' | 'cpu';
  agentId?: string;
}

export interface Blinds {
  small: number;
  big: number;
  ante: number;
}

export interface BlindSchedule {
  blindsFor(handNumber: number, elapsedMs: number): Blinds;
}

export function fixedBlinds(b: Blinds): BlindSchedule {
  return { blindsFor: () => b };
}

export interface GameConfig {
  format: 'cash' | 'tournament';
  blinds: BlindSchedule;
  startingStack: number;
  seats: SeatConfig[];
  seed?: number;
}

export interface SeatState {
  seat: SeatId;
  stack: number;
  isAllIn: boolean;
  folded: boolean;
}

export interface HistoryEntry {
  street: Street;
  seat: SeatId;
  action: Action;
}

export interface PlayerView {
  seat: SeatId;
  street: Street;
  holeCards: Card[];
  board: Card[];
  stacks: SeatState[];
  pot: number;
  toCall: number;
  bigBlind: number;
  position: Position;
  history: HistoryEntry[];
}

export type TableEvent =
  | { type: 'HandStarted'; handNumber: number; button: SeatId }
  | { type: 'BlindsPosted'; posts: { seat: SeatId; amount: number }[] }
  | { type: 'HoleCardsDealt'; seat: SeatId; cards: Card[] }
  | { type: 'ActionTaken'; seat: SeatId; action: Action; street: Street }
  | { type: 'StreetDealt'; street: Street; board: Card[] }
  | { type: 'Showdown'; hands: { seat: SeatId; cards: Card[]; value: HandValue }[] }
  | { type: 'PotAwarded'; seat: SeatId; amount: number; potIndex: number }
  | { type: 'HandEnded'; stacks: { seat: SeatId; stack: number }[] }
  | { type: 'SeatRebought'; seat: SeatId; amount: number };
