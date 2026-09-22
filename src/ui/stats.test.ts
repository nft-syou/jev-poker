import type { DecisionRecord } from "@jev-poker/agent";
import {
  fixedBlinds,
  type GameConfig,
  type GameEvent,
  type SeatId,
  Table,
} from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import {
  addStats,
  EMPTY_STATS,
  HandStatsTracker,
  type PlayerStats,
  ratePct,
  statsKeyFor,
} from "./stats";

const VALUE = { category: "pair", ranks: [14, 13], score: 1 } as const;
const CARDS = [
  { rank: 14, suit: "s" },
  { rank: 13, suit: "s" },
] as const;

/** Feeds the events of a single hand (and its decisions) to a fresh tracker. */
function track(
  events: readonly GameEvent[],
  decisions: readonly (DecisionRecord & { prefetched?: boolean })[] = [],
) {
  const tracker = new HandStatsTracker();
  for (const event of events) {
    tracker.onEvent(event);
    // Decisions reach the tracker while the hand runs, i.e. after it has started.
    if (event.type === "HandStarted")
      for (const decision of decisions) tracker.onDecision(decision, decision.prefetched === true);
  }
  return tracker.flush();
}

function statsOf(deltas: ReadonlyMap<SeatId, PlayerStats>, seat: SeatId): PlayerStats {
  const stats = deltas.get(seat);
  if (stats === undefined) throw new Error(`no stats for seat ${seat}`);
  return stats;
}

function jevAnswer(bluffIntent: number): NonNullable<DecisionRecord["jev"]> {
  return {
    chosen: "check_or_call",
    probabilities: { check_or_call: 1 },
    sizingScore: 1,
    bluffIntent,
    model: "mock",
  };
}

function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    seat: 0,
    action: { type: "check" },
    jev: jevAnswer(0.5),
    error: null,
    errorKind: null,
    fallback: false,
    latencyMs: 100,
    ...overrides,
  };
}

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    format: "cash",
    blinds: fixedBlinds(5, 10),
    startingStack: 200,
    seats: [
      { id: 0, name: "A", kind: "cpu" },
      { id: 1, name: "B", kind: "cpu" },
      { id: 2, name: "C", kind: "cpu" },
    ],
    seed: 11,
    ...overrides,
  };
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

describe("statsKeyFor", () => {
  it("keys CPUs by persona and humans by name", () => {
    expect(statsKeyFor({ kind: "cpu", name: "Rocky", personaId: "rock" })).toBe("persona:rock");
    expect(statsKeyFor({ kind: "human", name: "You", personaId: "tag" })).toBe("human:You");
    expect(statsKeyFor({ kind: "cpu", name: "Nameless" })).toBe("persona:unknown");
  });
});

describe("ratePct", () => {
  it("rounds a percentage and returns null for an empty denominator", () => {
    expect(ratePct(1, 3)).toBe(33);
    expect(ratePct(2, 3)).toBe(67);
    expect(ratePct(0, 4)).toBe(0);
    expect(ratePct(3, 0)).toBeNull();
  });
});

describe("addStats", () => {
  it("adds every field and leaves the inputs alone", () => {
    const a: PlayerStats = { ...EMPTY_STATS, handsPlayed: 1, netChips: -10, jevLatencyMs: 40 };
    const b: PlayerStats = { ...EMPTY_STATS, handsPlayed: 2, netChips: 25, jevBluffSum: 0.5 };
    expect(addStats(a, b)).toEqual({
      ...EMPTY_STATS,
      handsPlayed: 3,
      netChips: 15,
      jevLatencyMs: 40,
      jevBluffSum: 0.5,
    });
    expect(a.handsPlayed).toBe(1);
    expect(b.netChips).toBe(25);
  });
});

describe("HandStatsTracker", () => {
  it("counts a preflop call as VPIP and a preflop raise as VPIP + PFR, blinds excluded", () => {
    const deltas = track([
      {
        type: "HandStarted",
        handNumber: 0,
        button: 0,
        blinds: { small: 1, big: 2, ante: 0 },
        seats: [
          { id: 0, stack: 100 },
          { id: 1, stack: 100 },
          { id: 2, stack: 100 },
        ],
      },
      {
        type: "BlindsPosted",
        posts: [
          { seat: 1, kind: "small", amount: 1 },
          { seat: 2, kind: "big", amount: 2 },
        ],
      },
      {
        type: "ActionTaken",
        street: "preflop",
        seat: 0,
        action: { type: "raise", amount: 6 },
        amount: 6,
        allIn: false,
      },
      {
        type: "ActionTaken",
        street: "preflop",
        seat: 1,
        action: { type: "call" },
        amount: 5,
        allIn: false,
      },
      {
        type: "ActionTaken",
        street: "preflop",
        seat: 2,
        action: { type: "fold" },
        amount: 0,
        allIn: false,
      },
      { type: "StreetDealt", street: "flop", board: [] },
      {
        type: "ActionTaken",
        street: "flop",
        seat: 1,
        action: { type: "bet", amount: 10 },
        amount: 10,
        allIn: false,
      },
      {
        type: "ActionTaken",
        street: "flop",
        seat: 0,
        action: { type: "fold" },
        amount: 0,
        allIn: false,
      },
      { type: "PotAwarded", pots: [], awards: [{ seat: 1, amount: 15, potIndex: 0 }] },
      {
        type: "HandEnded",
        handNumber: 0,
        stacks: [
          { id: 0, stack: 94 },
          { id: 1, stack: 105 },
          { id: 2, stack: 98 },
        ],
      },
    ]);

    expect(statsOf(deltas, 0)).toMatchObject({
      handsPlayed: 1,
      vpipHands: 1,
      pfrHands: 1,
      handsWon: 0,
      netChips: -6,
    });
    // Seat 1 called preflop (VPIP) and only raised after the flop, so no PFR.
    expect(statsOf(deltas, 1)).toMatchObject({
      handsPlayed: 1,
      vpipHands: 1,
      pfrHands: 0,
      handsWon: 1,
      netChips: 5,
    });
    // Seat 2 only posted the big blind and folded: neither VPIP nor PFR.
    expect(statsOf(deltas, 2)).toMatchObject({
      handsPlayed: 1,
      vpipHands: 0,
      pfrHands: 0,
      handsWon: 0,
      netChips: -2,
    });
    // Without a Showdown event nobody reached one, winner included.
    expect(statsOf(deltas, 1).showdowns).toBe(0);
    expect(statsOf(deltas, 1).showdownsWon).toBe(0);
  });

  it("counts showdowns, all-ins and rebuys, and excludes the rebuy from netChips", () => {
    const deltas = track([
      {
        type: "HandStarted",
        handNumber: 3,
        button: 0,
        blinds: { small: 1, big: 2, ante: 0 },
        seats: [
          { id: 0, stack: 100 },
          { id: 1, stack: 60 },
        ],
      },
      {
        type: "ActionTaken",
        street: "preflop",
        seat: 1,
        action: { type: "raise", amount: 60 },
        amount: 59,
        allIn: true,
      },
      {
        type: "ActionTaken",
        street: "preflop",
        seat: 0,
        action: { type: "call" },
        amount: 58,
        allIn: false,
      },
      {
        type: "Showdown",
        hands: [
          { seat: 0, cards: CARDS, value: VALUE },
          { seat: 1, cards: CARDS, value: VALUE },
        ],
      },
      { type: "PotAwarded", pots: [], awards: [{ seat: 0, amount: 120, potIndex: 0 }] },
      { type: "SeatRebought", seat: 1, amount: 200 },
      {
        type: "HandEnded",
        handNumber: 3,
        stacks: [
          { id: 0, stack: 160 },
          { id: 1, stack: 200 },
        ],
      },
    ]);

    expect(statsOf(deltas, 0)).toMatchObject({
      showdowns: 1,
      showdownsWon: 1,
      handsWon: 1,
      allIns: 0,
      rebuys: 0,
      netChips: 60,
    });
    expect(statsOf(deltas, 1)).toMatchObject({
      showdowns: 1,
      showdownsWon: 0,
      handsWon: 0,
      allIns: 1,
      rebuys: 1,
      netChips: -60,
    });
  });

  it("aggregates the Jev decision records", () => {
    const deltas = track(
      [
        {
          type: "HandStarted",
          handNumber: 0,
          button: 0,
          blinds: { small: 1, big: 2, ante: 0 },
          seats: [
            { id: 0, stack: 100 },
            { id: 1, stack: 100 },
          ],
        },
        { type: "HandEnded", handNumber: 0, stacks: [{ id: 0, stack: 100 }] },
      ],
      [
        decision({ seat: 0, latencyMs: 100 }),
        decision({ seat: 0, latencyMs: 50, jev: null, fallback: true }),
        decision({ seat: 1, latencyMs: 20, jev: jevAnswer(0.25) }),
      ],
    );
    // The fallback contributes a decision and its latency but no bluff intent.
    expect(statsOf(deltas, 0)).toMatchObject({
      jevDecisions: 2,
      jevFallbacks: 1,
      jevLatencyMs: 150,
      jevWaitMs: 150,
      jevBluffSum: 0.5,
    });
    expect(statsOf(deltas, 1)).toMatchObject({
      jevDecisions: 1,
      jevFallbacks: 0,
      jevLatencyMs: 20,
      jevWaitMs: 20,
      jevBluffSum: 0.25,
    });
  });

  it("keeps a prefetched answer out of what the table waited for", () => {
    const deltas = track(
      [
        {
          type: "HandStarted",
          handNumber: 0,
          button: 0,
          blinds: { small: 1, big: 2, ante: 0 },
          seats: [{ id: 0, stack: 100 }],
        },
        { type: "HandEnded", handNumber: 0, stacks: [{ id: 0, stack: 100 }] },
      ],
      [
        // Answered in the background while another seat acted: the table never waited.
        { ...decision({ seat: 0, latencyMs: 900 }), prefetched: true },
        decision({ seat: 0, latencyMs: 120 }),
      ],
    );
    expect(statsOf(deltas, 0)).toMatchObject({
      jevDecisions: 2,
      // Jev still took 1020 ms of thinking; only 120 ms of it held the table up.
      jevLatencyMs: 1020,
      jevWaitMs: 120,
    });
  });

  it("counts the decisions Jev answered with a bet or raise", () => {
    const aggressive = { ...jevAnswer(0.4), chosen: "bet_or_raise" as const };
    const deltas = track(
      [
        {
          type: "HandStarted",
          handNumber: 0,
          button: 0,
          blinds: { small: 1, big: 2, ante: 0 },
          seats: [
            { id: 0, stack: 100 },
            { id: 1, stack: 100 },
          ],
        },
        { type: "HandEnded", handNumber: 0, stacks: [{ id: 0, stack: 100 }] },
      ],
      [
        decision({ seat: 0, jev: aggressive }),
        decision({ seat: 0 }),
        // A fallback is nobody's aggression: Jev never answered it.
        decision({ seat: 1, jev: null, fallback: true }),
      ],
    );
    expect(statsOf(deltas, 0)).toMatchObject({ jevDecisions: 2, jevRaises: 1 });
    expect(statsOf(deltas, 1)).toMatchObject({ jevDecisions: 1, jevRaises: 0 });
  });

  it("resets between hands and conserves chips over a real table", () => {
    const table = new Table(config());
    const tracker = new HandStatsTracker();
    const totals = new Map<SeatId, PlayerStats>();
    table.on((event) => {
      tracker.onEvent(event);
      if (event.type !== "HandEnded") return;
      for (const [seat, delta] of tracker.flush()) {
        totals.set(seat, addStats(totals.get(seat) ?? EMPTY_STATS, delta));
      }
    });
    for (let i = 0; i < 3; i++) {
      table.startHand();
      shoveOut(table);
    }

    expect([...totals.keys()].sort()).toEqual([0, 1, 2]);
    for (const stats of totals.values()) {
      expect(stats.handsPlayed).toBe(3);
      expect(stats.showdowns).toBeGreaterThan(0);
      expect(stats.vpipHands).toBeLessThanOrEqual(stats.handsPlayed);
    }
    // Rebuys are excluded, so the net chips of a closed table always sum to zero.
    const net = [...totals.values()].reduce((sum, s) => sum + s.netChips, 0);
    expect(net).toBe(0);
    const won = [...totals.values()].reduce((sum, s) => sum + s.handsWon, 0);
    expect(won).toBeGreaterThanOrEqual(3);
  });
});
