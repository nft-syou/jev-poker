import { fixedBlinds, type GameEvent, Table } from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import { CallerAgent } from "./agents/caller.js";
import { RulesAgent } from "./agents/rules.js";
import { playHand } from "./play.js";

function table(seats: number, seed = 1): Table {
  return new Table({
    format: "cash",
    blinds: fixedBlinds(1, 2),
    startingStack: 200,
    seats: Array.from({ length: seats }, (_, id) => ({
      id,
      name: `seat${id}`,
      kind: "cpu" as const,
    })),
    seed,
  });
}

describe("playHand", () => {
  it("plays a hand to completion and returns the final snapshot", async () => {
    const t = table(3);
    const events: GameEvent[] = [];
    const snapshot = await playHand(t, [new RulesAgent(), new CallerAgent(), new RulesAgent()], {
      onEvent: (e) => events.push(e),
    });
    expect(snapshot.complete).toBe(true);
    expect(events.some((e) => e.type === "ActionTaken")).toBe(true);
    expect(events.at(-1)?.type === "HandEnded" || events.some((e) => e.type === "Showdown")).toBe(
      true,
    );
    // Chips are conserved: once the hand is complete every pot has been paid into a
    // `stack`, so `contributed` (a historical record that is never cleared on award)
    // must not be added on top of it or the awarded chips are double-counted.
    const total = snapshot.players.reduce((sum, p) => sum + p.stack, 0);
    expect(total).toBe(600);
  });

  it("can play several hands on the same table", async () => {
    const t = table(2);
    const agents = [new CallerAgent(), new CallerAgent()];
    const first = await playHand(t, agents);
    const second = await playHand(t, agents);
    expect(first.complete && second.complete).toBe(true);
    expect(t.handNumber).toBe(2);
  });

  it("throws when a seat has no agent", async () => {
    await expect(playHand(table(3), [new CallerAgent(), new CallerAgent()])).rejects.toThrow(
      /no agent for seat 2/,
    );
  });

  it("rejects with AbortError once the signal is aborted", async () => {
    const controller = new AbortController();
    const blocking = {
      id: "blocking",
      decide: () => new Promise<never>(() => {}),
    };
    const promise = playHand(table(2), [blocking, blocking], { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
