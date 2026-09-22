import type { DecisionRecord } from "@jev-poker/agent";
import {
  type Action,
  fixedBlinds,
  type GameConfig,
  type GameEvent,
  type SeatId,
  type Street,
  Table,
} from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import {
  addStats,
  EMPTY_STATS,
  HandStatsTracker,
  opponentTypeOf,
  type PlayerStats,
  ratePct,
  statsKeyFor,
  toOpponentStats,
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

/** An `ActionTaken` as the engine emits it: `allin` is already normalized to call/bet/raise. */
function acted(
  street: Street,
  seat: SeatId,
  type: Action["type"],
  allIn = false,
): Extract<GameEvent, { type: "ActionTaken" }> {
  const action: Action = type === "bet" || type === "raise" ? { type, amount: 10 } : { type };
  return { type: "ActionTaken", street, seat, action, amount: 0, allIn };
}

function handStarted(seats: readonly SeatId[]): GameEvent {
  return {
    type: "HandStarted",
    handNumber: 0,
    button: 0,
    blinds: { small: 1, big: 2, ante: 0 },
    seats: seats.map((id) => ({ id, stack: 100 })),
  };
}

function handEnded(seats: readonly SeatId[]): GameEvent {
  return { type: "HandEnded", handNumber: 0, stacks: seats.map((id) => ({ id, stack: 100 })) };
}

/** The four postflop counters of a seat, in one line. */
function postflop(stats: PlayerStats) {
  const { postflopActions, postflopAggressive, betsFaced, foldsToBet } = stats;
  return { postflopActions, postflopAggressive, betsFaced, foldsToBet };
}

/** Session stats of a player who has lost exactly `bb100` big blinds per 100 hands. */
function losing(
  hands: number,
  bb100: number,
  bigBlind: number,
  overrides: Partial<PlayerStats> = {},
): PlayerStats {
  return {
    ...EMPTY_STATS,
    handsPlayed: hands,
    netChips: (bb100 * bigBlind * hands) / 100,
    ...overrides,
  };
}

/** Counters of a loose passive player: in most pots, rarely raising, rarely folding. */
const CALLER: Partial<PlayerStats> = {
  vpipHands: 60,
  pfrHands: 10,
  postflopActions: 200,
  postflopAggressive: 20,
  betsFaced: 100,
  foldsToBet: 10,
};

/** Counters of a balanced player with no obvious leak. */
const BALANCED: Partial<PlayerStats> = {
  vpipHands: 25,
  pfrHands: 20,
  postflopActions: 100,
  postflopAggressive: 35,
  betsFaced: 50,
  foldsToBet: 25,
};

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

  it("sums the postflop counters like every other field", () => {
    const a: PlayerStats = {
      ...EMPTY_STATS,
      postflopActions: 3,
      postflopAggressive: 1,
      betsFaced: 2,
      foldsToBet: 1,
    };
    const b: PlayerStats = {
      ...EMPTY_STATS,
      postflopActions: 5,
      postflopAggressive: 2,
      betsFaced: 3,
      foldsToBet: 0,
    };
    expect(postflop(addStats(a, b))).toEqual({
      postflopActions: 8,
      postflopAggressive: 3,
      betsFaced: 5,
      foldsToBet: 1,
    });
    // Nothing else moves, and the sum is a full record with every field of `EMPTY_STATS`.
    expect(Object.keys(addStats(a, b)).sort()).toEqual(Object.keys(EMPTY_STATS).sort());
  });
});

describe("toOpponentStats", () => {
  it("turns the counters into rounded percentages", () => {
    const stats: PlayerStats = {
      ...EMPTY_STATS,
      handsPlayed: 3,
      vpipHands: 1,
      pfrHands: 2,
      postflopActions: 3,
      postflopAggressive: 2,
      betsFaced: 3,
      foldsToBet: 1,
    };
    expect(toOpponentStats(stats)).toEqual({
      hands: 3,
      vpipPct: 33,
      pfrPct: 67,
      postflopAggressionPct: 67,
      foldToBetPct: 33,
    });
  });

  it("leaves foldToBetPct out until a bet has been faced, and never divides by zero", () => {
    expect(toOpponentStats(EMPTY_STATS)).toEqual({
      hands: 0,
      vpipPct: 0,
      pfrPct: 0,
      postflopAggressionPct: 0,
    });
    const checked = { ...EMPTY_STATS, handsPlayed: 4, postflopActions: 2 };
    expect("foldToBetPct" in toOpponentStats(checked)).toBe(false);
    expect(toOpponentStats({ ...checked, betsFaced: 1 }).foldToBetPct).toBe(0);
  });
});

describe("opponentTypeOf", () => {
  const BB = 2;

  it("stays silent below 100 hands, however much the player has lost", () => {
    expect(opponentTypeOf(losing(99, -150, BB, CALLER), BB)).toBeNull();
    expect(opponentTypeOf(losing(50, -400, BB, CALLER), BB)).toBeNull();
  });

  it("stays silent at -149 bb/100 and opens at exactly -150 with 100 hands", () => {
    expect(opponentTypeOf(losing(100, -149, BB, CALLER), BB)).toBeNull();
    expect(opponentTypeOf(losing(100, -150, BB, CALLER), BB)).toBe("calling_station");
    expect(opponentTypeOf(losing(120, -200, BB, CALLER), BB)).toBe("calling_station");
  });

  it("stays silent for a winning or break-even player", () => {
    expect(opponentTypeOf(losing(200, 0, BB, CALLER), BB)).toBeNull();
    expect(opponentTypeOf(losing(200, 150, BB, CALLER), BB)).toBeNull();
  });

  it("returns null without hands or without a big blind to measure in", () => {
    expect(opponentTypeOf({ ...EMPTY_STATS, netChips: -500 }, BB)).toBeNull();
    expect(opponentTypeOf(losing(100, -150, BB, CALLER), 0)).toBeNull();
    expect(opponentTypeOf(losing(100, -150, BB, CALLER), -2)).toBeNull();
  });

  it("measures the loss in the big blind it was given", () => {
    // -300 chips over 100 hands is -150 bb/100 at a 2-chip blind but only -30 at a 10-chip one.
    const stats = losing(100, -150, 2, CALLER);
    expect(opponentTypeOf(stats, 2)).toBe("calling_station");
    expect(opponentTypeOf(stats, 10)).toBeNull();
  });

  it("classifies a losing player by the thresholds over the session counters", () => {
    expect(opponentTypeOf(losing(100, -150, BB, BALANCED), BB)).toBe("regular");
    const nit = { ...BALANCED, vpipHands: 12, pfrHands: 8 };
    expect(opponentTypeOf(losing(100, -150, BB, nit), BB)).toBe("nit");
    const maniac = { ...BALANCED, vpipHands: 70, pfrHands: 50 };
    expect(opponentTypeOf(losing(100, -150, BB, maniac), BB)).toBe("maniac");
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

  it("counts postflop actions, aggression and bets faced per seat", () => {
    const seats: SeatId[] = [0, 1, 2];
    const deltas = track([
      handStarted(seats),
      // Preflop never counts: neither as an action, nor as a bet faced.
      acted("preflop", 0, "raise"),
      acted("preflop", 1, "call"),
      acted("preflop", 2, "call"),
      { type: "StreetDealt", street: "flop", board: [] },
      acted("flop", 1, "check"),
      acted("flop", 2, "bet"),
      acted("flop", 0, "raise"),
      acted("flop", 1, "fold"),
      acted("flop", 2, "call"),
      { type: "StreetDealt", street: "turn", board: [] },
      acted("turn", 2, "check"),
      acted("turn", 0, "bet"),
      acted("turn", 2, "fold"),
      handEnded(seats),
    ]);
    // Seat 0: raised a bet on the flop, bet into a check on the turn.
    expect(postflop(statsOf(deltas, 0))).toEqual({
      postflopActions: 2,
      postflopAggressive: 2,
      betsFaced: 1,
      foldsToBet: 0,
    });
    // Seat 1: a check faces nothing; the fold faced the raise and gave up.
    expect(postflop(statsOf(deltas, 1))).toEqual({
      postflopActions: 2,
      postflopAggressive: 0,
      betsFaced: 1,
      foldsToBet: 1,
    });
    // Seat 2: bet, called the raise, checked, then folded to the turn bet.
    expect(postflop(statsOf(deltas, 2))).toEqual({
      postflopActions: 4,
      postflopAggressive: 1,
      betsFaced: 2,
      foldsToBet: 1,
    });
  });

  it("ignores a hand that never saw a flop", () => {
    const seats: SeatId[] = [0, 1];
    const deltas = track([
      handStarted(seats),
      acted("preflop", 0, "bet"),
      acted("preflop", 1, "raise"),
      acted("preflop", 0, "fold"),
      handEnded(seats),
    ]);
    for (const seat of seats) {
      expect(postflop(statsOf(deltas, seat))).toEqual({
        postflopActions: 0,
        postflopAggressive: 0,
        betsFaced: 0,
        foldsToBet: 0,
      });
    }
    // The preflop aggression still shows up where it belongs.
    expect(statsOf(deltas, 1)).toMatchObject({ vpipHands: 1, pfrHands: 1 });
  });

  it("treats an all-in call as a bet faced and an all-in shove as aggression", () => {
    const seats: SeatId[] = [0, 1];
    const deltas = track([
      handStarted(seats),
      { type: "StreetDealt", street: "flop", board: [] },
      // The engine normalizes a shove to a bet or raise and flags it with `allIn`.
      acted("flop", 0, "bet", true),
      acted("flop", 1, "call", true),
      handEnded(seats),
    ]);
    expect(postflop(statsOf(deltas, 0))).toEqual({
      postflopActions: 1,
      postflopAggressive: 1,
      betsFaced: 0,
      foldsToBet: 0,
    });
    expect(postflop(statsOf(deltas, 1))).toEqual({
      postflopActions: 1,
      postflopAggressive: 0,
      betsFaced: 1,
      foldsToBet: 0,
    });
    expect(statsOf(deltas, 0).allIns).toBe(1);
    expect(statsOf(deltas, 1).allIns).toBe(1);
  });

  it("starts the postflop counters from zero on the next hand", () => {
    const seats: SeatId[] = [0, 1];
    const tracker = new HandStatsTracker();
    const first: GameEvent[] = [
      handStarted(seats),
      { type: "StreetDealt", street: "flop", board: [] },
      acted("flop", 0, "bet"),
      acted("flop", 1, "fold"),
      handEnded(seats),
    ];
    for (const event of first) tracker.onEvent(event);
    const one = tracker.flush();
    expect(postflop(statsOf(one, 0))).toMatchObject({ postflopActions: 1, postflopAggressive: 1 });
    expect(postflop(statsOf(one, 1))).toMatchObject({ betsFaced: 1, foldsToBet: 1 });

    const second: GameEvent[] = [
      handStarted(seats),
      { type: "StreetDealt", street: "flop", board: [] },
      acted("flop", 1, "check"),
      acted("flop", 0, "check"),
      handEnded(seats),
    ];
    for (const event of second) tracker.onEvent(event);
    const two = tracker.flush();
    for (const seat of seats) {
      expect(postflop(statsOf(two, seat))).toEqual({
        postflopActions: 1,
        postflopAggressive: 0,
        betsFaced: 0,
        foldsToBet: 0,
      });
    }
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
      expect(stats.postflopAggressive).toBeLessThanOrEqual(stats.postflopActions);
      expect(stats.foldsToBet).toBeLessThanOrEqual(stats.betsFaced);
      expect(stats.betsFaced).toBeLessThanOrEqual(stats.postflopActions);
    }
    // Rebuys are excluded, so the net chips of a closed table always sum to zero.
    const net = [...totals.values()].reduce((sum, s) => sum + s.netChips, 0);
    expect(net).toBe(0);
    const won = [...totals.values()].reduce((sum, s) => sum + s.handsWon, 0);
    expect(won).toBeGreaterThanOrEqual(3);
  });
});
