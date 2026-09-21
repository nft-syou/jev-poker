import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { type PlayerView, parseCards } from "../src/engine";
import type { JevBackend } from "../src/jev/backend";
import { type DecisionFeatures, featuresFromView } from "../src/jev/features";
import { createMockBackend } from "../src/jev/mock-backend";
import type { OpponentStats, OpponentType } from "../src/jev/opponent-type";
import { personaPrompt } from "../src/jev/personas";
import { getPersona } from "./backend";
import { JevTypeLabeler, ProfileTracker } from "./profile";
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

/** `n` copies of one hand for the given seats. */
function recordTimes(
  t: ProfileTracker,
  n: number,
  players: ReadonlyMap<number, string>,
  actions: HandAction[],
): void {
  for (let i = 0; i < n; i++) t.record(actions, players);
}

const callsDown = (seat: number): HandAction[] => [
  { street: "preflop", seat, type: "call" },
  { street: "flop", seat, type: "call" },
];
const foldsPreflop = (seat: number): HandAction[] => [{ street: "preflop", seat, type: "fold" }];
const firesAway = (seat: number): HandAction[] => [
  { street: "preflop", seat, type: "raise", amountBB: 3 },
  { street: "flop", seat, type: "bet", amountBB: 4 },
];

describe("ProfileTracker player ids", () => {
  it("keeps two players of the same kind apart at a mixed table", () => {
    const t = new ProfileTracker();
    const players = new Map([
      [0, "rules@0"],
      [5, "rules@4"],
    ]);
    recordTimes(t, 20, players, [...callsDown(0), ...foldsPreflop(5)]);
    expect(t.playerIds().sort()).toEqual(["rules@0", "rules@4"]);
    expect(t.statsFor("rules@0")).toMatchObject({ hands: 20, vpipPct: 100, pfrPct: 0 });
    expect(t.statsFor("rules@4")).toMatchObject({ hands: 20, vpipPct: 0, pfrPct: 0 });
    // The kind on its own is not a player at this table.
    expect(t.statsFor("rules")).toBeNull();
    expect(t.typeFor("rules")).toBeNull();
  });

  it("follows a player from seat to seat as the hero rotates", () => {
    const t = new ProfileTracker();
    recordTimes(t, 10, new Map([[1, "caller@1"]]), callsDown(1));
    recordTimes(t, 10, new Map([[2, "caller@1"]]), callsDown(2));
    // Seat 1 is somebody else now; what that seat does is theirs.
    recordTimes(
      t,
      10,
      new Map([
        [1, "rules@0"],
        [2, "caller@1"],
      ]),
      [...foldsPreflop(1), ...callsDown(2)],
    );
    expect(t.statsFor("caller@1")).toMatchObject({ hands: 30, vpipPct: 100 });
    expect(t.statsFor("rules@0", 10)).toMatchObject({ hands: 10, vpipPct: 0 });
  });

  it("pools the seats of a single-kind table into one player", () => {
    const t = new ProfileTracker();
    const players = new Map([
      [1, "rules"],
      [2, "rules"],
      [3, "rules"],
    ]);
    recordTimes(t, 7, players, [...callsDown(1), ...foldsPreflop(2), ...firesAway(3)]);
    expect(t.playerIds()).toEqual(["rules"]);
    // 7 hands x 3 seats: one of the three enters by calling, one by raising.
    expect(t.statsFor("rules")).toEqual({
      hands: 21,
      vpipPct: 67,
      pfrPct: 33,
      postflopAggressionPct: 50,
      foldToBetPct: 0,
    });
  });

  it("lists nobody before the first hand", () => {
    expect(new ProfileTracker().playerIds()).toEqual([]);
  });

  it("uses 20 hands as the default minimum and honours an explicit one", () => {
    const t = new ProfileTracker();
    const players = new Map([[1, "random@2"]]);
    recordTimes(t, 19, players, foldsPreflop(1));
    expect(t.statsFor("random@2")).toBeNull();
    expect(t.statsFor("random@2", 19)).toMatchObject({ hands: 19 });
    expect(t.statsFor("random@2", 1)).toMatchObject({ hands: 19 });
    recordTimes(t, 1, players, foldsPreflop(1));
    expect(t.statsFor("random@2")).toMatchObject({ hands: 20 });
    expect(t.statsFor("random@2", 21)).toBeNull();
  });
});

describe("ProfileTracker foldToBetPct", () => {
  const seats = new Map([[1, "p"]]);
  const post = (...types: HandAction["type"][]): HandAction[] => [
    { street: "preflop", seat: 1, type: "call" },
    ...types.map((type, i): HandAction => {
      const street = (["flop", "turn", "river"] as const)[i % 3] ?? "flop";
      return type === "bet" || type === "raise"
        ? { street, seat: 1, type, amountBB: 4 }
        : { street, seat: 1, type };
    }),
  ];

  it("is the share of postflop folds among folds, calls and raises", () => {
    const t = new ProfileTracker();
    t.record(post("call", "call", "fold"), seats);
    t.record(post("raise"), seats);
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(25);
    t.record(post("fold"), seats);
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(40);
  });

  it("rounds to a whole percentage", () => {
    const t = new ProfileTracker();
    t.record(post("call", "call", "fold"), seats);
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(33);
    const u = new ProfileTracker();
    u.record(post("call", "fold"), seats);
    u.record(post("fold"), seats);
    expect(u.statsFor("p", 1)?.foldToBetPct).toBe(67);
  });

  it("is 0 for a player who never folds to a bet and 100 for one who always does", () => {
    const t = new ProfileTracker();
    recordTimes(t, 3, seats, post("call", "call", "call"));
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(0);
    const u = new ProfileTracker();
    recordTimes(u, 3, seats, post("fold"));
    expect(u.statsFor("p", 1)?.foldToBetPct).toBe(100);
  });

  it("is absent until the player has faced a postflop bet", () => {
    const t = new ProfileTracker();
    // Preflop folds and calls answer a bet too, but only postflop ones are counted.
    t.record(foldsPreflop(1), seats);
    t.record([{ street: "preflop", seat: 1, type: "call" }], seats);
    t.record(
      [
        { street: "preflop", seat: 1, type: "raise", amountBB: 3 },
        { street: "preflop", seat: 1, type: "fold" },
      ],
      seats,
    );
    const stats = t.statsFor("p", 1);
    expect(stats).toEqual({ hands: 3, vpipPct: 67, pfrPct: 33, postflopAggressionPct: 0 });
    expect(stats !== null && "foldToBetPct" in stats).toBe(false);
  });

  it("does not count a check, a bet or an all-in as facing a bet", () => {
    const t = new ProfileTracker();
    t.record(post("check", "bet", "allin"), seats);
    const stats = t.statsFor("p", 1);
    expect(stats).toEqual({ hands: 1, vpipPct: 100, pfrPct: 0, postflopAggressionPct: 67 });
    expect(stats !== null && "foldToBetPct" in stats).toBe(false);
    // They do not dilute the share once a bet has been faced either.
    t.record(post("check", "fold"), seats);
    t.record(post("bet", "call"), seats);
    t.record(post("check", "allin"), seats);
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(50);
  });

  it("ignores what other seats did", () => {
    const t = new ProfileTracker();
    t.record(
      [
        { street: "flop", seat: 0, type: "bet", amountBB: 2 },
        { street: "flop", seat: 1, type: "call" },
        { street: "turn", seat: 0, type: "fold" },
        { street: "turn", seat: 2, type: "fold" },
      ],
      seats,
    );
    expect(t.statsFor("p", 1)?.foldToBetPct).toBe(0);
  });
});

describe("ProfileTracker typeFor", () => {
  it("classifies each player by the thresholds over its own statistics", () => {
    const t = new ProfileTracker();
    const players = new Map([
      [0, "caller@1"],
      [1, "rules@0"],
      [2, "random@2"],
      [3, "heuristic@3"],
    ]);
    const mixedBag = (i: number): HandAction[] =>
      // 25% VPIP, all of it raised: neither loose, tight nor wild.
      i % 4 === 0
        ? [
            { street: "preflop", seat: 3, type: "raise", amountBB: 3 },
            { street: "flop", seat: 3, type: "check" },
          ]
        : foldsPreflop(3);
    for (let i = 0; i < 20; i++) {
      t.record([...callsDown(0), ...foldsPreflop(1), ...firesAway(2), ...mixedBag(i)], players);
    }
    expect(t.typeFor("caller@1")).toBe("calling_station");
    expect(t.typeFor("rules@0")).toBe("nit");
    expect(t.typeFor("random@2")).toBe("maniac");
    expect(t.statsFor("heuristic@3")).toMatchObject({ vpipPct: 25, pfrPct: 25 });
    expect(t.typeFor("heuristic@3")).toBe("regular");
  });

  it("is null below 20 hands and for a player it has never seen", () => {
    const t = new ProfileTracker();
    const players = new Map([[0, "caller@1"]]);
    recordTimes(t, 19, players, callsDown(0));
    expect(t.typeFor("caller@1")).toBeNull();
    expect(t.typeFor("nobody")).toBeNull();
    recordTimes(t, 1, players, callsDown(0));
    expect(t.typeFor("caller@1")).toBe("calling_station");
  });

  it("follows the player as its play changes", () => {
    const t = new ProfileTracker();
    const players = new Map([[0, "p"]]);
    recordTimes(t, 20, players, foldsPreflop(0));
    expect(t.typeFor("p")).toBe("nit");
    recordTimes(t, 60, players, firesAway(0));
    expect(t.typeFor("p")).toBe("maniac");
  });
});

interface LabelRequest {
  opponent: OpponentStats;
  model: string | undefined;
}

/**
 * A backend for the classification question only. `answer` decides per request; returning an
 * `Error` makes the request fail. With `hold`, requests wait until `release()` is called.
 */
function labelBackend(
  answer: (opponent: OpponentStats) => OpponentType | Error,
  hold = false,
): JevBackend & { requests: LabelRequest[]; release: () => void } {
  const requests: LabelRequest[] = [];
  let open: () => void = () => {};
  const gate = hold
    ? new Promise<void>((resolve) => {
        open = resolve;
      })
    : Promise.resolve();
  return {
    kind: "mock",
    requests,
    release: () => open(),
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      expect(Object.keys(request.questions)).toEqual(["opponent_type"]);
      const { opponent } = request.state as unknown as { opponent: OpponentStats };
      requests.push({ opponent, model: request.model });
      await gate;
      const result = answer(opponent);
      if (result instanceof Error) throw result;
      return {
        model: "stub",
        answers: {
          opponent_type: { type: "choice", choice: result, confidence: 1, probabilities: {} },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

describe("JevTypeLabeler", () => {
  const p = new Map([[0, "p"]]);

  it("knows nothing, and asks nothing, until a player has statistics", async () => {
    const t = new ProfileTracker();
    const backend = labelBackend(() => "nit");
    const labeler = new JevTypeLabeler(t, backend);
    await labeler.refresh();
    expect(labeler.typeFor("p")).toBeNull();
    recordTimes(t, 19, p, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.typeFor("p")).toBeNull();
    expect(labeler.calls).toBe(0);
    expect(backend.requests).toHaveLength(0);
  });

  it("asks as soon as the statistics exist, then again only every 25 more hands", async () => {
    const t = new ProfileTracker();
    // Jev's verdict is its own: it need not agree with the thresholds.
    const backend = labelBackend((o) => (o.hands < 45 ? "regular" : "maniac"));
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 20, p, foldsPreflop(0));
    expect(labeler.typeFor("p")).toBeNull(); // reading a label never asks
    await labeler.refresh();
    expect(labeler.calls).toBe(1);
    expect(labeler.typeFor("p")).toBe("regular");
    expect(t.typeFor("p")).toBe("nit");

    await labeler.refresh();
    await labeler.refresh();
    expect(labeler.calls).toBe(1);
    for (let hands = 21; hands <= 44; hands++) {
      recordTimes(t, 1, p, foldsPreflop(0));
      await labeler.refresh();
    }
    expect(labeler.calls).toBe(1);
    expect(labeler.typeFor("p")).toBe("regular");

    recordTimes(t, 1, p, foldsPreflop(0)); // hand 45 = 20 + 25
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    expect(labeler.typeFor("p")).toBe("maniac");
    expect(backend.requests.map((r) => r.opponent.hands)).toEqual([20, 45]);

    recordTimes(t, 24, p, foldsPreflop(0)); // 69
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    recordTimes(t, 1, p, foldsPreflop(0)); // 70
    await labeler.refresh();
    expect(labeler.calls).toBe(3);
  });

  it("counts the 25 hands from the sample it last asked about, not from hand 20", async () => {
    const t = new ProfileTracker();
    const backend = labelBackend(() => "nit");
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 33, p, foldsPreflop(0));
    await labeler.refresh();
    recordTimes(t, 24, p, foldsPreflop(0)); // 57
    await labeler.refresh();
    expect(labeler.calls).toBe(1);
    recordTimes(t, 1, p, foldsPreflop(0)); // 58 = 33 + 25
    await labeler.refresh();
    expect(backend.requests.map((r) => r.opponent.hands)).toEqual([33, 58]);
  });

  it("sends each player's own statistics, and the model when it has one", async () => {
    const t = new ProfileTracker();
    const players = new Map([
      [0, "caller@1"],
      [1, "rules@0"],
      [2, "rules@4"],
    ]);
    recordTimes(t, 20, players, [...callsDown(0), ...foldsPreflop(1), ...firesAway(2)]);
    recordTimes(t, 5, new Map([[3, "random@2"]]), firesAway(3)); // too few hands to be asked about
    const backend = labelBackend((o) =>
      o.vpipPct === 0 ? "nit" : o.pfrPct === 0 ? "calling_station" : "maniac",
    );
    const labeler = new JevTypeLabeler(t, backend, "jev-x");
    await labeler.refresh();
    expect(labeler.calls).toBe(3);
    const sent = backend.requests.map((r) => r.opponent);
    expect(sent).toHaveLength(3);
    for (const id of ["caller@1", "rules@0", "rules@4"]) {
      expect(sent).toContainEqual(t.statsFor(id));
    }
    expect(new Set(sent.map((o) => JSON.stringify(o))).size).toBe(3);
    expect(backend.requests.every((r) => r.model === "jev-x")).toBe(true);
    expect(labeler.typeFor("caller@1")).toBe("calling_station");
    expect(labeler.typeFor("rules@0")).toBe("nit");
    expect(labeler.typeFor("rules@4")).toBe("maniac");
    expect(labeler.typeFor("random@2")).toBeNull();
    expect(labeler.typeFor("hero")).toBeNull();

    const plain = labelBackend(() => "nit");
    await new JevTypeLabeler(t, plain).refresh();
    expect(plain.requests.every((r) => r.model === undefined)).toBe(true);
  });

  it("keeps the previous label when a request fails, and waits 25 hands before retrying", async () => {
    const t = new ProfileTracker();
    let down = false;
    const backend = labelBackend(() => (down ? new Error("backend down") : "calling_station"));
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 20, p, callsDown(0));
    await labeler.refresh();
    expect(labeler.typeFor("p")).toBe("calling_station");

    down = true;
    recordTimes(t, 25, p, callsDown(0)); // 45: due again, and the backend is down
    await expect(labeler.refresh()).resolves.toBeUndefined();
    expect(labeler.calls).toBe(2); // the failed request was still a request
    expect(labeler.typeFor("p")).toBe("calling_station");

    recordTimes(t, 24, p, callsDown(0)); // 69
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    down = false;
    await labeler.refresh();
    expect(labeler.calls).toBe(2); // not retried just because the backend is back
    recordTimes(t, 1, p, callsDown(0)); // 70 = 45 + 25
    await labeler.refresh();
    expect(labeler.calls).toBe(3);
    expect(labeler.typeFor("p")).toBe("calling_station");
  });

  it("stays without a label when the very first request fails, until 25 more hands", async () => {
    const t = new ProfileTracker();
    let down = true;
    const backend = labelBackend(() => (down ? new Error("backend down") : "nit"));
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 20, p, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(1);
    expect(labeler.typeFor("p")).toBeNull();
    down = false;
    for (let hands = 21; hands <= 44; hands++) {
      recordTimes(t, 1, p, foldsPreflop(0));
      await labeler.refresh();
    }
    expect(labeler.calls).toBe(1);
    expect(labeler.typeFor("p")).toBeNull();
    recordTimes(t, 1, p, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    expect(labeler.typeFor("p")).toBe("nit");
  });

  it("treats an answer that is not a type like a failure", async () => {
    const t = new ProfileTracker();
    let answer = "nit";
    const backend = labelBackend(() => answer as OpponentType);
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 20, p, foldsPreflop(0));
    await labeler.refresh();
    answer = "shark";
    recordTimes(t, 25, p, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    expect(labeler.typeFor("p")).toBe("nit");
  });

  it("does not ask twice for the same player when refreshes overlap", async () => {
    const t = new ProfileTracker();
    const players = new Map([
      [0, "caller@1"],
      [1, "rules@0"],
    ]);
    recordTimes(t, 20, players, [...callsDown(0), ...foldsPreflop(1)]);
    const backend = labelBackend((o) => (o.vpipPct === 0 ? "nit" : "calling_station"), true);
    const labeler = new JevTypeLabeler(t, backend);
    const first = labeler.refresh();
    const second = labeler.refresh();
    // More hands finish while the requests are in flight; a third worker refreshes too.
    recordTimes(t, 30, players, [...callsDown(0), ...foldsPreflop(1)]);
    const third = labeler.refresh();
    expect(labeler.calls).toBe(2);
    expect(backend.requests).toHaveLength(2);
    expect(labeler.typeFor("caller@1")).toBeNull(); // nothing has come back yet
    backend.release();
    await Promise.all([first, second, third]);
    expect(labeler.calls).toBe(2);
    expect(labeler.typeFor("caller@1")).toBe("calling_station");
    expect(labeler.typeFor("rules@0")).toBe("nit");
    // The labels describe the 20-hand sample, so the 50 hands seen by now are due.
    await labeler.refresh();
    expect(labeler.calls).toBe(4);
    expect(backend.requests.map((r) => r.opponent.hands)).toEqual([20, 20, 50, 50]);
  });

  it("asks again after an overlapping refresh that failed", async () => {
    const t = new ProfileTracker();
    recordTimes(t, 20, p, foldsPreflop(0));
    const backend = labelBackend(() => new Error("backend down"), true);
    const labeler = new JevTypeLabeler(t, backend);
    const first = labeler.refresh();
    const second = labeler.refresh();
    backend.release();
    await Promise.all([first, second]);
    expect(labeler.calls).toBe(1);
    // The player is not stuck as "pending": 25 hands later it is asked about again.
    recordTimes(t, 25, p, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
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

describe("ProfileTracker window", () => {
  const players = new Map([[0, "villain"]]);

  it("forgets hands older than the window, so the statistics follow a change of play", () => {
    const t = new ProfileTracker(30);
    recordTimes(t, 30, players, foldsPreflop(0));
    expect(t.statsFor("villain")).toMatchObject({ hands: 30, vpipPct: 0 });
    expect(t.typeFor("villain")).toBe("nit");
    recordTimes(t, 15, players, callsDown(0));
    expect(t.statsFor("villain")).toMatchObject({ hands: 30, vpipPct: 50 });
    recordTimes(t, 15, players, callsDown(0));
    expect(t.statsFor("villain")).toMatchObject({ hands: 30, vpipPct: 100, foldToBetPct: 0 });
    expect(t.typeFor("villain")).toBe("calling_station");
    expect(t.handsSeen("villain")).toBe(60);
  });

  it("remembers everything without a window", () => {
    const t = new ProfileTracker();
    recordTimes(t, 30, players, foldsPreflop(0));
    recordTimes(t, 30, players, callsDown(0));
    expect(t.statsFor("villain")).toMatchObject({ hands: 60, vpipPct: 50 });
    expect(t.handsSeen("villain")).toBe(60);
    expect(t.handsSeen("nobody")).toBe(0);
  });

  it("keeps asking Jev every 25 hands once the window is full", async () => {
    const t = new ProfileTracker(20);
    const backend = labelBackend(() => "nit");
    const labeler = new JevTypeLabeler(t, backend);
    recordTimes(t, 20, players, foldsPreflop(0));
    await labeler.refresh();
    recordTimes(t, 24, players, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(1);
    recordTimes(t, 1, players, foldsPreflop(0));
    await labeler.refresh();
    expect(labeler.calls).toBe(2);
    // The sample Jev is shown never exceeds the window.
    expect(backend.requests.map((r) => r.opponent.hands)).toEqual([20, 20]);
  });
});
