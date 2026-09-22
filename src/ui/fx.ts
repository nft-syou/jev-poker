import type { GameEvent, SeatId, Street } from "@jev-poker/engine";

/** The shout that flashes at a seat the moment it acts. */
export type CalloutKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";

export interface Callout {
  /** Monotonic, so the same seat shouting twice in a row still counts as two callouts. */
  readonly id: number;
  readonly seat: SeatId;
  readonly kind: CalloutKind;
  /** Chips called, or the total bet/raise. Zero where the callout carries no number. */
  readonly amount: number;
  readonly at: number;
}

/** Where a handful of chips is travelling: out to a bet, into the pot, or home to a winner. */
export type ChipMoveKind = "toBet" | "toPot" | "toSeat";

export interface ChipMove {
  readonly id: number;
  readonly seat: SeatId;
  readonly kind: ChipMoveKind;
  readonly amount: number;
  readonly at: number;
}

export type FeedEntry =
  | {
      readonly id: number;
      readonly type: "action";
      readonly seat: SeatId;
      readonly kind: CalloutKind;
      readonly amount: number;
      readonly at: number;
    }
  | { readonly id: number; readonly type: "street"; readonly street: Street; readonly at: number };

/**
 * Everything the table shows that is an *event* rather than a *state*: the shouts, the chips
 * in flight, who just won. It is derived from the engine's events and nothing else, and it
 * is built by a pure function — every timestamp is stamped by the caller, so the reducer
 * that owns this slice never reads the clock.
 *
 * Entries are never removed on a timer. They are capped by count and expire visually, by a
 * CSS animation that ends where it started; that keeps a table running at max speed from
 * needing a React re-render per effect just to make one disappear.
 */
export interface TableFx {
  /** Next id to hand out. Part of the state so `reduceFx` stays a pure function of it. */
  readonly nextId: number;
  readonly callouts: readonly Callout[];
  readonly chipMoves: readonly ChipMove[];
  /** Seats that took a share of the last pot. */
  readonly winners: readonly SeatId[];
  /** When they won it, which is what restarts their glow. */
  readonly winnersAt: number;
  /**
   * True from the moment the pot starts flying to its winners until the next hand begins.
   * The engine leaves `contributed` — and so the snapshot's pot — standing until then, but
   * as far as the felt is concerned the middle is empty the instant it has been paid.
   */
  readonly potPaid: boolean;
  /** When hole cards were last revealed, which is what restarts the card flip. */
  readonly flipAt: number;
  readonly feed: readonly FeedEntry[];
  /** When each of the last few hands ended, for the hands/minute readout. */
  readonly handTimes: readonly number[];
  /** Chips currently in front of each seat, so a new street knows what to sweep in. */
  readonly streetBets: Readonly<Record<SeatId, number>>;
}

/** At most one callout per seat is ever visible; the rest are kept only so keys stay stable. */
const MAX_CALLOUTS = 12;
/** Simultaneous flying chips. Past this the felt is noise, and so is the compositor's job. */
export const MAX_CHIP_MOVES = 12;
/** Feed entries kept; the strip itself shows fewer. */
const MAX_FEED = 24;
/** Hand timestamps kept, which is the window the hands/minute figure is measured over. */
const MAX_HAND_TIMES = 24;

export const EMPTY_FX: TableFx = {
  nextId: 1,
  callouts: [],
  chipMoves: [],
  winners: [],
  winnersAt: 0,
  potPaid: false,
  flipAt: 0,
  feed: [],
  handTimes: [],
  streetBets: {},
};

/** The last `max` entries of a list, as a new array. */
function tail<T>(list: readonly T[], extra: readonly T[], max: number): T[] {
  const all = extra.length === 0 ? [...list] : [...list, ...extra];
  return all.length > max ? all.slice(all.length - max) : all;
}

/** What a seat just did, as one of the six things the table shouts about. */
function calloutKind(action: GameEvent & { type: "ActionTaken" }): CalloutKind {
  if (action.allIn) return "allin";
  switch (action.action.type) {
    case "fold":
      return "fold";
    case "check":
      return "check";
    case "call":
      return "call";
    case "bet":
      return "bet";
    case "raise":
      return "raise";
    case "allin":
      return "allin";
  }
}

/**
 * Folds one engine event into the effects layer. Pure: `at` is the clock reading the caller
 * took when the event arrived, and nothing in here reads a clock or a random number.
 */
export function reduceFx(fx: TableFx, event: GameEvent, at: number): TableFx {
  let nextId = fx.nextId;
  const id = () => nextId++;
  /** The chips sitting in front of the seats, on their way into the middle. */
  const sweep = (): ChipMove[] =>
    Object.entries(fx.streetBets)
      .filter(([, amount]) => amount > 0)
      .map(([seat, amount]) => ({
        id: id(),
        seat: Number(seat),
        kind: "toPot" as const,
        amount,
        at,
      }));

  switch (event.type) {
    case "HandStarted":
      return {
        ...fx,
        nextId: nextId + 1,
        streetBets: {},
        potPaid: false,
        feed: tail(fx.feed, [{ id: nextId, type: "street", street: "preflop", at }], MAX_FEED),
      };

    case "BlindsPosted": {
      const posts = event.posts.filter((post) => post.amount > 0);
      if (posts.length === 0) return fx;
      const streetBets = { ...fx.streetBets };
      const moves = posts.map((post) => {
        // Antes go to the middle directly; blinds sit in front of the seat that posted them.
        const toPot = post.kind === "ante";
        if (!toPot) streetBets[post.seat] = (streetBets[post.seat] ?? 0) + post.amount;
        return {
          id: id(),
          seat: post.seat,
          kind: toPot ? ("toPot" as const) : ("toBet" as const),
          amount: post.amount,
          at,
        };
      });
      return {
        ...fx,
        nextId,
        streetBets,
        chipMoves: tail(fx.chipMoves, moves, MAX_CHIP_MOVES),
      };
    }

    case "ActionTaken": {
      const kind = calloutKind(event);
      const total = event.action.type === "bet" || event.action.type === "raise";
      const amount = total ? event.action.amount : event.amount;
      const callout: Callout = { id: id(), seat: event.seat, kind, amount, at };
      const feed: FeedEntry = {
        id: id(),
        type: "action",
        seat: event.seat,
        kind,
        amount,
        at,
      };
      const moved = event.amount > 0;
      const streetBets = moved
        ? { ...fx.streetBets, [event.seat]: (fx.streetBets[event.seat] ?? 0) + event.amount }
        : fx.streetBets;
      const moves: ChipMove[] = moved
        ? [{ id: id(), seat: event.seat, kind: "toBet", amount: event.amount, at }]
        : [];
      return {
        ...fx,
        nextId,
        streetBets,
        callouts: tail(fx.callouts, [callout], MAX_CALLOUTS),
        chipMoves: tail(fx.chipMoves, moves, MAX_CHIP_MOVES),
        feed: tail(fx.feed, [feed], MAX_FEED),
      };
    }

    case "StreetDealt": {
      const moves = sweep();
      const separator: FeedEntry = { id: id(), type: "street", street: event.street, at };
      return {
        ...fx,
        nextId,
        streetBets: {},
        chipMoves: tail(fx.chipMoves, moves, MAX_CHIP_MOVES),
        feed: tail(fx.feed, [separator], MAX_FEED),
      };
    }

    case "Showdown":
      return { ...fx, flipAt: at };

    case "PotAwarded": {
      // Whatever was still in front of the seats goes in first, then the middle pays out.
      const moves = [
        ...sweep(),
        ...event.awards
          .filter((award) => award.amount > 0)
          .map((award) => ({
            id: id(),
            seat: award.seat,
            kind: "toSeat" as const,
            amount: award.amount,
            at,
          })),
      ];
      const winners = [...new Set(event.awards.filter((a) => a.amount > 0).map((a) => a.seat))];
      return {
        ...fx,
        nextId,
        streetBets: {},
        potPaid: true,
        chipMoves: tail(fx.chipMoves, moves, MAX_CHIP_MOVES),
        winners: winners.length === 0 ? fx.winners : winners,
        winnersAt: winners.length === 0 ? fx.winnersAt : at,
      };
    }

    case "HandEnded":
      return { ...fx, streetBets: {}, handTimes: tail(fx.handTimes, [at], MAX_HAND_TIMES) };

    default:
      return fx;
  }
}

/** Hands per minute over the window `handTimes` covers, or null before there are two. */
export function handsPerMinute(handTimes: readonly number[]): number | null {
  if (handTimes.length < 2) return null;
  const first = handTimes[0] ?? 0;
  const last = handTimes[handTimes.length - 1] ?? 0;
  const span = last - first;
  if (span <= 0) return null;
  return Math.round(((handTimes.length - 1) / span) * 60_000);
}
