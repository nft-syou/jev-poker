import { type ActionLabel, type AgentDecision, createMockBackend } from "@jev-poker/agent";
import { formatCard, type GameEvent } from "@jev-poker/engine";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { JevBackend } from "../src/jev/backend";
import { getPersona } from "./backend";
import { expandMatchups, rotations, seatCount } from "./matchups";
import { playHand, runMatch } from "./runner";
import type { Format, HandRecord } from "./types";

const persona = getPersona("tag");

/** A backend that always answers the same label (the other labels get a vanishing probability). */
function stubBackend(label: ActionLabel, sizing = 2): JevBackend & { calls: number } {
  const backend = {
    kind: "mock" as const,
    calls: 0,
    async systemOne<const Q extends Questions>(_request: SystemOneRequest<Q>) {
      backend.calls += 1;
      const probabilities = { fold: 1e-9, check_or_call: 1e-9, bet_or_raise: 1e-9, [label]: 1 };
      return {
        model: "stub",
        answers: {
          action: { type: "choice", choice: label, confidence: 1, probabilities },
          sizing: {
            type: "score",
            score: sizing,
            confidence: 1,
            legend: {},
            probabilities: { [String(sizing)]: 1 },
          },
          bluff_intent: { type: "noul", noul: 0 },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
  return backend;
}

/** A backend whose every request fails, so every Jev decision fails open. */
function brokenBackend(): JevBackend & { calls: number } {
  const backend = {
    kind: "mock" as const,
    calls: 0,
    async systemOne<const Q extends Questions>(
      _request: SystemOneRequest<Q>,
    ): Promise<SystemOneResult<Q>> {
      backend.calls += 1;
      throw new Error("backend down");
    },
  };
  return backend;
}

const sum = (xs: readonly number[]): number => xs.reduce((x, y) => x + y, 0);

/** What a hand dealt, as seen through the `onEvent` seam. */
function dealRecorder(): {
  onEvent: (e: GameEvent) => void;
  hole: [number, string][];
  board: () => string[];
  button: () => number | null;
} {
  const hole: [number, string][] = [];
  let board: string[] = [];
  let button: number | null = null;
  return {
    hole,
    board: () => board,
    button: () => button,
    onEvent: (e) => {
      if (e.type === "HandStarted") button = e.button;
      if (e.type === "HoleCardsDealt") {
        for (const h of e.hands) hole.push([h.seat, h.cards.map(formatCard).join(" ")]);
      }
      if (e.type === "StreetDealt") board = e.board.map(formatCard);
    },
  };
}

/**
 * The button of a `(baseSeed, seedIndex)` deal. The table draws it from the hand's seed, so it
 * is the same for every rotation; the fixed hero keeps the probe off the backend.
 */
async function buttonOf(seedIndex: number, baseSeed: number, format: Format): Promise<number> {
  const deal = dealRecorder();
  await playHand({
    seedIndex,
    rotation: 0,
    opponent: "caller",
    format,
    baseSeed,
    persona,
    backend: brokenBackend(),
    hero: "heuristic",
    onEvent: deal.onEvent,
  });
  const button = deal.button();
  if (button === null) throw new Error("no HandStarted event seen");
  return button;
}

describe("expandMatchups", () => {
  it("all × all = 6", () => expect(expandMatchups("all", "all")).toHaveLength(6));
  it("single", () =>
    expect(expandMatchups("rules", "hu")).toEqual([{ opponent: "rules", format: "hu" }]));
  it("is opponent-major", () =>
    expect(expandMatchups("all", "all")).toEqual([
      { opponent: "random", format: "hu" },
      { opponent: "random", format: "6max" },
      { opponent: "caller", format: "hu" },
      { opponent: "caller", format: "6max" },
      { opponent: "rules", format: "hu" },
      { opponent: "rules", format: "6max" },
    ]));
  it("seat and rotation counts", () => {
    expect(seatCount("hu")).toBe(2);
    expect(seatCount("6max")).toBe(6);
    expect(rotations("hu")).toBe(2);
    expect(rotations("6max")).toBe(6);
  });
});

describe("playHand", () => {
  it("is zero-sum and deals the same deck across rotations", async () => {
    const run = async (rotation: number) => {
      const deal = dealRecorder();
      const r = await playHand({
        seedIndex: 3,
        rotation,
        opponent: "caller",
        format: "hu",
        baseSeed: 1,
        persona,
        backend: createMockBackend(),
        onEvent: deal.onEvent,
      });
      return { r, deal };
    };
    const a = await run(0);
    const b = await run(1);
    expect(sum(a.r.net)).toBeCloseTo(0);
    expect(a.r.jevSeat).toBe(0);
    expect(b.r.jevSeat).toBe(1);
    expect(a.r.decisions.length).toBeGreaterThan(0);
    expect(b.r.decisions.length).toBeGreaterThan(0);
    expect(sum(b.r.net)).toBeCloseTo(0);
    // Same deal, Jev in the other seat: every seat holds the same two cards.
    expect(a.deal.hole).toHaveLength(2);
    expect(new Set(a.deal.hole.flatMap(([, cards]) => cards.split(" "))).size).toBe(4);
    expect(b.deal.hole).toEqual(a.deal.hole);
  });

  it("mirrors the whole deal, board included, across every rotation of one seedIndex", async () => {
    // A hero that always calls against callers: every rotation runs to the river.
    const deals = [];
    for (let rotation = 0; rotation < 6; rotation++) {
      const deal = dealRecorder();
      const r = await playHand({
        seedIndex: 2,
        rotation,
        opponent: "caller",
        format: "6max",
        baseSeed: 8,
        persona,
        backend: stubBackend("check_or_call"),
        onEvent: deal.onEvent,
      });
      expect(r.jevSeat).toBe(rotation);
      expect(r.wentToShowdown).toBe(true);
      expect(sum(r.net)).toBeCloseTo(0);
      deals.push({ button: deal.button(), hole: deal.hole, board: deal.board() });
    }
    expect(deals[0]?.hole).toHaveLength(6);
    expect(deals[0]?.board).toHaveLength(5);
    for (const d of deals) expect(d).toEqual(deals[0]);
    // A different seedIndex is a different deal.
    const other = dealRecorder();
    await playHand({
      seedIndex: 3,
      rotation: 0,
      opponent: "caller",
      format: "6max",
      baseSeed: 8,
      persona,
      backend: stubBackend("check_or_call"),
      onEvent: other.onEvent,
    });
    expect(other.hole).not.toEqual(deals[0]?.hole);
  });

  it("6-max has 6 seats", async () => {
    const r = await playHand({
      seedIndex: 0,
      rotation: 5,
      opponent: "random",
      format: "6max",
      baseSeed: 1,
      persona,
      backend: createMockBackend(),
    });
    expect(r.net).toHaveLength(6);
    expect(r.jevSeat).toBe(5);
    expect(sum(r.net)).toBeCloseTo(0);
  });

  it("keeps chips zero-sum over a whole 6-max cycle", async () => {
    const m = await runMatch({
      opponent: "rules",
      format: "6max",
      seeds: 4,
      baseSeed: 5,
      concurrency: 4,
      persona,
      backend: createMockBackend(),
    });
    expect(m.hands).toHaveLength(24);
    for (const h of m.hands) expect(sum(h.net)).toBeCloseTo(0);
  });

  it("conserves chips against every opponent, all-ins included", async () => {
    for (const opponent of ["random", "caller", "rules"] as const) {
      for (const format of ["hu", "6max"] as const) {
        const m = await runMatch({
          opponent,
          format,
          seeds: 6,
          baseSeed: 12,
          concurrency: 2,
          persona,
          // Level 5 is an all-in: the hero shoves every hand, so side pots and busts occur.
          backend: stubBackend("bet_or_raise", 5),
        });
        for (const h of m.hands) {
          expect(sum(h.net)).toBeCloseTo(0);
          // Nobody can lose more than the 100 bb starting stack.
          for (const x of h.net) expect(x).toBeGreaterThanOrEqual(-100);
        }
        expect(m.hands.some((h) => h.actions?.some((a) => a.type === "allin"))).toBe(true);
      }
    }
  });

  it("is deterministic for the same arguments", async () => {
    const args = {
      seedIndex: 7,
      rotation: 1,
      opponent: "rules" as const,
      format: "hu" as const,
      baseSeed: 4,
      persona,
    };
    const a = await playHand({ ...args, backend: createMockBackend() });
    const b = await playHand({ ...args, backend: createMockBackend() });
    expect(b.net).toEqual(a.net);
    expect(b.decisions.map((d) => d.action)).toEqual(a.decisions.map((d) => d.action));
    expect(b.actions).toEqual(a.actions);
  });

  it("reports showdown and preflop aggression fields", async () => {
    const r = await playHand({
      seedIndex: 11,
      rotation: 0,
      opponent: "caller",
      format: "6max",
      baseSeed: 9,
      persona,
      backend: createMockBackend(),
    });
    expect(typeof r.wentToShowdown).toBe("boolean");
    // `jevWonShowdown` is "Jev finished the hand ahead", not "Jev was awarded a pot".
    // The table can show down after Jev folded: only Jev's own showdowns carry a win/loss.
    expect(typeof r.jevAtShowdown).toBe("boolean");
    if (r.jevAtShowdown === true) expect(r.wentToShowdown).toBe(true);
    expect(r.jevWonShowdown).toBe(r.jevAtShowdown === true ? (r.net[r.jevSeat] ?? 0) > 0 : null);
    expect(typeof r.jevVpip).toBe("boolean");
    expect(typeof r.jevPfr).toBe("boolean");
    expect(r.oppVpip).toBeGreaterThanOrEqual(0);
    expect(r.oppVpip).toBeLessThanOrEqual(1);
    expect(r.oppPfr).toBeGreaterThanOrEqual(0);
    expect(r.oppPfr).toBeLessThanOrEqual(1);
  });

  it("does not count a showdown Jev folded out of as its own", async () => {
    // Five callers always show down; a hero that always folds is never part of it.
    // The exception is the big blind: there the hero checks its option preflop and is never
    // bet into afterwards (callers never bet), so it does show down.
    const bigBlind = ((await buttonOf(1, 6, "6max")) + 2) % 6;
    for (let rotation = 0; rotation < 6; rotation++) {
      const r = await playHand({
        seedIndex: 1,
        rotation,
        opponent: "caller",
        format: "6max",
        baseSeed: 6,
        persona,
        backend: stubBackend("fold"),
      });
      const jevFolded = r.actions?.some((a) => a.seat === r.jevSeat && a.type === "fold") ?? false;
      expect(r.wentToShowdown).toBe(true);
      expect(jevFolded).toBe(rotation !== bigBlind);
      expect(r.jevAtShowdown).toBe(!jevFolded);
      if (jevFolded) {
        expect(r.jevWonShowdown).toBeNull();
        expect(r.net[r.jevSeat]).toBeLessThanOrEqual(0);
      } else {
        expect(r.jevWonShowdown).toBe((r.net[r.jevSeat] ?? 0) > 0);
      }
      expect(sum(r.net)).toBeCloseTo(0);
    }
  });

  it("keeps VPIP and PFR apart, for Jev and for the opponents", async () => {
    const play = (rotation: number, backend: JevBackend) =>
      playHand({
        seedIndex: 5,
        rotation,
        opponent: "caller",
        format: "hu",
        baseSeed: 3,
        persona,
        backend,
      });
    // Heads-up the button posts the small blind and acts first preflop.
    const btn = await buttonOf(5, 3, "hu");
    const bb = 1 - btn;
    const raised = await play(btn, stubBackend("bet_or_raise"));
    expect([raised.jevVpip, raised.jevPfr]).toEqual([true, true]);
    expect([raised.oppVpip, raised.oppPfr]).toEqual([1, 0]); // the caller called the raise

    const limped = await play(btn, stubBackend("check_or_call"));
    expect([limped.jevVpip, limped.jevPfr]).toEqual([true, false]);
    expect([limped.oppVpip, limped.oppPfr]).toEqual([0, 0]); // the big blind only checked

    const folded = await play(btn, stubBackend("fold"));
    expect([folded.jevVpip, folded.jevPfr]).toEqual([false, false]);
    expect(folded.net[btn]).toBe(-0.5);
    expect(folded.net[bb]).toBe(0.5);

    // In the big blind, checking the option behind a limp is not voluntary money.
    const checked = await play(bb, stubBackend("check_or_call"));
    expect([checked.jevVpip, checked.jevPfr]).toEqual([false, false]);
    expect([checked.oppVpip, checked.oppPfr]).toEqual([1, 0]);

    // Six-handed the opponents' numbers are the share of the five other seats.
    const six = await playHand({
      seedIndex: 5,
      rotation: ((await buttonOf(5, 3, "6max")) + 2) % 6,
      opponent: "caller",
      format: "6max",
      baseSeed: 3,
      persona,
      backend: stubBackend("check_or_call"),
    });
    expect([six.jevVpip, six.jevPfr]).toEqual([false, false]);
    expect([six.oppVpip, six.oppPfr]).toEqual([1, 0]);
  });

  it("seats the heuristic hero without calling the backend", async () => {
    const backend = brokenBackend();
    const args = {
      seedIndex: 2,
      rotation: 1,
      opponent: "rules" as const,
      format: "6max" as const,
      baseSeed: 7,
      persona,
      backend,
      hero: "heuristic" as const,
    };
    const r = await playHand(args);
    expect(backend.calls).toBe(0);
    expect(r.decisions).toEqual([]);
    expect(r.jevSeat).toBe(1);
    expect(r.actions?.some((a) => a.seat === 1)).toBe(true);
    expect(sum(r.net)).toBeCloseTo(0);
    expect((await playHand(args)).actions).toEqual(r.actions);
    const m = await runMatch({ ...args, seeds: 3, concurrency: 2 });
    expect(m.hands).toHaveLength(18);
    expect(backend.calls).toBe(0);
  });

  it("asks Jev only after the flop with the preflop chart", async () => {
    const backend = stubBackend("check_or_call");
    const r = await playHand({
      seedIndex: 5,
      rotation: await buttonOf(5, 3, "hu"),
      opponent: "caller",
      format: "hu",
      baseSeed: 3,
      persona,
      backend,
      preflop: "chart",
    });
    const preflop = r.decisions.filter((d) => d.street === "preflop");
    expect(preflop.length).toBeGreaterThan(0);
    expect(preflop.every((d) => d.model === "chart" && d.apiCall === false)).toBe(true);
    expect(backend.calls).toBe(r.decisions.length - preflop.length);
  });

  it("fails open on a broken backend and records the error on every decision", async () => {
    const backend = brokenBackend();
    const btn = await buttonOf(0, 2, "hu");
    const r = await playHand({
      seedIndex: 0,
      rotation: btn,
      opponent: "caller",
      format: "hu",
      baseSeed: 2,
      persona,
      backend,
    });
    expect(r.decisions.length).toBeGreaterThan(0);
    expect(backend.calls).toBe(r.decisions.length);
    expect(r.decisions.every((d) => d.error === "Error: backend down")).toBe(true);
    // The fallback is check-or-fold: on the button it folds the small blind.
    expect(r.decisions.map((d) => d.action)).toEqual([{ type: "fold" }]);
    expect(r.net[btn]).toBe(-0.5);
  });
});

describe("runMatch", () => {
  const base = {
    opponent: "rules" as const,
    seeds: 5,
    baseSeed: 2,
    concurrency: 3,
    persona,
    backend: createMockBackend(),
  };

  it("runs seeds × rotations", async () => {
    const hu = await runMatch({ ...base, format: "hu" });
    expect(hu.hands).toHaveLength(10);
    expect(hu.partial).toBe(false);
    const six = await runMatch({ ...base, format: "6max" });
    expect(six.hands).toHaveLength(30);
    expect(hu.hands.map((h) => [h.seedIndex, h.rotation])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
      [3, 0],
      [3, 1],
      [4, 0],
      [4, 1],
    ]);
    expect(hu.hands.every((h) => h.jevSeat === h.rotation)).toBe(true);
    expect(six.hands.every((h) => h.jevSeat === h.rotation)).toBe(true);
  });

  it("stops early when aborted", async () => {
    const ctrl = new AbortController();
    const r = await runMatch({
      ...base,
      format: "hu",
      seeds: 50,
      signal: ctrl.signal,
      onHand: (done) => {
        if (done >= 4) ctrl.abort();
      },
    });
    expect(r.partial).toBe(true);
    expect(r.hands.length).toBeLessThan(100);
    expect(r.hands.length).toBeGreaterThanOrEqual(4);
  });

  it("stops scheduling hands once one fails, and rejects with that error", async () => {
    let started = 0;
    const boom = new Error("backend exploded");
    const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
    const r = runMatch({
      ...base,
      format: "hu",
      seeds: 20,
      concurrency: 2,
      // Only ONE job fails, so a worker that ignored the failure would happily
      // grind through the other 38 while the match has already rejected.
      playHandImpl: async (args) => {
        started += 1;
        await tick();
        if (args.seedIndex === 1 && args.rotation === 0) throw boom;
        return playHand(args);
      },
    });
    await expect(r).rejects.toBe(boom);
    // Give any still-running worker ample time to claim more jobs.
    for (let i = 0; i < 50; i++) await tick();
    // 40 jobs were planned; only the handful in flight around the failure may start.
    expect(started).toBeLessThan(10);
  });

  const errored = (error: string | undefined): AgentDecision => ({
    street: "preflop",
    choice: "check_or_call",
    action: { type: "call" },
    probabilities: { fold: 0, check_or_call: 1, bet_or_raise: 0 },
    sizingScore: null,
    bluffIntent: null,
    latencyMs: 1,
    apiCall: true,
    ...(error === undefined ? {} : { error }),
  });
  const fake = (seedIndex: number, rotation: number, decisions: AgentDecision[]): HandRecord => ({
    seedIndex,
    rotation,
    jevSeat: rotation,
    net: [0, 0],
    wentToShowdown: false,
    jevWonShowdown: null,
    jevVpip: false,
    jevPfr: false,
    oppVpip: 0,
    oppPfr: 0,
    decisions,
  });

  it("aborts the match when the first 10 decisions all failed open", async () => {
    let started = 0;
    const r = runMatch({
      ...base,
      format: "hu",
      seeds: 50,
      concurrency: 2,
      playHandImpl: async (args) => {
        started += 1;
        return fake(args.seedIndex, args.rotation, [
          errored("backend down"),
          errored("backend down"),
        ]);
      },
    });
    await expect(r).rejects.toThrow(
      "Jev backend failing on every decision (first 10): backend down",
    );
    const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
    for (let i = 0; i < 50; i++) await tick();
    expect(started).toBeLessThan(15); // of 100 planned hands
  });

  it("aborts the same way with the real playHand on a backend that always throws", async () => {
    const backend = brokenBackend();
    const r = runMatch({ ...base, format: "hu", seeds: 50, concurrency: 2, backend });
    await expect(r).rejects.toThrow(
      "Jev backend failing on every decision (first 10): Error: backend down",
    );
    const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
    for (let i = 0; i < 50; i++) await tick();
    // Every hand holds at least one Jev decision, so 100 planned hands stop within a handful.
    expect(backend.calls).toBeLessThan(40);
  });

  it("does not abort when only some decisions failed open", async () => {
    const r = await runMatch({
      ...base,
      format: "hu",
      seeds: 10,
      playHandImpl: async (args) =>
        fake(args.seedIndex, args.rotation, [
          errored(args.rotation === 0 ? "flaky" : undefined),
          errored(undefined),
        ]),
    });
    expect(r.hands).toHaveLength(20);
  });

  it("reports every decision through onDecision", async () => {
    const seen: AgentDecision[] = [];
    const r = await runMatch({ ...base, format: "hu", seeds: 2, onDecision: (d) => seen.push(d) });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(r.hands.reduce((n, h) => n + h.decisions.length, 0));
    expect(seen.every((d) => d.error === undefined && d.model === "mock")).toBe(true);
  });

  it("reports progress up to the total", async () => {
    const seen: [number, number][] = [];
    const r = await runMatch({
      ...base,
      format: "hu",
      seeds: 3,
      onHand: (done, total) => seen.push([done, total]),
    });
    expect(r.hands).toHaveLength(6);
    expect(seen).toHaveLength(6);
    expect(seen.map((s) => s[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every((s) => s[1] === 6)).toBe(true);
  });
});

describe("playHand action log", () => {
  it("records every seat's actions in order with amounts in bb", async () => {
    const r = await playHand({
      seedIndex: 4,
      rotation: 0,
      opponent: "rules",
      format: "6max",
      baseSeed: 3,
      persona,
      backend: createMockBackend(),
    });
    expect(r.actions?.length).toBeGreaterThan(0);
    expect(r.actions?.every((a) => a.seat >= 0 && a.seat < 6)).toBe(true);
    for (const a of r.actions ?? []) {
      if (a.type === "bet" || a.type === "raise") expect(a.amountBB).toBeGreaterThan(0);
      else expect("amountBB" in a).toBe(false);
    }
    // The first voluntary action is under the gun, three seats after the button.
    const utg = ((await buttonOf(4, 3, "6max")) + 3) % 6;
    expect(r.actions?.[0]).toMatchObject({ street: "preflop", seat: utg });
  });

  it("logs a raise to its total and an all-in as `allin`", async () => {
    // Level 2 preflop is an open to 3 bb.
    const btn = await buttonOf(5, 3, "hu");
    const bb = 1 - btn;
    const open = await playHand({
      seedIndex: 5,
      rotation: btn,
      opponent: "caller",
      format: "hu",
      baseSeed: 3,
      persona,
      backend: stubBackend("bet_or_raise", 2),
    });
    expect(open.actions?.[0]).toEqual({ street: "preflop", seat: btn, type: "raise", amountBB: 3 });
    expect(open.actions?.[1]).toEqual({ street: "preflop", seat: bb, type: "call" });
    const shove = await playHand({
      seedIndex: 5,
      rotation: btn,
      opponent: "caller",
      format: "hu",
      baseSeed: 3,
      persona,
      backend: stubBackend("bet_or_raise", 5),
    });
    expect(shove.actions).toEqual([
      { street: "preflop", seat: btn, type: "allin" },
      { street: "preflop", seat: bb, type: "call" },
    ]);
    expect(shove.wentToShowdown).toBe(true);
    expect(shove.jevAtShowdown).toBe(true);
    expect(Math.abs(shove.net[btn] ?? 0)).toBeOneOf([0, 100]);
  });
});
