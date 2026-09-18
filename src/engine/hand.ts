import type { Card } from "./cards";
import { evaluateBest, type HandValue } from "./evaluator";
import { awardPots, buildPots } from "./pots";
import {
  type Action,
  type Blinds,
  type GameEvent,
  type HandSnapshot,
  type LegalActions,
  NO_ACTIONS,
  type SeatId,
  type SeatStack,
  type Street,
} from "./types";

export interface HandSeat {
  readonly seat: SeatId;
  readonly stack: number;
}

export interface HandOptions {
  readonly handNumber: number;
  readonly button: SeatId;
  /** Players in clockwise seat order, all with stack > 0. */
  readonly seats: readonly HandSeat[];
  readonly blinds: Blinds;
  /** A shuffled 52-card deck; cards are dealt from the front. */
  readonly deck: readonly Card[];
}

interface Player {
  readonly seat: SeatId;
  stack: number;
  readonly holeCards: readonly [Card, Card];
  contributed: number;
  streetBet: number;
  folded: boolean;
  allIn: boolean;
}

const NEXT_STREET: Record<Street, Street> = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
  river: "showdown",
  showdown: "showdown",
};

export class Hand {
  readonly handNumber: number;
  readonly button: SeatId;
  readonly bigBlind: number;
  readonly events: GameEvent[] = [];

  private readonly players: Player[];
  private readonly deck: Card[];
  private readonly board: Card[] = [];
  private currentStreet: Street = "preflop";
  private currentBet = 0;
  private minRaise: number;
  private toAct: SeatId[] = [];
  private acting: SeatId | null = null;
  private complete = false;
  /** Seats that may only call or fold this street because a short (incomplete) all-in
   *  raise came after their turn; a full raise clears this. */
  private cannotRaise = new Set<SeatId>();

  constructor(options: HandOptions) {
    if (options.seats.length < 2) throw new Error("a hand needs at least 2 players");
    if (options.deck.length !== 52) throw new Error("deck must have exactly 52 cards");
    if (!options.seats.some((s) => s.seat === options.button)) {
      throw new Error(`button seat ${options.button} is not in the hand`);
    }
    if (new Set(options.seats.map((s) => s.seat)).size !== options.seats.length) {
      throw new Error("seat ids must be unique");
    }
    for (const s of options.seats) {
      if (!Number.isInteger(s.stack) || s.stack <= 0)
        throw new Error(`seat ${s.seat} has no chips`);
    }
    this.handNumber = options.handNumber;
    this.button = options.button;
    this.bigBlind = options.blinds.big;
    this.minRaise = options.blinds.big;
    this.deck = [...options.deck];
    this.players = options.seats.map((s) => ({
      seat: s.seat,
      stack: s.stack,
      holeCards: [this.draw(), this.draw()],
      contributed: 0,
      streetBet: 0,
      folded: false,
      allIn: false,
    }));
    const bigBlindSeat = this.postBlinds(options.blinds);
    this.events.push({
      type: "HoleCardsDealt",
      hands: this.players.map((p) => ({ seat: p.seat, cards: p.holeCards })),
    });
    this.currentBet = options.blinds.big;
    this.toAct = this.rotateAfter(bigBlindSeat).filter((seat) => this.isLive(seat));
    const liveCount = this.players.filter((p) => this.isLive(p.seat)).length;
    if (liveCount < 2) {
      this.runOut();
    } else {
      this.advance();
    }
  }

  get isComplete(): boolean {
    return this.complete;
  }

  get actingSeat(): SeatId | null {
    return this.acting;
  }

  get street(): Street {
    return this.currentStreet;
  }

  legalActions(seat: SeatId): LegalActions {
    if (this.complete || seat !== this.acting) return NO_ACTIONS;
    const player = this.player(seat);
    const toCall = Math.max(0, this.currentBet - player.streetBet);
    const canCheck = toCall === 0;
    const maxRaiseTo = player.streetBet + player.stack;
    let minRaiseTo: number | null =
      this.currentBet === 0 ? this.bigBlind : this.currentBet + this.minRaise;
    if (this.cannotRaise.has(seat)) {
      minRaiseTo = null;
    } else if (player.stack <= toCall) {
      minRaiseTo = null;
    } else if (maxRaiseTo < minRaiseTo) {
      minRaiseTo = maxRaiseTo;
    }
    return {
      canFold: !canCheck,
      canCheck,
      callAmount: canCheck ? null : Math.min(toCall, player.stack),
      minRaiseTo,
      maxRaiseTo: minRaiseTo === null ? null : maxRaiseTo,
    };
  }

  act(seat: SeatId, action: Action): GameEvent[] {
    if (this.complete) throw new Error("hand is complete");
    if (seat !== this.acting) throw new Error(`seat ${seat} is not acting`);
    const legal = this.legalActions(seat);
    const player = this.player(seat);
    const before = this.events.length;
    let committed = 0;
    let normalized: Action = action;

    switch (action.type) {
      case "fold":
        if (!legal.canFold) throw new Error("cannot fold when checking is free");
        player.folded = true;
        break;
      case "check":
        if (!legal.canCheck) throw new Error("cannot check when facing a bet");
        break;
      case "call":
        if (legal.callAmount === null) throw new Error("nothing to call");
        committed = this.commit(player, legal.callAmount, true);
        break;
      case "bet":
      case "raise":
      case "allin": {
        if (action.type === "bet" && this.currentBet > 0)
          throw new Error("use raise when facing a bet");
        if (action.type === "raise" && this.currentBet === 0) {
          throw new Error("use bet when nobody has bet");
        }
        const target = action.type === "allin" ? player.streetBet + player.stack : action.amount;
        if (target <= this.currentBet) {
          if (action.type !== "allin") throw new Error(`illegal bet size ${target}`);
          // All in for less than a call: it is a call.
          committed = this.commit(player, player.stack, true);
          normalized = { type: "call" };
          break;
        }
        if (legal.minRaiseTo === null || legal.maxRaiseTo === null) {
          throw new Error("raising is not allowed");
        }
        const isAllIn = target === legal.maxRaiseTo;
        if (
          !Number.isInteger(target) ||
          target > legal.maxRaiseTo ||
          (target < legal.minRaiseTo && !isAllIn)
        ) {
          throw new Error(`illegal bet size ${target}`);
        }
        const kind = this.currentBet === 0 ? "bet" : "raise";
        committed = this.commit(player, target - player.streetBet, true);
        const increment = target - this.currentBet;
        if (increment >= this.minRaise) {
          this.minRaise = increment;
          this.cannotRaise.clear();
        } else {
          // Incomplete (short all-in) raise: it does not reopen the action. Seats
          // that already acted this street may only call or fold; seats still
          // waiting their turn keep their normal options.
          for (const other of this.players) {
            if (
              other.seat !== seat &&
              this.isLive(other.seat) &&
              !this.toAct.includes(other.seat)
            ) {
              this.cannotRaise.add(other.seat);
            }
          }
        }
        this.currentBet = target;
        this.toAct = this.rotateAfter(seat).filter((s) => s !== seat && this.isLive(s));
        normalized = { type: kind, amount: target };
        break;
      }
    }

    this.toAct = this.toAct.filter((s) => s !== seat);
    this.events.push({
      type: "ActionTaken",
      street: this.currentStreet,
      seat,
      action: normalized,
      amount: committed,
      allIn: player.allIn,
    });
    this.advance();
    return this.events.slice(before);
  }

  snapshot(): HandSnapshot {
    return {
      handNumber: this.handNumber,
      button: this.button,
      street: this.currentStreet,
      board: [...this.board],
      players: this.players.map((p) => ({
        seat: p.seat,
        stack: p.stack,
        holeCards: p.holeCards,
        contributed: p.contributed,
        streetBet: p.streetBet,
        folded: p.folded,
        allIn: p.allIn,
      })),
      actingSeat: this.acting,
      toAct: [...this.toAct],
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      bigBlind: this.bigBlind,
      pot: this.players.reduce((sum, p) => sum + p.contributed, 0),
      complete: this.complete,
    };
  }

  stacks(): SeatStack[] {
    return this.players.map((p) => ({ id: p.seat, stack: p.stack }));
  }

  private draw(): Card {
    const card = this.deck.shift();
    if (card === undefined) throw new Error("deck is empty");
    return card;
  }

  private player(seat: SeatId): Player {
    const player = this.players.find((p) => p.seat === seat);
    if (player === undefined) throw new Error(`seat ${seat} is not in this hand`);
    return player;
  }

  private isLive(seat: SeatId): boolean {
    const player = this.player(seat);
    return !player.folded && !player.allIn;
  }

  /** Seats clockwise starting after `seat`, ending with `seat` itself. */
  private rotateAfter(seat: SeatId): SeatId[] {
    const seats = this.players.map((p) => p.seat);
    const index = seats.indexOf(seat);
    if (index < 0) throw new Error(`seat ${seat} is not in this hand`);
    return [...seats.slice(index + 1), ...seats.slice(0, index + 1)];
  }

  /** Moves up to `chips` from the player's stack into the pot; returns the amount moved. */
  private commit(player: Player, chips: number, countsForStreet: boolean): number {
    const amount = Math.min(chips, player.stack);
    player.stack -= amount;
    player.contributed += amount;
    if (countsForStreet) player.streetBet += amount;
    if (player.stack === 0) player.allIn = true;
    return amount;
  }

  /** Posts antes and blinds; returns the big blind seat. */
  private postBlinds(blinds: Blinds): SeatId {
    const posts: { seat: SeatId; kind: "ante" | "small" | "big"; amount: number }[] = [];
    if (blinds.ante > 0) {
      for (const player of this.players) {
        posts.push({
          seat: player.seat,
          kind: "ante",
          amount: this.commit(player, blinds.ante, false),
        });
      }
    }
    const after = this.rotateAfter(this.button);
    const small = this.players.length === 2 ? this.button : (after[0] as SeatId);
    const big = this.players.length === 2 ? (after[0] as SeatId) : (after[1] as SeatId);
    posts.push({
      seat: small,
      kind: "small",
      amount: this.commit(this.player(small), blinds.small, true),
    });
    posts.push({ seat: big, kind: "big", amount: this.commit(this.player(big), blinds.big, true) });
    this.events.push({ type: "BlindsPosted", posts });
    return big;
  }

  private advance(): void {
    const unfolded = this.players.filter((p) => !p.folded);
    if (unfolded.length === 1) {
      this.payout(new Map());
      return;
    }
    if (this.toAct.length > 0) {
      this.acting = this.toAct[0] ?? null;
      return;
    }
    if (this.currentStreet === "river") {
      this.showdown();
      return;
    }
    this.dealNextStreet();
    const liveCount = this.players.filter((p) => this.isLive(p.seat)).length;
    if (liveCount < 2) {
      this.runOut();
      return;
    }
    this.acting = this.toAct[0] ?? null;
  }

  /** Deals every remaining street with no further betting, then goes to showdown. */
  private runOut(): void {
    while (this.currentStreet !== "river") this.dealNextStreet();
    this.showdown();
  }

  private dealNextStreet(): void {
    this.currentStreet = NEXT_STREET[this.currentStreet];
    for (const player of this.players) player.streetBet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.cannotRaise.clear();
    const count = this.currentStreet === "flop" ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.draw());
    this.toAct = this.rotateAfter(this.button).filter((seat) => this.isLive(seat));
    this.events.push({ type: "StreetDealt", street: this.currentStreet, board: [...this.board] });
  }

  private showdown(): void {
    this.currentStreet = "showdown";
    const unfolded = this.players.filter((p) => !p.folded);
    const values = new Map<SeatId, HandValue>();
    for (const player of unfolded) {
      values.set(player.seat, evaluateBest([...player.holeCards, ...this.board]));
    }
    this.events.push({
      type: "Showdown",
      hands: unfolded.map((p) => ({
        seat: p.seat,
        cards: p.holeCards,
        value: values.get(p.seat) as HandValue,
      })),
    });
    this.payout(values);
  }

  private payout(values: ReadonlyMap<SeatId, HandValue>): void {
    const contributions = new Map(this.players.map((p) => [p.seat, p.contributed]));
    const eligible = new Set(this.players.filter((p) => !p.folded).map((p) => p.seat));
    const pots = buildPots(contributions, eligible);
    const awards = awardPots(
      pots,
      (seat) => {
        const value = values.get(seat);
        if (value === undefined) throw new Error(`no showdown value for seat ${seat}`);
        return value;
      },
      this.rotateAfter(this.button),
    );
    for (const award of awards) this.player(award.seat).stack += award.amount;
    this.events.push({ type: "PotAwarded", pots, awards });
    this.complete = true;
    this.acting = null;
    this.toAct = [];
  }
}
