import { Hand } from './hand.js';
import { Rng, hashSeed, randomSeed } from './rng.js';
import type { GameConfig, PlayerView, Position, SeatId, TableEvent } from './types.js';

/**
 * Position labels for a seat given the current button and the seats dealt
 * into the hand. Heads-up is special-cased (button = BTN, other = BB); for
 * 3+ players the button, small blind and big blind are labelled first, and
 * any remaining seats (in table order after the big blind) are labelled
 * from `UTG`, `MP`, `CO` — the seat immediately before the button is `CO`
 * once there are enough seats (5+) to need it.
 */
export function positionOf(seat: SeatId, button: SeatId, activeSeats: SeatId[]): Position {
  const seats = [...activeSeats].sort((a, b) => a - b);
  const n = seats.length;
  if (n === 2) return seat === button ? 'BTN' : 'BB';

  const pivot = Math.max(0, seats.findIndex((s) => s > button));
  const order = [...seats.slice(pivot), ...seats.slice(0, pivot)]; // starts left of button, button last
  const idx = order.indexOf(seat);
  if (idx === n - 1) return 'BTN';
  if (idx === 0) return 'SB';
  if (idx === 1) return 'BB';

  const remaining = n - 3;
  const labels: Position[] =
    remaining === 1 ? ['UTG'] : remaining === 2 ? ['UTG', 'CO'] : ['UTG', 'MP', 'CO'];
  const label = labels[idx - 2];
  if (label === undefined) throw new Error(`positionOf: cannot label seat ${seat} at index ${idx} of ${n}`);
  return label;
}

/**
 * Owns the seats/stacks/button across many hands of `Hand`, applying
 * per-hand RNG seeding, button rotation and (for cash games) rebuys of
 * busted seats. Emits every `Hand` event plus its own `SeatRebought`.
 */
export class Table {
  private readonly config: GameConfig;
  private readonly seed: number;
  private readonly startedAt = Date.now();
  private readonly listeners = new Set<(e: TableEvent) => void>();
  private readonly seatStacks = new Map<SeatId, number>();

  private _handNumber = 0;
  private _button: SeatId;
  private hand: Hand | null = null;
  private dealtSeats: SeatId[] = [];

  constructor(config: GameConfig) {
    this.config = config;
    this.seed = config.seed ?? randomSeed();
    for (const s of config.seats) this.seatStacks.set(s.id, config.startingStack);

    const ids = [...config.seats.map((s) => s.id)].sort((a, b) => a - b);
    const firstButton = ids.find((id) => (this.seatStacks.get(id) ?? 0) > 0);
    if (firstButton === undefined) throw new Error('Table needs at least one seat with chips');
    this._button = firstButton;
  }

  get handNumber(): number { return this._handNumber; }
  get button(): SeatId { return this._button; }

  on(listener: (e: TableEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private readonly emit = (e: TableEvent): void => {
    for (const listener of this.listeners) listener(e);
  };

  stacks(): { seat: SeatId; stack: number }[] {
    return [...this.config.seats.map((s) => s.id)]
      .sort((a, b) => a - b)
      .map((seat) => ({ seat, stack: this.seatStacks.get(seat) ?? 0 }));
  }

  currentHand(): Hand | null { return this.hand; }

  startHand(): Hand {
    if (this.hand && !this.hand.isOver) throw new Error('cannot start a new hand: the current hand is not over');

    if (this.hand) {
      for (const { seat, stack } of this.hand.finalStacks()) this.seatStacks.set(seat, stack);
      if (this.config.format === 'cash') {
        for (const [seat, stack] of this.seatStacks) {
          if (stack === 0) {
            this.seatStacks.set(seat, this.config.startingStack);
            this.emit({ type: 'SeatRebought', seat, amount: this.config.startingStack });
          }
        }
      }
      this.rotateButton();
    }

    this._handNumber += 1;
    const seatsForHand = [...this.config.seats.map((s) => s.id)]
      .sort((a, b) => a - b)
      .filter((id) => (this.seatStacks.get(id) ?? 0) > 0)
      .map((id) => ({ seat: id, stack: this.seatStacks.get(id) ?? 0 }));
    this.dealtSeats = seatsForHand.map((s) => s.seat);

    const rng = new Rng(hashSeed(this.seed, this._handNumber));
    const blinds = this.config.blinds.blindsFor(this._handNumber, Date.now() - this.startedAt);
    this.hand = new Hand(
      { seats: seatsForHand, button: this._button, blinds, rng, handNumber: this._handNumber },
      this.emit,
    );
    return this.hand;
  }

  view(seat: SeatId): PlayerView {
    if (!this.hand) throw new Error('no hand in progress');
    return { ...this.hand.view(seat), position: positionOf(seat, this._button, this.dealtSeats) };
  }

  private rotateButton(): void {
    const ids = [...this.config.seats.map((s) => s.id)].sort((a, b) => a - b);
    const n = ids.length;
    const startIdx = ids.indexOf(this._button);
    for (let i = 1; i <= n; i++) {
      const candidate = ids[(startIdx + i) % n];
      if (candidate !== undefined && (this.seatStacks.get(candidate) ?? 0) > 0) {
        this._button = candidate;
        return;
      }
    }
    throw new Error('no seats with chips remain');
  }
}
