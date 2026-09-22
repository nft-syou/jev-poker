import type { Action, Card, GameEvent } from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import { EMPTY_FX, handsPerMinute, MAX_CHIP_MOVES, reduceFx, type TableFx } from "./fx";

const CARD: Card = { rank: 14, suit: "s" };

function play(events: readonly (readonly [GameEvent, number])[], from: TableFx = EMPTY_FX) {
  return events.reduce((fx, [event, at]) => reduceFx(fx, event, at), from);
}

/** One `ActionTaken` the way the engine emits it: `amount` moved, `total` bet to. */
function took(
  seat: number,
  type: Action["type"] & ("fold" | "check" | "call" | "bet" | "raise"),
  amount: number,
  total = amount,
  allIn = false,
): GameEvent {
  const action: Action =
    type === "bet"
      ? { type, amount: total }
      : type === "raise"
        ? { type, amount: total }
        : { type };
  return { type: "ActionTaken", street: "preflop", seat, action, amount, allIn };
}

describe("reduceFx", () => {
  it("shouts what a seat did and slides its chips out to the bet spot", () => {
    const fx = play([[took(1, "raise", 10, 12), 100]]);
    expect(fx.callouts).toHaveLength(1);
    expect(fx.callouts[0]).toMatchObject({ seat: 1, kind: "raise", amount: 12, at: 100 });
    // The callout carries the total raised to; the chips carry what actually moved.
    expect(fx.chipMoves).toHaveLength(1);
    expect(fx.chipMoves[0]).toMatchObject({ seat: 1, kind: "toBet", amount: 10 });
    expect(fx.streetBets).toEqual({ 1: 10 });
  });

  it("shouts ALL IN over whatever the action was called", () => {
    const fx = play([[took(2, "call", 80, 80, true), 5]]);
    expect(fx.callouts[0]?.kind).toBe("allin");
  });

  it("says nothing about chips for a fold or a check", () => {
    const fx = play([
      [took(0, "fold", 0), 1],
      [took(1, "check", 0), 2],
    ]);
    expect(fx.chipMoves).toEqual([]);
    expect(fx.callouts.map((c) => c.kind)).toEqual(["fold", "check"]);
  });

  it("puts blinds in front of their seats and antes straight in the middle", () => {
    const fx = play([
      [
        {
          type: "BlindsPosted",
          posts: [
            { seat: 0, kind: "small", amount: 1 },
            { seat: 1, kind: "big", amount: 2 },
            { seat: 2, kind: "ante", amount: 1 },
          ],
        },
        7,
      ],
    ]);
    expect(fx.chipMoves.map((m) => m.kind)).toEqual(["toBet", "toBet", "toPot"]);
    expect(fx.streetBets).toEqual({ 0: 1, 1: 2 });
  });

  it("sweeps the bets into the pot on a new street and marks the separator", () => {
    const fx = play([
      [took(0, "bet", 6, 6), 1],
      [took(1, "call", 6), 2],
      [{ type: "StreetDealt", street: "flop", board: [CARD, CARD, CARD] }, 3],
    ]);
    const swept = fx.chipMoves.filter((m) => m.kind === "toPot");
    expect(swept.map((m) => m.seat).sort()).toEqual([0, 1]);
    expect(swept.every((m) => m.amount === 6)).toBe(true);
    expect(fx.streetBets).toEqual({});
    expect(fx.feed.at(-1)).toMatchObject({ type: "street", street: "flop" });
  });

  it("flies the pot to every winner and remembers when they won", () => {
    const fx = play([
      [took(0, "bet", 6, 6), 1],
      [
        {
          type: "PotAwarded",
          pots: [{ amount: 12, eligible: [0, 1] }],
          awards: [
            { seat: 0, amount: 6, potIndex: 0 },
            { seat: 1, amount: 6, potIndex: 0 },
          ],
        },
        42,
      ],
    ]);
    // The seat's own bet is swept in first, then both shares fly home.
    expect(fx.chipMoves.filter((m) => m.kind === "toPot")).toHaveLength(1);
    expect(fx.chipMoves.filter((m) => m.kind === "toSeat").map((m) => m.seat)).toEqual([0, 1]);
    expect(fx.winners).toEqual([0, 1]);
    expect(fx.winnersAt).toBe(42);
    expect(fx.streetBets).toEqual({});
  });

  it("calls the pot paid the moment it starts flying, and only until the next hand", () => {
    expect(EMPTY_FX.potPaid).toBe(false);
    const paid = play([
      [took(0, "bet", 6, 6), 1],
      [
        {
          type: "PotAwarded",
          pots: [{ amount: 6, eligible: [0] }],
          awards: [{ seat: 0, amount: 6, potIndex: 0 }],
        },
        2,
      ],
    ]);
    // The engine keeps the snapshot's pot standing until the next hand; the felt must not.
    expect(paid.potPaid).toBe(true);

    // It survives the end of the hand, which is the whole between-hands gap.
    const ended = reduceFx(paid, { type: "HandEnded", handNumber: 0, stacks: [] }, 3);
    expect(ended.potPaid).toBe(true);

    const next = reduceFx(
      ended,
      {
        type: "HandStarted",
        handNumber: 1,
        button: 0,
        blinds: { small: 1, big: 2, ante: 0 },
        seats: [],
      },
      4,
    );
    expect(next.potPaid).toBe(false);
  });

  it("restarts the card flip on every showdown", () => {
    expect(EMPTY_FX.flipAt).toBe(0);
    const fx = play([[{ type: "Showdown", hands: [] }, 77]]);
    expect(fx.flipAt).toBe(77);
  });

  it("resets the bets in front of the seats when a hand starts", () => {
    const started = play(
      [
        [
          {
            type: "HandStarted",
            handNumber: 1,
            button: 0,
            blinds: { small: 1, big: 2, ante: 0 },
            seats: [],
          },
          9,
        ],
      ],
      { ...EMPTY_FX, streetBets: { 0: 40 } },
    );
    expect(started.streetBets).toEqual({});
    expect(started.feed.at(-1)).toMatchObject({ type: "street", street: "preflop" });
  });

  it("caps the chips in flight so the felt never floods", () => {
    const many: [GameEvent, number][] = [];
    for (let i = 0; i < MAX_CHIP_MOVES * 3; i++) many.push([took(i % 3, "call", 2), i]);
    const fx = play(many);
    expect(fx.chipMoves).toHaveLength(MAX_CHIP_MOVES);
    // What survives is the newest, not the oldest.
    expect(fx.chipMoves[MAX_CHIP_MOVES - 1]?.at).toBe(MAX_CHIP_MOVES * 3 - 1);
  });

  it("hands out a fresh id to every effect it makes", () => {
    const fx = play([
      [took(0, "bet", 6, 6), 1],
      [took(1, "call", 6), 2],
      [took(2, "raise", 20, 20), 3],
    ]);
    const ids = [...fx.callouts, ...fx.chipMoves, ...fx.feed].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fx.nextId).toBeGreaterThan(Math.max(...ids));
  });

  it("leaves itself alone for an event it has nothing to show for", () => {
    const fx = reduceFx(EMPTY_FX, { type: "HoleCardsDealt", hands: [] }, 1);
    expect(fx).toBe(EMPTY_FX);
  });

  it("logs when each hand ended", () => {
    const fx = play([
      [{ type: "HandEnded", handNumber: 0, stacks: [] }, 1000],
      [{ type: "HandEnded", handNumber: 1, stacks: [] }, 3000],
    ]);
    expect(fx.handTimes).toEqual([1000, 3000]);
  });

  it("never reads a clock of its own", () => {
    const first = reduceFx(EMPTY_FX, took(1, "bet", 4, 4), 123);
    const second = reduceFx(EMPTY_FX, took(1, "bet", 4, 4), 123);
    expect(first).toEqual(second);
  });
});

describe("handsPerMinute", () => {
  it("needs two hands before it can say anything", () => {
    expect(handsPerMinute([])).toBeNull();
    expect(handsPerMinute([1000])).toBeNull();
    expect(handsPerMinute([1000, 1000])).toBeNull();
  });

  it("measures the rate across the window it was given", () => {
    // Two gaps of 1 second each: 60 hands a minute.
    expect(handsPerMinute([0, 1000, 2000])).toBe(60);
    expect(handsPerMinute([0, 60_000])).toBe(1);
  });

  it("leaves a pause out of the rate", () => {
    // Three quick hands, a ten-minute break, two more: still 60 a minute, not 0.4.
    expect(handsPerMinute([0, 1000, 2000, 602_000, 603_000])).toBe(60);
    // A single gap that could only have been a pause says nothing about the rate.
    expect(handsPerMinute([0, 600_000])).toBeNull();
  });
});
