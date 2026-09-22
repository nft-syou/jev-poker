import { createDeck } from "./cards.js";
import { Hand } from "./hand.js";
import { createRng, type Rng, randomSeed, shuffle } from "./rng.js";
import {
  type Action,
  type GameConfig,
  type GameEvent,
  type HandSnapshot,
  type LegalActions,
  NO_ACTIONS,
  type SeatId,
  type SeatKind,
} from "./types.js";

export interface TableSeat {
  readonly id: SeatId;
  readonly name: string;
  readonly kind: SeatKind;
  readonly personaId?: string;
  stack: number;
}

export type EventListener = (event: GameEvent) => void;

export interface TableOptions {
  /** Clock used for blind schedules; defaults to Date.now. */
  now?: () => number;
}

export class Table {
  readonly config: GameConfig;
  readonly seats: TableSeat[];
  /** Number of completed hands; also the next hand's number. */
  handNumber = 0;
  button: SeatId;

  private hand: Hand | null = null;
  private readonly rng: Rng;
  private readonly listeners = new Set<EventListener>();
  private readonly now: () => number;
  private readonly startedAt: number;

  constructor(config: GameConfig, options: TableOptions = {}) {
    if (config.seats.length < 2 || config.seats.length > 6) {
      throw new Error("a table needs 2 to 6 seats");
    }
    if (new Set(config.seats.map((s) => s.id)).size !== config.seats.length) {
      throw new Error("seat ids must be unique");
    }
    if (!Number.isInteger(config.startingStack) || config.startingStack <= 0) {
      throw new Error("starting stack must be a positive integer");
    }
    this.config = config;
    this.seats = [...config.seats]
      .sort((a, b) => a.id - b.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        personaId: s.personaId,
        stack: config.startingStack,
      }));
    this.rng = createRng(config.seed ?? randomSeed());
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
    const first = this.seats[Math.floor(this.rng.next() * this.seats.length)] as TableSeat;
    this.button = first.id;
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get currentHand(): Hand | null {
    return this.hand;
  }

  snapshot(): HandSnapshot | null {
    return this.hand?.snapshot() ?? null;
  }

  legalActions(seat: SeatId): LegalActions {
    return this.hand?.legalActions(seat) ?? NO_ACTIONS;
  }

  startHand(): HandSnapshot {
    if (this.hand !== null && !this.hand.isComplete)
      throw new Error("a hand is already in progress");
    const playing = this.seats.filter((s) => s.stack > 0);
    if (playing.length < 2) throw new Error("game over: fewer than 2 seats have chips");
    if (this.handNumber > 0) this.button = this.nextButton(playing);
    const blinds = this.config.blinds.blindsFor(this.handNumber, this.now() - this.startedAt);
    const hand = new Hand({
      handNumber: this.handNumber,
      button: this.button,
      seats: playing.map((s) => ({ seat: s.id, stack: s.stack })),
      blinds,
      deck: shuffle(createDeck(), this.rng),
    });
    this.hand = hand;
    this.emit({
      type: "HandStarted",
      handNumber: this.handNumber,
      button: this.button,
      blinds,
      seats: playing.map((s) => ({ id: s.id, stack: s.stack })),
    });
    for (const event of hand.events) this.emit(event);
    if (hand.isComplete) this.finishHand(hand);
    return hand.snapshot();
  }

  act(seat: SeatId, action: Action): GameEvent[] {
    const hand = this.hand;
    if (hand === null || hand.isComplete) throw new Error("no hand in progress");
    const events = hand.act(seat, action);
    for (const event of events) this.emit(event);
    if (hand.isComplete) this.finishHand(hand);
    return events;
  }

  private nextButton(playing: readonly TableSeat[]): SeatId {
    const ids = playing.map((s) => s.id);
    return ids.find((id) => id > this.button) ?? (ids[0] as SeatId);
  }

  private finishHand(hand: Hand): void {
    for (const { id, stack } of hand.stacks()) {
      const seat = this.seats.find((s) => s.id === id);
      if (seat !== undefined) seat.stack = stack;
    }
    if (this.config.format === "cash") {
      for (const seat of this.seats) {
        if (seat.stack === 0) {
          seat.stack = this.config.startingStack;
          this.emit({ type: "SeatRebought", seat: seat.id, amount: seat.stack });
        }
      }
    }
    this.emit({
      type: "HandEnded",
      handNumber: this.handNumber,
      stacks: this.seats.map((s) => ({ id: s.id, stack: s.stack })),
    });
    this.handNumber++;
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
