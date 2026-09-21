import { describe, expect, it } from "vitest";
import { fixedBlinds } from "./blinds";
import { Table } from "./table";
import type { GameConfig, GameEvent } from "./types";

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    format: "cash",
    blinds: fixedBlinds(5, 10),
    startingStack: 200,
    seats: [
      { id: 0, name: "A", kind: "cpu" },
      { id: 1, name: "B", kind: "cpu" },
      { id: 2, name: "C", kind: "human" },
    ],
    seed: 11,
    ...overrides,
  };
}

/** Everyone folds when facing a bet, otherwise checks. */
function playOut(table: Table): void {
  let guard = 0;
  while (table.currentHand !== null && !table.currentHand.isComplete) {
    const seat = table.currentHand.actingSeat;
    if (seat === null) throw new Error("no acting seat");
    const legal = table.legalActions(seat);
    table.act(seat, legal.canCheck ? { type: "check" } : { type: "fold" });
    if (++guard > 100) throw new Error("did not finish");
  }
}

/** Everyone shoves or calls; the pot always goes to showdown. */
function shoveOut(table: Table): void {
  let guard = 0;
  while (table.currentHand !== null && !table.currentHand.isComplete) {
    const seat = table.currentHand.actingSeat;
    if (seat === null) throw new Error("no acting seat");
    const legal = table.legalActions(seat);
    table.act(seat, legal.minRaiseTo === null ? { type: "call" } : { type: "allin" });
    if (++guard > 100) throw new Error("did not finish");
  }
}

describe("Table", () => {
  it("sorts seats and starts everyone with the starting stack", () => {
    const table = new Table(config({ seats: [...config().seats].reverse() }));
    expect(table.seats.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(table.seats.map((s) => s.stack)).toEqual([200, 200, 200]);
    expect(table.handNumber).toBe(0);
  });

  it("validates configuration", () => {
    expect(() => new Table(config({ seats: [{ id: 0, name: "A", kind: "cpu" }] }))).toThrow(
      /2 to 6/,
    );
    expect(
      () =>
        new Table(
          config({
            seats: [
              { id: 0, name: "A", kind: "cpu" },
              { id: 0, name: "B", kind: "cpu" },
            ],
          }),
        ),
    ).toThrow(/unique/);
    expect(() => new Table(config({ startingStack: 0 }))).toThrow(/starting stack/);
  });

  it("emits HandStarted first and HandEnded last, then moves the button clockwise", () => {
    const table = new Table(config());
    const events: GameEvent[] = [];
    table.on((e) => events.push(e));
    const buttons: number[] = [];
    for (let i = 0; i < 3; i++) {
      table.startHand();
      buttons.push(table.button);
      playOut(table);
    }
    expect(buttons[1]).toBe(((buttons[0] as number) + 1) % 3);
    expect(buttons[2]).toBe(((buttons[0] as number) + 2) % 3);
    expect(events[0]?.type).toBe("HandStarted");
    expect(events[events.length - 1]).toMatchObject({ type: "HandEnded", handNumber: 2 });
    expect(table.handNumber).toBe(3);
    expect(events.filter((e) => e.type === "HandStarted")).toHaveLength(3);
  });

  it("refuses to start a hand while one is in progress", () => {
    const table = new Table(config());
    table.startHand();
    expect(() => table.startHand()).toThrow(/in progress/);
    expect(() => table.act(99, { type: "fold" })).toThrow(/not acting|not in this hand/);
  });

  it("is reproducible for the same seed", () => {
    const a = new Table(config({ seed: 5 }));
    const b = new Table(config({ seed: 5 }));
    const dealtA: GameEvent[] = [];
    const dealtB: GameEvent[] = [];
    a.on((e) => e.type === "HoleCardsDealt" && dealtA.push(e));
    b.on((e) => e.type === "HoleCardsDealt" && dealtB.push(e));
    a.startHand();
    b.startHand();
    expect(dealtA).toEqual(dealtB);
    expect(a.button).toBe(b.button);
  });

  it("rebuys busted seats in a cash game", () => {
    const table = new Table(
      config({
        seats: [
          { id: 0, name: "A", kind: "cpu" },
          { id: 1, name: "B", kind: "cpu" },
        ],
        startingStack: 50,
      }),
    );
    const rebuys: GameEvent[] = [];
    table.on((e) => e.type === "SeatRebought" && rebuys.push(e));
    for (let i = 0; i < 50 && rebuys.length === 0; i++) {
      table.startHand();
      shoveOut(table);
    }
    expect(rebuys.length).toBeGreaterThan(0);
    expect(rebuys[0]).toMatchObject({ type: "SeatRebought", amount: 50 });
    expect(table.seats.every((s) => s.stack > 0)).toBe(true);
  });

  it("does not rebuy in a tournament and ends when one player remains", () => {
    const table = new Table(
      config({
        format: "tournament",
        seats: [
          { id: 0, name: "A", kind: "cpu" },
          { id: 1, name: "B", kind: "cpu" },
        ],
        startingStack: 50,
      }),
    );
    const rebuys: GameEvent[] = [];
    table.on((e) => e.type === "SeatRebought" && rebuys.push(e));
    for (let i = 0; i < 50 && table.seats.every((s) => s.stack > 0); i++) {
      table.startHand();
      shoveOut(table);
    }
    expect(rebuys).toHaveLength(0);
    expect(table.seats.some((s) => s.stack === 0)).toBe(true);
    expect(() => table.startHand()).toThrow(/game over/);
  });

  it("uses the blind schedule with hand number and elapsed time", () => {
    const calls: [number, number][] = [];
    let clock = 1000;
    const table = new Table(
      config({
        blinds: {
          blindsFor(handNumber, elapsedMs) {
            calls.push([handNumber, elapsedMs]);
            return { small: 5, big: 10, ante: 0 };
          },
        },
      }),
      { now: () => clock },
    );
    table.startHand();
    playOut(table);
    clock += 60_000;
    table.startHand();
    expect(calls).toEqual([
      [0, 0],
      [1, 60_000],
    ]);
  });
});
