import type { Card } from './cards.js';
import { newDeck } from './cards.js';
import type { HandValue } from './evaluate.js';
import { evaluate7 } from './evaluate.js';
import { awardPots, buildPots } from './pots.js';
import type { Rng } from './rng.js';
import type {
  Action, Blinds, HistoryEntry, LegalActions, PlayerView, SeatId, SeatState, Street, TableEvent,
} from './types.js';

export interface HandInit {
  seats: { seat: SeatId; stack: number }[];
  button: SeatId;
  blinds: Blinds;
  rng: Rng;
  handNumber: number;
}

const NO_ACTIONS: LegalActions = {
  canFold: false, canCheck: false, callAmount: null, minRaiseTo: null, maxRaiseTo: null,
};

/**
 * One hand of No-Limit Texas Hold'em. Drive it with `legalActions` / `act`;
 * every state change is reported through the `emit` callback.
 */
export class Hand {
  wentToShowdown = false;

  private readonly emit: (e: TableEvent) => void;
  private readonly blinds: Blinds;
  private readonly allSeats: SeatId[];
  /** Seats in the hand, in table order starting left of the button. */
  private readonly order: SeatId[];
  private readonly bbSeat: SeatId;
  private readonly stacks = new Map<SeatId, number>();
  private readonly committed = new Map<SeatId, number>();   // this street
  private readonly contributed = new Map<SeatId, number>(); // whole hand
  private readonly folded = new Set<SeatId>();
  private readonly allIn = new Set<SeatId>();
  private readonly actedSinceRaise = new Set<SeatId>();
  private readonly hole = new Map<SeatId, Card[]>();
  private readonly deck: Card[];
  private readonly boardCards: Card[] = [];
  private readonly entries: HistoryEntry[] = [];
  private deckAt = 0;
  private currentBet = 0;
  private lastRaiseSize = 0;
  private streetName: Street = 'preflop';
  private over = false;
  private actor: SeatId | null = null;

  constructor(init: HandInit, emit: (e: TableEvent) => void) {
    this.emit = emit;
    this.blinds = init.blinds;
    const seats = [...init.seats].sort((a, b) => a.seat - b.seat);
    this.allSeats = seats.map((s) => s.seat);
    for (const s of seats) this.stacks.set(s.seat, s.stack);
    const live = seats.filter((s) => s.stack > 0).map((s) => s.seat);
    if (live.length < 2) throw new Error('Hand needs at least two seats with chips');
    const pivot = Math.max(0, live.findIndex((s) => s > init.button));
    this.order = [...live.slice(pivot), ...live.slice(0, pivot)];
    for (const s of this.order) { this.committed.set(s, 0); this.contributed.set(s, 0); }
    this.deck = init.rng.shuffle(newDeck());

    this.emit({ type: 'HandStarted', handNumber: init.handNumber, button: init.button });
    this.bbSeat = this.postBlinds();
    this.dealHoleCards();
    const first = this.canOpenBetting() ? this.nextToAct(this.bbSeat) : null;
    if (first === null) this.advance(); else this.actor = first;
  }

  get street(): Street { return this.streetName; }
  get isOver(): boolean { return this.over; }
  get board(): Card[] { return [...this.boardCards]; }
  get toAct(): SeatId | null { return this.actor; }

  holeCards(seat: SeatId): Card[] { return [...(this.hole.get(seat) ?? [])]; }

  legalActions(seat: SeatId): LegalActions {
    if (this.over || !this.contributed.has(seat) || this.folded.has(seat) || this.allIn.has(seat)) return { ...NO_ACTIONS };
    const stack = this.stacks.get(seat) ?? 0;
    const committed = this.committed.get(seat) ?? 0;
    const toCall = Math.max(0, this.currentBet - committed);
    const maxRaiseTo = committed + stack;
    // Betting needs an opponent who can still act; with everyone else folded or
    // all-in there is nothing to bet or raise into, only a call to settle.
    const contested = this.liveActors().length >= 2;
    // A player who already acted since the last full raise may only call or fold
    // (they are facing an incomplete all-in raise, which does not reopen betting).
    const canRaise = contested && stack > toCall && !this.actedSinceRaise.has(seat);
    const fullRaiseTo = this.currentBet + Math.max(this.lastRaiseSize, this.blinds.big);
    return {
      canFold: toCall > 0,
      canCheck: toCall === 0,
      callAmount: toCall > 0 ? Math.min(toCall, stack) : null,
      minRaiseTo: canRaise ? Math.min(fullRaiseTo, maxRaiseTo) : null,
      maxRaiseTo: contested ? maxRaiseTo : null,
    };
  }

  act(seat: SeatId, action: Action): void {
    if (this.over) throw new Error('hand is already over');
    if (seat !== this.actor) throw new Error(`seat ${seat} cannot act: it is seat ${String(this.actor)}'s turn`);
    const la = this.legalActions(seat);
    const committed = this.committed.get(seat) ?? 0;
    const toCall = Math.max(0, this.currentBet - committed);
    let recorded: Action = action;
    switch (action.type) {
      case 'fold':
        if (!la.canFold) throw new Error('cannot fold: checking is free');
        this.folded.add(seat);
        break;
      case 'check':
        if (!la.canCheck) throw new Error('cannot check while facing a bet');
        break;
      case 'call':
        if (la.callAmount === null) throw new Error('cannot call: there is nothing to call');
        this.wager(seat, la.callAmount);
        break;
      case 'bet':
      case 'raise': {
        // `bet` and `raise` are interchangeable; the amount is always a raise-to
        // total for the street and the recorded verb is normalised below.
        if (la.minRaiseTo === null || la.maxRaiseTo === null) throw new Error(`seat ${seat} cannot ${action.type} here`);
        if (!Number.isInteger(action.amount)) throw new Error('amount must be a whole number of chips');
        if (action.amount < la.minRaiseTo || action.amount > la.maxRaiseTo) {
          throw new Error(`${action.type} to ${action.amount} outside [${la.minRaiseTo}, ${la.maxRaiseTo}]`);
        }
        recorded = { type: this.currentBet === 0 ? 'bet' : 'raise', amount: action.amount };
        this.wager(seat, action.amount - committed);
        break;
      }
      case 'allin': {
        const stack = this.stacks.get(seat) ?? 0;
        if (stack <= 0) throw new Error('cannot go all-in without chips');
        // Legal either as a raise, or as an all-in for less than (or exactly) a call.
        if (la.minRaiseTo === null && stack > toCall) throw new Error(`seat ${seat} cannot go all-in here`);
        this.wager(seat, stack);
        break;
      }
      default:
        throw new Error(`unknown action: ${JSON.stringify(action)}`);
    }
    this.actedSinceRaise.add(seat);
    this.entries.push({ street: this.streetName, seat, action: { ...recorded } });
    this.emit({ type: 'ActionTaken', seat, action: { ...recorded }, street: this.streetName });

    const contenders = this.order.filter((s) => !this.folded.has(s));
    if (contenders.length === 1) { this.endByFold(contenders[0]!); return; }
    const next = this.nextToAct(seat);
    if (next === null) this.advance(); else this.actor = next;
  }

  view(seat: SeatId): Omit<PlayerView, 'position'> {
    const stack = this.stacks.get(seat) ?? 0;
    let pot = 0;
    for (const v of this.contributed.values()) pot += v;
    const stacks: SeatState[] = this.allSeats.map((s) => ({
      seat: s, stack: this.stacks.get(s) ?? 0, isAllIn: this.allIn.has(s), folded: this.folded.has(s),
    }));
    return {
      seat,
      street: this.streetName,
      holeCards: this.holeCards(seat),
      board: this.board,
      stacks,
      pot,
      toCall: Math.min(Math.max(0, this.currentBet - (this.committed.get(seat) ?? 0)), stack),
      currentBet: this.currentBet,
      committedThisStreet: this.committed.get(seat) ?? 0,
      bigBlind: this.blinds.big,
      history: this.entries.map((h) => ({ ...h })),
    };
  }

  finalStacks(): { seat: SeatId; stack: number }[] {
    return this.allSeats.map((s) => ({ seat: s, stack: this.stacks.get(s) ?? 0 }));
  }

  // ---- setup -------------------------------------------------------------

  /** Posts antes then blinds (each capped by stack) and returns the big blind seat. */
  private postBlinds(): SeatId {
    const posts: { seat: SeatId; amount: number }[] = [];
    const post = (seat: SeatId, amount: number): number => {
      const paid = Math.min(amount, this.stacks.get(seat) ?? 0);
      if (paid <= 0) return 0;
      this.stacks.set(seat, (this.stacks.get(seat) ?? 0) - paid);
      this.contributed.set(seat, (this.contributed.get(seat) ?? 0) + paid);
      if ((this.stacks.get(seat) ?? 0) === 0) this.allIn.add(seat);
      posts.push({ seat, amount: paid });
      return paid;
    };
    if (this.blinds.ante > 0) for (const seat of this.order) post(seat, this.blinds.ante);
    const headsUp = this.order.length === 2;
    const sb = headsUp ? this.order[1]! : this.order[0]!;
    const bb = headsUp ? this.order[0]! : this.order[1]!;
    for (const [seat, amount] of [[sb, this.blinds.small], [bb, this.blinds.big]] as const) {
      this.committed.set(seat, (this.committed.get(seat) ?? 0) + post(seat, amount));
    }
    // Blinds are capped by stack, so a big blind that is all-in for less than the
    // full blind sets a correspondingly smaller amount to call.
    this.currentBet = Math.max(0, ...this.order.map((s) => this.committed.get(s) ?? 0));
    this.lastRaiseSize = this.blinds.big;
    if (posts.length > 0) this.emit({ type: 'BlindsPosted', posts });
    return bb;
  }

  private dealHoleCards(): void {
    for (const seat of this.order) this.hole.set(seat, []);
    for (let round = 0; round < 2; round++) for (const seat of this.order) this.hole.get(seat)!.push(this.draw());
    for (const seat of this.order) this.emit({ type: 'HoleCardsDealt', seat, cards: this.holeCards(seat) });
  }

  private draw(): Card {
    const card = this.deck[this.deckAt++];
    if (!card) throw new Error('deck exhausted');
    return card;
  }

  // ---- betting flow ------------------------------------------------------

  /** Seats that are still able to put chips in. */
  private liveActors(): SeatId[] {
    return this.order.filter((s) => !this.folded.has(s) && !this.allIn.has(s));
  }

  private canOpenBetting(): boolean {
    const live = this.liveActors();
    if (live.length >= 2) return true;
    if (live.length === 1) return this.currentBet - (this.committed.get(live[0]!) ?? 0) > 0;
    return false;
  }

  /**
   * The next seat after `from` that still owes an action this street: one that has
   * not acted since the last full raise, or that has not matched the current bet.
   * `null` means the street is complete.
   */
  private nextToAct(from: SeatId): SeatId | null {
    const n = this.order.length;
    const start = this.order.indexOf(from);
    for (let i = 1; i <= n; i++) {
      const seat = this.order[(start + i + n) % n]!;
      if (this.folded.has(seat) || this.allIn.has(seat)) continue;
      if (!this.actedSinceRaise.has(seat) || (this.committed.get(seat) ?? 0) < this.currentBet) return seat;
    }
    return null;
  }

  private wager(seat: SeatId, delta: number): void {
    const stack = this.stacks.get(seat) ?? 0;
    const put = Math.min(Math.max(0, delta), stack);
    this.stacks.set(seat, stack - put);
    const committed = (this.committed.get(seat) ?? 0) + put;
    this.committed.set(seat, committed);
    this.contributed.set(seat, (this.contributed.get(seat) ?? 0) + put);
    if (stack - put === 0) this.allIn.add(seat);
    if (committed > this.currentBet) {
      const raiseSize = committed - this.currentBet;
      this.currentBet = committed;
      // A short all-in raise raises the bet but neither resets the raise size nor
      // reopens the action for players who have already acted this street.
      if (raiseSize >= Math.max(this.lastRaiseSize, this.blinds.big)) {
        this.lastRaiseSize = raiseSize;
        this.actedSinceRaise.clear();
      }
    }
  }

  /** The current street is complete: deal on, or run the board out to showdown. */
  private advance(): void {
    if (this.streetName !== 'river' && this.liveActors().length >= 2) {
      this.dealStreet();
      for (const seat of this.order) this.committed.set(seat, 0);
      this.currentBet = 0;
      this.lastRaiseSize = 0;
      this.actedSinceRaise.clear();
      const next = this.nextToAct(this.order[this.order.length - 1]!);
      if (next !== null) { this.actor = next; return; }
    }
    while (this.streetName !== 'river') this.dealStreet();
    this.showdown();
  }

  private dealStreet(): void {
    if (this.streetName === 'river' || this.streetName === 'showdown') throw new Error(`no street after the ${this.streetName}`);
    const count = this.streetName === 'preflop' ? 3 : 1;
    const next: Street = this.streetName === 'preflop' ? 'flop' : this.streetName === 'flop' ? 'turn' : 'river';
    for (let i = 0; i < count; i++) this.boardCards.push(this.draw());
    this.streetName = next;
    this.emit({ type: 'StreetDealt', street: next, board: this.board });
  }

  // ---- ending ------------------------------------------------------------

  private showdown(): void {
    const contenders = this.order.filter((s) => !this.folded.has(s));
    if (contenders.length <= 1) { this.endByFold(contenders[0] ?? this.order[0]!); return; }
    this.streetName = 'showdown';
    this.wentToShowdown = true;
    const values = new Map<SeatId, HandValue>();
    const hands = contenders.map((seat) => {
      const value = evaluate7([...(this.hole.get(seat) ?? []), ...this.boardCards]);
      values.set(seat, value);
      return { seat, cards: this.holeCards(seat), value };
    });
    this.emit({ type: 'Showdown', hands });
    const pots = buildPots(this.contributed, this.folded);
    const awards = awardPots(pots, (seat) => values.get(seat)?.score ?? -Infinity, this.order);
    for (const a of awards) {
      this.stacks.set(a.seat, (this.stacks.get(a.seat) ?? 0) + a.amount);
      this.emit({ type: 'PotAwarded', seat: a.seat, amount: a.amount, potIndex: a.potIndex });
    }
    this.finish();
  }

  private endByFold(winner: SeatId): void {
    this.streetName = 'showdown';
    this.wentToShowdown = false;
    let total = 0;
    for (const v of this.contributed.values()) total += v;
    this.stacks.set(winner, (this.stacks.get(winner) ?? 0) + total);
    this.emit({ type: 'PotAwarded', seat: winner, amount: total, potIndex: 0 });
    this.finish();
  }

  private finish(): void {
    this.over = true;
    this.actor = null;
    this.emit({ type: 'HandEnded', stacks: this.finalStacks() });
  }
}
