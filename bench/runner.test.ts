import {
  type ActionLabel,
  type AgentDecision,
  createMockBackend,
  type DecisionFeatures,
  type JevBackend,
  OPPONENT_TYPE_GUIDANCE,
  OPPONENT_TYPES_INTRO,
  type OpponentStats,
  type OpponentType,
  type Persona,
} from "@jev-poker/agent";
import { formatCard, type GameEvent } from "@jev-poker/engine";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { getPersona } from "./backend";
import {
  expandMatchups,
  HERO_PLAYER,
  isMixed,
  kindOf,
  MIXED_LINEUPS,
  playersAt,
  rotations,
  seatCount,
} from "./matchups";
import { JevTypeLabeler, ProfileTracker } from "./profile";
import { playHand, runMatch } from "./runner";
import type { Format, HandAction, HandRecord } from "./types";

// These tests play whole matches; under the full suite they can take longer than the default 5 s.
vi.setConfig({ testTimeout: 30_000 });

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

  it("a mixed table is six-handed only, whatever format is asked for", () => {
    for (const opponent of ["mixed", "mixed-jev"] as const) {
      expect(expandMatchups(opponent, "6max")).toEqual([{ opponent, format: "6max" }]);
      expect(expandMatchups(opponent, "all")).toEqual([{ opponent, format: "6max" }]);
      expect(() => expandMatchups(opponent, "hu")).toThrow(`${opponent} is a six-handed table`);
    }
  });

  it("`all` still means the three single-kind opponents", () => {
    const opponents = new Set(expandMatchups("all", "all").map((m) => m.opponent));
    expect([...opponents]).toEqual(["random", "caller", "rules"]);
    expect(expandMatchups("all", "6max")).toEqual([
      { opponent: "random", format: "6max" },
      { opponent: "caller", format: "6max" },
      { opponent: "rules", format: "6max" },
    ]);
    expect(expandMatchups("all", "hu").map((m) => m.opponent)).toEqual([
      "random",
      "caller",
      "rules",
    ]);
  });
});

describe("mixed tables", () => {
  it("names the five players around the hero", () => {
    expect(MIXED_LINEUPS.mixed).toEqual(["rules", "caller", "random", "heuristic", "rules"]);
    expect(MIXED_LINEUPS["mixed-jev"]).toEqual([
      "jev:rock",
      "jev:lag",
      "jev:maniac",
      "jev:station",
      "jev:tag",
    ]);
    // Every Jev CPU is one of the preset personas of the game.
    for (const kind of MIXED_LINEUPS["mixed-jev"]) {
      expect(kind.startsWith("jev:")).toBe(true);
      expect(getPersona(kind.slice("jev:".length)).id).toBe(kind.slice("jev:".length));
    }
    expect(HERO_PLAYER).toBe("hero");
  });

  it("tells mixed tables from single-kind ones", () => {
    expect(isMixed("mixed")).toBe(true);
    expect(isMixed("mixed-jev")).toBe(true);
    for (const opponent of ["random", "caller", "rules"] as const) {
      expect(isMixed(opponent)).toBe(false);
    }
  });

  it("gives a single-kind table one shared player id, and the hero its own", () => {
    expect(playersAt("rules", "hu", 0)).toEqual(["hero", "rules"]);
    expect(playersAt("rules", "hu", 1)).toEqual(["rules", "hero"]);
    expect(playersAt("caller", "6max", 3)).toEqual([
      "caller",
      "caller",
      "caller",
      "hero",
      "caller",
      "caller",
    ]);
    for (const opponent of ["random", "caller", "rules"] as const) {
      for (const format of ["hu", "6max"] as const) {
        for (let jevSeat = 0; jevSeat < seatCount(format); jevSeat++) {
          const players = playersAt(opponent, format, jevSeat);
          expect(players).toHaveLength(seatCount(format));
          expect(players[jevSeat]).toBe(HERO_PLAYER);
          expect(players.filter((id) => id === HERO_PLAYER)).toHaveLength(1);
          expect(players.filter((id) => id === opponent)).toHaveLength(seatCount(format) - 1);
        }
      }
    }
  });

  it("keeps the five opponents in lineup order around every hero seat, each with its own id", () => {
    expect(playersAt("mixed", "6max", 0)).toEqual([
      "hero",
      "rules@0",
      "caller@1",
      "random@2",
      "heuristic@3",
      "rules@4",
    ]);
    expect(playersAt("mixed", "6max", 2)).toEqual([
      "rules@0",
      "caller@1",
      "hero",
      "random@2",
      "heuristic@3",
      "rules@4",
    ]);
    expect(playersAt("mixed-jev", "6max", 5)).toEqual([
      "jev:rock@0",
      "jev:lag@1",
      "jev:maniac@2",
      "jev:station@3",
      "jev:tag@4",
      "hero",
    ]);
    for (const opponent of ["mixed", "mixed-jev"] as const) {
      const expected = MIXED_LINEUPS[opponent].map((kind, i) => `${kind}@${i}`);
      for (let jevSeat = 0; jevSeat < 6; jevSeat++) {
        const players = playersAt(opponent, "6max", jevSeat);
        expect(players).toHaveLength(6);
        expect(players[jevSeat]).toBe(HERO_PLAYER);
        expect(players.filter((_, seat) => seat !== jevSeat)).toEqual(expected);
        expect(new Set(players).size).toBe(6);
      }
    }
  });

  it("refuses a mixed table that is not six-handed", () => {
    expect(() => playersAt("mixed", "hu", 0)).toThrow("mixed is a 6-seat table");
    expect(() => playersAt("mixed-jev", "hu", 1)).toThrow("mixed-jev is a 6-seat table");
  });

  it("reads the kind back out of a player id", () => {
    expect(kindOf("rules@4")).toBe("rules");
    expect(kindOf("heuristic@3")).toBe("heuristic");
    expect(kindOf("jev:rock@0")).toBe("jev:rock");
    expect(kindOf("caller")).toBe("caller");
    expect(kindOf(HERO_PLAYER)).toBe(HERO_PLAYER);
    for (const opponent of ["mixed", "mixed-jev"] as const) {
      const kinds = playersAt(opponent, "6max", 3)
        .filter((id) => id !== HERO_PLAYER)
        .map(kindOf);
      expect(kinds).toEqual(MIXED_LINEUPS[opponent]);
    }
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

interface LabelRequest {
  opponent: OpponentStats;
  model: string | undefined;
}

interface Recording {
  /** The state of every poker decision, in request order. */
  states: DecisionFeatures[];
  /** The model sent with each of those decisions. */
  models: (string | undefined)[];
  /** Every `opponent_type` classification request. */
  labelRequests: LabelRequest[];
}

/**
 * The mock backend, remembering what it was asked. It only understands the poker questions, so
 * the `opponent_type` question of the `jev-label` mode is answered here, by `label`.
 */
function recordingBackend(
  label: (opponent: OpponentStats) => OpponentType = () => "regular",
): JevBackend & Recording {
  const mock = createMockBackend();
  const states: DecisionFeatures[] = [];
  const models: (string | undefined)[] = [];
  const labelRequests: LabelRequest[] = [];
  return {
    kind: "mock",
    states,
    models,
    labelRequests,
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      if ("opponent_type" in request.questions) {
        const { opponent } = request.state as unknown as { opponent: OpponentStats };
        labelRequests.push({ opponent, model: request.model });
        return {
          model: "stub",
          answers: {
            opponent_type: {
              type: "choice",
              choice: label(opponent),
              confidence: 1,
              probabilities: {},
            },
          },
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as SystemOneResult<Q>;
      }
      states.push(request.state as unknown as DecisionFeatures);
      models.push(request.model);
      return mock.systemOne(request);
    },
  };
}

/** The opponents of a hand as the tracker is told about them: seat -> player id, hero left out. */
function opponentsOf(hand: HandRecord): Map<number, string> {
  const seats = new Map<number, string>();
  for (const [seat, id] of (hand.players ?? []).entries()) {
    if (seat !== hand.jevSeat) seats.set(seat, id);
  }
  return seats;
}

/** The seats still in the hand, other than the hero's, as the state itself reports them. */
function liveOpponents(state: DecisionFeatures, jevSeat: number): number[] {
  return state.table.stacksBB.filter((s) => !s.folded && s.seat !== jevSeat).map((s) => s.seat);
}

/**
 * Walks a one-worker match in order, with a shadow tracker that knows exactly the hands that had
 * finished before each decision. Only the hero calls the backend at these tables, so the states
 * line up with the hands' decisions one to one.
 */
function replay(
  hands: readonly HandRecord[],
  states: readonly DecisionFeatures[],
  check: (state: DecisionFeatures, hand: HandRecord, memory: ProfileTracker) => void,
): void {
  const memory = new ProfileTracker();
  let next = 0;
  for (const hand of hands) {
    for (let d = 0; d < hand.decisions.length; d++) {
      check(states[next] as DecisionFeatures, hand, memory);
      next += 1;
    }
    memory.record(hand.actions ?? [], opponentsOf(hand));
  }
  expect(next).toBe(states.length);
}

describe("a mixed table", () => {
  const mixed = {
    opponent: "mixed" as const,
    format: "6max" as const,
    seeds: 5,
    baseSeed: 5,
    concurrency: 1,
    persona,
  };
  const decisionsIn = (hands: readonly HandRecord[]): number =>
    hands.reduce((n, h) => n + h.decisions.length, 0);
  /** What happened in a hand, without the wall-clock latency of its decisions. */
  const played = (h: HandRecord) => ({
    players: h.players,
    net: h.net,
    actions: h.actions,
    choices: h.decisions.map((d) => [d.street, d.choice, d.action]),
  });

  it("conserves chips, records who sat where, and mirrors the deal across rotations", async () => {
    const backend = recordingBackend();
    const deals = new Map<string, { button: number | null; hole: [number, string][] }>();
    const m = await runMatch({
      ...mixed,
      seeds: 3,
      concurrency: 3,
      backend,
      playHandImpl: async (args) => {
        const deal = dealRecorder();
        const record = await playHand({ ...args, onEvent: deal.onEvent });
        deals.set(`${args.seedIndex}/${args.rotation}`, { button: deal.button(), hole: deal.hole });
        return record;
      },
    });
    expect(m.partial).toBe(false);
    expect(m.hands).toHaveLength(18);
    for (const h of m.hands) {
      expect(sum(h.net)).toBeCloseTo(0);
      expect(h.net).toHaveLength(6);
      for (const x of h.net) expect(x).toBeGreaterThanOrEqual(-100);
      expect(h.jevSeat).toBe(h.rotation);
      expect(h.players).toEqual(playersAt("mixed", "6max", h.jevSeat));
      expect(h.players?.[h.jevSeat]).toBe(HERO_PLAYER);
      // Every seat acted or was the big blind left alone: nobody at the table is missing.
      expect(new Set(h.actions?.map((a) => a.seat)).size).toBeGreaterThanOrEqual(5);
    }
    // Same seed, hero in another seat: every seat is dealt the same two cards off the same button.
    for (let seedIndex = 0; seedIndex < 3; seedIndex++) {
      const first = deals.get(`${seedIndex}/0`);
      expect(first?.hole).toHaveLength(6);
      for (let rotation = 1; rotation < 6; rotation++) {
        expect(deals.get(`${seedIndex}/${rotation}`)).toEqual(first);
      }
    }
    expect(deals.get("1/0")?.hole).not.toEqual(deals.get("0/0")?.hole);
    // Nobody but the hero talks to the backend here, and without --profile it is told nothing.
    expect(backend.states).toHaveLength(decisionsIn(m.hands));
    expect(backend.states.length).toBeGreaterThan(0);
    for (const s of backend.states) {
      expect("opponentStats" in s.table).toBe(false);
      expect("opponentTypes" in s.table).toBe(false);
      expect(s.importantContext).not.toContain(OPPONENT_TYPES_INTRO);
    }
    expect(backend.labelRequests).toHaveLength(0);
  });

  it("is deterministic, and the same hands whatever the profile mode is fed back", async () => {
    const plain = await runMatch({ ...mixed, seeds: 1, backend: createMockBackend() });
    const again = await runMatch({ ...mixed, seeds: 1, backend: createMockBackend() });
    expect(again.hands.map(played)).toEqual(plain.hands.map(played));
    // Six hands are too few for any memory to show, so every mode plays them identically.
    for (const profile of [true, "numbers", "label", "jev-label"] as const) {
      const m = await runMatch({ ...mixed, seeds: 1, backend: recordingBackend(), profile });
      expect(m.hands.map(played)).toEqual(plain.hands.map(played));
    }
  });

  it('profile "label" sends each live player\'s threshold type once 20 of its hands are known, never the numbers', async () => {
    const backend = recordingBackend();
    const { hands } = await runMatch({ ...mixed, backend, profile: "label" });
    expect(hands).toHaveLength(30);
    const seen = new Map<string, Set<OpponentType>>();
    replay(hands, backend.states, (state, hand, memory) => {
      const expected = liveOpponents(state, hand.jevSeat).flatMap((seat) => {
        const type = memory.typeFor(hand.players?.[seat] ?? "");
        return type === null ? [] : [{ seat, type }];
      });
      expect(state.table.opponentTypes ?? []).toEqual(expected);
      expect("opponentTypes" in state.table).toBe(expected.length > 0);
      expect(state.importantContext.includes(OPPONENT_TYPES_INTRO)).toBe(expected.length > 0);
      for (const { seat, type } of expected) {
        expect(seat).not.toBe(hand.jevSeat);
        const id = hand.players?.[seat] ?? "";
        seen.set(id, (seen.get(id) ?? new Set()).add(type));
        const line = OPPONENT_TYPE_GUIDANCE[type];
        if (line !== null) expect(state.importantContext).toContain(line);
      }
      expect("opponentStats" in state.table).toBe(false);
      expect(state.importantContext.some((l) => l.startsWith("opponentStats describes"))).toBe(
        false,
      );
    });
    // One worker: the first 20 hands see nothing, every decision after them sees the caller.
    const early = decisionsIn(hands.slice(0, 20));
    expect(backend.states.slice(0, early).every((s) => s.table.opponentTypes === undefined)).toBe(
      true,
    );
    expect(backend.states.length).toBeGreaterThan(early);
    expect(backend.states.slice(early).every((s) => s.table.opponentTypes !== undefined)).toBe(
      true,
    );
    expect([...(seen.get("caller@1") ?? [])]).toEqual(["calling_station"]);
    expect(seen.has(HERO_PLAYER)).toBe(false);
    expect(backend.labelRequests).toHaveLength(0);
  });

  it('profile "numbers" and `true` send per-player statistics: caller@1 and rules@0 differ', async () => {
    const backend = recordingBackend();
    const { hands } = await runMatch({ ...mixed, backend, profile: "numbers" });
    let together = 0;
    replay(hands, backend.states, (state, hand, memory) => {
      const expected = liveOpponents(state, hand.jevSeat).flatMap((seat) => {
        const stats = memory.statsFor(hand.players?.[seat] ?? "");
        return stats === null ? [] : [{ seat, ...stats }];
      });
      expect(state.table.opponentStats ?? []).toEqual(expected);
      expect("opponentStats" in state.table).toBe(expected.length > 0);
      expect("opponentTypes" in state.table).toBe(false);
      expect(state.importantContext).not.toContain(OPPONENT_TYPES_INTRO);
      const seatOf = (id: string) => hand.players?.indexOf(id) ?? -1;
      const caller = expected.find((o) => o.seat === seatOf("caller@1"));
      const rules = expected.find((o) => o.seat === seatOf("rules@0"));
      if (caller !== undefined && rules !== undefined) {
        together += 1;
        expect(caller.vpipPct).toBeGreaterThan(rules.vpipPct);
        expect(caller.hands).toBe(rules.hands);
      }
    });
    expect(together).toBeGreaterThan(0);
    const early = decisionsIn(hands.slice(0, 20));
    expect(backend.states.slice(0, early).every((s) => s.table.opponentStats === undefined)).toBe(
      true,
    );
    expect(backend.states.slice(early).every((s) => s.table.opponentStats !== undefined)).toBe(
      true,
    );
    expect(backend.labelRequests).toHaveLength(0);

    // `true` is what older callers pass: it is the numbers.
    const legacy = recordingBackend();
    const old = await runMatch({ ...mixed, backend: legacy, profile: true });
    expect(legacy.states).toEqual(backend.states);
    expect(old.hands.map(played)).toEqual(hands.map(played));
  });

  it('profile "jev-label" asks Jev for the types, reports the calls, and shows the hero what Jev said', async () => {
    // Deliberately not what the thresholds say, so the types can only have come from the backend:
    // a loose player who never raises (the caller) is called a maniac here.
    const judge = (o: OpponentStats): OpponentType =>
      o.pfrPct === 0 && o.vpipPct >= 50 ? "maniac" : "regular";
    const backend = recordingBackend(judge);
    const reported: number[] = [];
    const { hands } = await runMatch({
      ...mixed,
      backend,
      model: "jev-x",
      profile: "jev-label",
      onLabelCalls: (calls) => reported.push(calls),
    });
    expect(hands).toHaveLength(30);
    // Five players, each asked about once: at 20 hands, and not again before 45.
    expect(backend.labelRequests).toHaveLength(5);
    expect(backend.labelRequests.every((r) => r.opponent.hands === 20)).toBe(true);
    expect(backend.labelRequests.every((r) => r.model === "jev-x")).toBe(true);
    expect(backend.models.every((m) => m === "jev-x")).toBe(true);
    expect(reported).toHaveLength(30); // once per finished hand
    expect(reported.slice(0, 19).every((calls) => calls === 0)).toBe(true);
    expect(reported.slice(19).every((calls) => calls === 5)).toBe(true);

    const early = decisionsIn(hands.slice(0, 20));
    expect(backend.states.length).toBeGreaterThan(early);
    // What Jev said about each player: judged once, on the 20-hand sample, and kept since.
    const labels = new Map<string, OpponentType>();
    replay(hands, backend.states, (state, hand, memory) => {
      for (const id of hand.players ?? []) {
        const stats = memory.statsFor(id);
        if (stats !== null && !labels.has(id)) {
          expect(stats.hands).toBe(20);
          labels.set(id, judge(stats));
        }
      }
      const expected = liveOpponents(state, hand.jevSeat).flatMap((seat) => {
        const type = labels.get(hand.players?.[seat] ?? "");
        return type === undefined ? [] : [{ seat, type }];
      });
      expect(state.table.opponentTypes ?? []).toEqual(expected);
      expect("opponentStats" in state.table).toBe(false);
      if (labels.size > 0) {
        expect(expected.some((o) => o.type === "maniac")).toBe(true); // the caller never folds
        expect(state.importantContext).toContain(OPPONENT_TYPES_INTRO);
        expect(state.importantContext).toContain(OPPONENT_TYPE_GUIDANCE.maniac);
        expect(state.importantContext).not.toContain(OPPONENT_TYPE_GUIDANCE.calling_station);
      }
    });
    expect([...labels.keys()].sort()).toEqual(
      playersAt("mixed", "6max", 0)
        .filter((id) => id !== HERO_PLAYER)
        .sort(),
    );
    expect(labels.get("caller@1")).toBe("maniac");
    expect(backend.labelRequests.map((r) => judge(r.opponent)).sort()).toEqual(
      [...labels.values()].sort(),
    );
  });

  it("jev-label at a single-kind table asks about the pooled player, again after 25 more hands", async () => {
    const backend = recordingBackend((o) => (o.hands < 45 ? "nit" : "calling_station"));
    let last = -1;
    const { hands } = await runMatch({
      opponent: "caller",
      format: "hu",
      seeds: 25,
      baseSeed: 3,
      concurrency: 1,
      persona,
      backend,
      profile: "jev-label",
      onLabelCalls: (calls) => {
        last = calls;
      },
    });
    expect(hands).toHaveLength(50);
    expect(hands.every((h) => h.players?.[1 - h.jevSeat] === "caller")).toBe(true);
    expect(backend.labelRequests.map((r) => r.opponent.hands)).toEqual([20, 45]);
    expect(backend.labelRequests.every((r) => r.model === undefined)).toBe(true);
    expect(last).toBe(2);
    const stateHands = hands.flatMap((h, i) => h.decisions.map(() => ({ i, jevSeat: h.jevSeat })));
    expect(stateHands).toHaveLength(backend.states.length);
    for (const [k, state] of backend.states.entries()) {
      const { i, jevSeat } = stateHands[k] as { i: number; jevSeat: number };
      const type = i < 20 ? null : i < 45 ? "nit" : "calling_station";
      expect(state.table.opponentTypes ?? []).toEqual(
        type === null ? [] : [{ seat: 1 - jevSeat, type }],
      );
    }
  });

  it("does not let a failing classification stop the match or reach the hero", async () => {
    const mock = createMockBackend();
    let labelCalls = 0;
    const states: DecisionFeatures[] = [];
    const backend: JevBackend = {
      kind: "mock",
      async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
        if ("opponent_type" in request.questions) {
          labelCalls += 1;
          throw new Error("classifier down");
        }
        states.push(request.state as unknown as DecisionFeatures);
        return mock.systemOne(request);
      },
    };
    let reported = 0;
    const m = await runMatch({
      ...mixed,
      seeds: 4,
      backend,
      profile: "jev-label",
      onLabelCalls: (calls) => {
        reported = calls;
      },
    });
    expect(m.hands).toHaveLength(24);
    expect(labelCalls).toBe(5); // asked once each, not once per hand
    expect(reported).toBe(5);
    expect(states.every((s) => s.table.opponentTypes === undefined)).toBe(true);
    expect(m.hands.every((h) => h.decisions.every((d) => d.error === undefined))).toBe(true);
  });
});

describe("playHand profile wiring", () => {
  const callsDown = (seat: number): HandAction[] => [
    { street: "preflop", seat, type: "call" },
    { street: "flop", seat, type: "call" },
  ];
  const foldsPreflop = (seat: number): HandAction[] => [{ street: "preflop", seat, type: "fold" }];
  /** 30 hands of memory about two players of the mixed table; the other three are unknown. */
  function memoryOf(): ProfileTracker {
    const tracker = new ProfileTracker();
    const players = new Map([
      [1, "caller@1"],
      [5, "rules@4"],
    ]);
    for (let i = 0; i < 30; i++) tracker.record([...callsDown(1), ...foldsPreflop(5)], players);
    return tracker;
  }
  const args = { seedIndex: 2, opponent: "mixed" as const, format: "6max" as const, baseSeed: 8 };

  it("looks players up by id, wherever the rotation has put them", async () => {
    for (const rotation of [0, 1, 4]) {
      const players = playersAt("mixed", "6max", rotation);
      const callerSeat = players.indexOf("caller@1");
      const rulesSeat = players.indexOf("rules@4");
      const tracker = memoryOf();

      const label = recordingBackend();
      await playHand({ ...args, rotation, persona, backend: label, tracker, profileMode: "label" });
      expect(label.states.length).toBeGreaterThan(0);
      for (const s of label.states) {
        const live = liveOpponents(s, rotation);
        expect(live).toContain(callerSeat); // the caller never folds
        expect(s.table.opponentTypes).toEqual([
          ...[
            { seat: callerSeat, type: "calling_station" },
            ...(live.includes(rulesSeat) ? [{ seat: rulesSeat, type: "nit" }] : []),
          ].sort((a, b) => a.seat - b.seat),
        ]);
        expect("opponentStats" in s.table).toBe(false);
      }

      // No mode given: the tracker means the numbers, as it did before the modes existed.
      for (const profileMode of [undefined, "numbers"] as const) {
        const numbers = recordingBackend();
        await playHand({
          ...args,
          rotation,
          persona,
          backend: numbers,
          tracker,
          ...(profileMode === undefined ? {} : { profileMode }),
        });
        expect(numbers.states.length).toBeGreaterThan(0);
        for (const s of numbers.states) {
          const caller = s.table.opponentStats?.find((o) => o.seat === callerSeat);
          expect(caller).toEqual({ seat: callerSeat, ...tracker.statsFor("caller@1") });
          expect(caller).toMatchObject({ hands: 30, vpipPct: 100, pfrPct: 0, foldToBetPct: 0 });
          expect(
            s.table.opponentStats?.every((o) => [callerSeat, rulesSeat].includes(o.seat)),
          ).toBe(true);
          expect("opponentTypes" in s.table).toBe(false);
        }
      }
    }
  });

  it("jev-label reads the labeler, not the thresholds, and needs a labeler to say anything", async () => {
    const tracker = memoryOf();
    const labeler = new JevTypeLabeler(
      tracker,
      recordingBackend((o) => (o.vpipPct === 100 ? "maniac" : "regular")),
    );
    const rotation = 3;
    const callerSeat = playersAt("mixed", "6max", rotation).indexOf("caller@1");

    // Nothing has been asked yet: the labeler knows nobody, and playing a hand does not ask.
    const before = recordingBackend();
    await playHand({
      ...args,
      rotation,
      persona,
      backend: before,
      tracker,
      labeler,
      profileMode: "jev-label",
    });
    expect(before.states.length).toBeGreaterThan(0);
    expect(before.labelRequests).toHaveLength(0);
    expect(labeler.calls).toBe(0);
    for (const s of before.states) {
      expect("opponentTypes" in s.table).toBe(false);
      expect("opponentStats" in s.table).toBe(false);
    }

    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    const after = recordingBackend();
    await playHand({
      ...args,
      rotation,
      persona,
      backend: after,
      tracker,
      labeler,
      profileMode: "jev-label",
    });
    expect(after.states.length).toBe(before.states.length);
    for (const s of after.states) {
      expect(s.table.opponentTypes).toContainEqual({ seat: callerSeat, type: "maniac" });
      expect(s.table.opponentTypes?.every((o) => o.type !== "calling_station")).toBe(true);
      expect("opponentStats" in s.table).toBe(false);
    }

    // The mode without a labeler, or a labeler under another mode, changes nothing.
    const without = recordingBackend();
    await playHand({
      ...args,
      rotation,
      persona,
      backend: without,
      tracker,
      profileMode: "jev-label",
    });
    expect(without.states).toEqual(before.states);
    const otherMode = recordingBackend();
    await playHand({
      ...args,
      rotation,
      persona,
      backend: otherMode,
      tracker,
      labeler,
      profileMode: "label",
    });
    for (const s of otherMode.states) {
      expect(s.table.opponentTypes).toContainEqual({ seat: callerSeat, type: "calling_station" });
    }
  });

  it("tells a heuristic hero nothing and still records who sat where", async () => {
    const backend = recordingBackend();
    const r = await playHand({
      ...args,
      rotation: 2,
      persona,
      backend,
      hero: "heuristic",
      tracker: memoryOf(),
      profileMode: "label",
    });
    expect(backend.states).toHaveLength(0);
    expect(r.players).toEqual(playersAt("mixed", "6max", 2));
    expect(sum(r.net)).toBeCloseTo(0);
  });
});

describe("a mixed-jev table", () => {
  const hero: Persona = { ...persona, id: "bench-hero", name: { en: "Hero", ja: "Hero" } };
  const cpuNames = ["rock", "lag", "maniac", "station", "tag"].map((id) => getPersona(id).name.en);

  it("seats Jev CPUs that ask the same backend under their own personas", async () => {
    const backend = recordingBackend();
    const r = await playHand({
      seedIndex: 1,
      rotation: 2,
      opponent: "mixed-jev",
      format: "6max",
      baseSeed: 4,
      persona: hero,
      backend,
      model: "jev-x",
    });
    expect(r.players).toEqual([
      "jev:rock@0",
      "jev:lag@1",
      "hero",
      "jev:maniac@2",
      "jev:station@3",
      "jev:tag@4",
    ]);
    expect(sum(r.net)).toBeCloseTo(0);
    const names = backend.states.map((s) => s.persona.name);
    const asked = new Set(names);
    // Everybody acts preflop, except possibly a big blind the table folded to.
    expect(asked.size).toBeGreaterThanOrEqual(5);
    for (const name of asked) expect(["Hero", ...cpuNames]).toContain(name);
    expect(names.filter((n) => n !== "Hero").length).toBeGreaterThan(0);
    // Only the hero is measured: its decisions are recorded, the CPUs' are not.
    expect(r.decisions).toHaveLength(names.filter((n) => n === "Hero").length);
    expect(backend.states.length).toBeGreaterThan(r.decisions.length);
    expect(r.actions?.length).toBe(backend.states.length);
    // The CPUs share the model as well as the backend, and are told nothing about the session.
    expect(backend.models.every((m) => m === "jev-x")).toBe(true);
    expect(backend.states.every((s) => !("opponentTypes" in s.table))).toBe(true);
  });

  it("shares the hero session memory with nobody: only the hero state carries the types", async () => {
    const tracker = new ProfileTracker();
    const players = new Map(
      playersAt("mixed-jev", "6max", 0).flatMap((id, seat): [number, string][] =>
        seat === 0 ? [] : [[seat, id]],
      ),
    );
    const everyoneCalls: HandAction[] = [1, 2, 3, 4, 5].map((seat) => ({
      street: "preflop",
      seat,
      type: "call",
    }));
    for (let i = 0; i < 20; i++) tracker.record(everyoneCalls, players);
    const backend = recordingBackend();
    const r = await playHand({
      seedIndex: 1,
      rotation: 0,
      opponent: "mixed-jev",
      format: "6max",
      baseSeed: 4,
      persona: hero,
      backend,
      tracker,
      profileMode: "label",
    });
    expect(r.decisions.length).toBeGreaterThan(0);
    for (const s of backend.states) {
      if (s.persona.name === "Hero") {
        expect(s.table.opponentTypes?.length).toBeGreaterThan(0);
        expect(s.table.opponentTypes?.every((o) => o.type === "calling_station")).toBe(true);
      } else {
        expect("opponentTypes" in s.table).toBe(false);
        expect("opponentStats" in s.table).toBe(false);
      }
    }
  });

  it("conserves chips over a whole rotation and fails open like any Jev seat", async () => {
    const m = await runMatch({
      opponent: "mixed-jev",
      format: "6max",
      seeds: 1,
      baseSeed: 9,
      concurrency: 3,
      persona: hero,
      backend: createMockBackend(),
    });
    expect(m.hands).toHaveLength(6);
    for (const h of m.hands) {
      expect(sum(h.net)).toBeCloseTo(0);
      expect(h.players).toEqual(playersAt("mixed-jev", "6max", h.jevSeat));
    }
    // A broken backend breaks the CPUs too; every seat falls back to check-or-fold.
    const broken = brokenBackend();
    const r = await playHand({
      seedIndex: 0,
      rotation: 1,
      opponent: "mixed-jev",
      format: "6max",
      baseSeed: 9,
      persona: hero,
      backend: broken,
    });
    expect(sum(r.net)).toBeCloseTo(0);
    expect(broken.calls).toBeGreaterThan(r.decisions.length);
    expect(r.actions?.every((a) => a.type === "fold" || a.type === "check")).toBe(true);
  });
});

describe("the losing-player gate", () => {
  const table = {
    opponent: "mixed" as const,
    format: "6max" as const,
    // 40 seeds = 240 hands: every player passes the 100-hand minimum well before the end.
    seeds: 40,
    baseSeed: 11,
    concurrency: 1,
    persona,
  };

  /** Replays the match into a tracker and checks every listed type against the gate. */
  function checkGate(
    hands: readonly HandRecord[],
    states: readonly DecisionFeatures[],
  ): { shown: number; gatedOut: number; memory: ProfileTracker } {
    const memory = new ProfileTracker();
    let next = 0;
    let gatedOut = 0;
    let shown = 0;
    for (const hand of hands) {
      for (let d = 0; d < hand.decisions.length; d++) {
        const state = states[next] as DecisionFeatures;
        for (let seat = 0; seat < 6; seat++) {
          if (seat === hand.jevSeat) continue;
          const id = hand.players?.[seat] ?? "";
          const listed = (state.table.opponentTypes ?? []).some((o) => o.seat === seat);
          if (listed) {
            expect(memory.isLosing(id)).toBe(true);
            shown += 1;
          } else if (memory.typeFor(id) !== null && !memory.isLosing(id)) {
            gatedOut += 1;
          }
        }
        next += 1;
      }
      memory.record(hand.actions ?? [], opponentsOf(hand), hand.net);
    }
    expect(next).toBe(states.length);
    return { shown, gatedOut, memory };
  }

  it("gives a type only for players who have lost enough over enough hands", async () => {
    const backend = recordingBackend();
    const { hands } = await runMatch({
      ...table,
      backend,
      profile: "label",
      profileLosingOnly: true,
    });
    const { shown, gatedOut, memory } = checkGate(hands, backend.states);
    // Against the mock hero the caller bleeds chips, so the gate opens for it and closes for the rest.
    expect(shown).toBeGreaterThan(0);
    expect(gatedOut).toBeGreaterThan(0);
    expect(memory.isLosing("caller@1")).toBe(true);
    expect(memory.isLosing("rules@0")).toBe(false);
  });

  it("applies to Jev's labels too", async () => {
    const backend = recordingBackend(() => "maniac");
    const { hands } = await runMatch({
      ...table,
      backend,
      profile: "jev-label",
      profileLosingOnly: true,
    });
    const { shown, gatedOut } = checkGate(hands, backend.states);
    expect(shown).toBeGreaterThan(0);
    expect(gatedOut).toBeGreaterThan(0);
  });

  it("does nothing without the flag", async () => {
    const backend = recordingBackend();
    const { hands } = await runMatch({ ...table, seeds: 10, backend, profile: "label" });
    const memory = new ProfileTracker();
    let next = 0;
    let listedWhileNotLosing = 0;
    for (const hand of hands) {
      for (let d = 0; d < hand.decisions.length; d++) {
        const state = backend.states[next] as DecisionFeatures;
        for (const o of state.table.opponentTypes ?? []) {
          if (!memory.isLosing(hand.players?.[o.seat] ?? "")) listedWhileNotLosing += 1;
        }
        next += 1;
      }
      memory.record(hand.actions ?? [], opponentsOf(hand), hand.net);
    }
    expect(listedWhileNotLosing).toBeGreaterThan(0);
  });
});
