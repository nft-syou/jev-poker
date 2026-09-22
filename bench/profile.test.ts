import type { JevBackend } from "@jev-poker/agent";
import {
  createMockBackend,
  type DecisionFeatures,
  featuresFromView,
  personaPrompt,
} from "@jev-poker/agent";
import { type PlayerView, parseCards } from "@jev-poker/engine";
import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { getPersona } from "./backend";
import { ProfileTracker } from "./profile";
import { runMatch } from "./runner";
import type { HandAction } from "./types";

const hand = (seat1: HandAction[]): HandAction[] => [
  { street: "preflop", seat: 0, type: "fold" },
  ...seat1,
];

describe("ProfileTracker", () => {
  it("stays silent until enough hands have been seen, then reports rounded percentages", () => {
    const t = new ProfileTracker();
    const seats = new Map([[1, "rules"]]);
    for (let i = 0; i < 19; i++) {
      t.record(hand([{ street: "preflop", seat: 1, type: "fold" }]), seats);
    }
    expect(t.statsFor("rules")).toBeNull();
    t.record(
      hand([
        { street: "preflop", seat: 1, type: "raise", amountBB: 3 },
        { street: "flop", seat: 1, type: "bet", amountBB: 4 },
        { street: "turn", seat: 1, type: "check" },
      ]),
      seats,
    );
    expect(t.statsFor("rules")).toEqual({
      hands: 20,
      vpipPct: 5,
      pfrPct: 5,
      postflopAggressionPct: 50,
    });
    expect(t.statsFor("random")).toBeNull();
  });

  it("ignores seats it was not asked about", () => {
    const t = new ProfileTracker();
    for (let i = 0; i < 25; i++) {
      t.record(
        [{ street: "preflop", seat: 0, type: "raise", amountBB: 3 }],
        new Map([[1, "caller"]]),
      );
    }
    expect(t.statsFor("caller")).toEqual({
      hands: 25,
      vpipPct: 0,
      pfrPct: 0,
      postflopAggressionPct: 0,
    });
  });

  it("counts an all-in as aggression, preflop and postflop", () => {
    // The runner logs a bet or raise that is all in as `allin` (no amount).
    const t = new ProfileTracker();
    const seats = new Map([[1, "random"]]);
    t.record(hand([{ street: "preflop", seat: 1, type: "allin" }]), seats);
    t.record(
      hand([
        { street: "preflop", seat: 1, type: "call" },
        { street: "flop", seat: 1, type: "allin" },
      ]),
      seats,
    );
    expect(t.statsFor("random", 2)).toEqual({
      hands: 2,
      vpipPct: 100,
      pfrPct: 50,
      postflopAggressionPct: 100,
    });
  });
});

describe("opponent statistics in the state", () => {
  const view: PlayerView = {
    seat: 0,
    street: "preflop",
    holeCards: parseCards("Ah Kh"),
    board: [],
    stacks: [0, 1, 2].map((seat) => ({ seat, stack: 10000, isAllIn: false, folded: seat === 2 })),
    pot: 150,
    toCall: 100,
    currentBet: 100,
    committedThisStreet: 0,
    bigBlind: 100,
    position: "BTN",
    history: [],
  };
  const persona = personaPrompt(getPersona("tag"));

  it("lists known live opponents and adds the guidance only then", () => {
    const stats = { hands: 40, vpipPct: 12, pfrPct: 8, postflopAggressionPct: 30 };
    const s = featuresFromView(view, persona, {
      style: "unified",
      opponentStatsFor: (seat) => (seat === 1 ? stats : null),
    });
    expect(s.table.opponentStats).toEqual([{ seat: 1, ...stats }]); // seat 2 folded, seat 0 is the actor
    expect(s.importantContext.some((l) => l.startsWith("opponentStats describes"))).toBe(true);
    const none = featuresFromView(view, persona, {
      style: "unified",
      opponentStatsFor: () => null,
    });
    expect("opponentStats" in none.table).toBe(false);
    expect(none.importantContext.some((l) => l.startsWith("opponentStats describes"))).toBe(false);
    expect(featuresFromView(view, persona)).toEqual(none);
  });
});

describe("runMatch with --profile", () => {
  /** The mock backend, remembering every state it was asked about. */
  function recordingBackend(): JevBackend & { states: DecisionFeatures[] } {
    const mock = createMockBackend();
    const states: DecisionFeatures[] = [];
    return {
      kind: "mock",
      states,
      systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
        states.push(request.state as unknown as DecisionFeatures);
        return mock.systemOne(request);
      },
    };
  }
  const base = {
    opponent: "rules" as const,
    format: "hu" as const,
    seeds: 30,
    baseSeed: 5,
    concurrency: 1,
    persona: getPersona("tag"),
  };

  it("feeds statistics to later hands without changing the deals", async () => {
    const plain = await runMatch({ ...base, backend: createMockBackend() });
    const profiled = await runMatch({ ...base, backend: createMockBackend(), profile: true });
    expect(profiled.hands).toHaveLength(plain.hands.length);
    expect(profiled.hands.map((h) => [h.seedIndex, h.rotation])).toEqual(
      plain.hands.map((h) => [h.seedIndex, h.rotation]),
    );
  });

  it("shows Jev the opponent's statistics once 20 hands are in, and never without the flag", async () => {
    const backend = recordingBackend();
    const { hands } = await runMatch({ ...base, backend, profile: true });
    const withStats = backend.states.filter((s) => s.table.opponentStats !== undefined);
    expect(withStats.length).toBeGreaterThan(0);
    expect(withStats.length).toBeLessThan(backend.states.length);
    // One worker: the hands finish in order, so the first 20 hands see nothing yet.
    const early = hands.slice(0, 20).reduce((n, h) => n + h.decisions.length, 0);
    expect(backend.states.slice(0, early).every((s) => s.table.opponentStats === undefined)).toBe(
      true,
    );
    // One backend call per decision, in order: line every state up with the seat Jev sat in.
    const jevSeats = hands.flatMap((h) => h.decisions.map(() => h.jevSeat));
    expect(jevSeats).toHaveLength(backend.states.length);
    for (const [i, s] of backend.states.entries()) {
      if (s.table.opponentStats === undefined) continue;
      const stats = s.table.opponentStats;
      expect(stats).toHaveLength(1);
      // The statistics describe the opponent's seat, never Jev's own.
      expect(stats[0]?.seat).toBe(1 - (jevSeats[i] ?? 0));
      expect(stats[0]?.hands).toBeGreaterThanOrEqual(20);
      expect(stats[0]?.hands).toBeLessThan(60);
      expect(stats[0]?.vpipPct).toBeGreaterThanOrEqual(stats[0]?.pfrPct ?? 0);
      expect(s.importantContext.some((l) => l.startsWith("opponentStats describes"))).toBe(true);
    }

    const off = recordingBackend();
    await runMatch({ ...base, backend: off });
    expect(off.states.length).toBeGreaterThan(0);
    expect(off.states.every((s) => s.table.opponentStats === undefined)).toBe(true);
  });
});
