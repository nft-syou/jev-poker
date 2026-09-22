import {
  type Action,
  createDeck,
  createRng,
  Hand,
  type HandOptions,
  type LegalActions,
  type SeatId,
} from "@jev-poker/engine";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { JevBackend } from "./backend";
import { type DecisionRecord, decideAction } from "./decide";
import { buildFeatures } from "./features";
import {
  DecisionCache,
  decisionKey,
  fnv1a,
  representativeActions,
  speculationTargets,
} from "./prefetch";

function handWith(seats: number, overrides: Partial<HandOptions> = {}): Hand {
  return new Hand({
    handNumber: 0,
    button: 0,
    seats: Array.from({ length: seats }, (_, seat) => ({ seat, stack: 100 })),
    blinds: { small: 5, big: 10, ante: 0 },
    deck: createDeck(),
    ...overrides,
  });
}

function featuresOf(hand: Hand, seat: SeatId) {
  return buildFeatures({
    snapshot: hand.snapshot(),
    seat,
    actions: [],
    persona: { name: "TAG", description: "tight aggressive" },
  });
}

const allCpu = () => true;

describe("decisionKey", () => {
  it("is stable for the same state and differs when the legal labels change", () => {
    const hand = handWith(3);
    const features = featuresOf(hand, 0);
    const legal = hand.legalActions(0);
    expect(decisionKey(features, legal)).toBe(decisionKey(featuresOf(hand, 0), legal));

    const noRaise: LegalActions = { ...legal, minRaiseTo: null, maxRaiseTo: null };
    expect(decisionKey(features, noRaise)).not.toBe(decisionKey(features, legal));
    expect(decisionKey(features, { ...legal, canFold: false })).not.toBe(
      decisionKey(features, legal),
    );
  });

  it("ignores key order inside the features but not the values", () => {
    const hand = handWith(3);
    const features = featuresOf(hand, 0);
    const shuffled = Object.fromEntries(Object.entries(features).reverse()) as typeof features;
    const legal = hand.legalActions(0);
    expect(decisionKey(shuffled, legal)).toBe(decisionKey(features, legal));

    const other = { ...features, table: { ...features.table, potBB: features.table.potBB + 1 } };
    expect(decisionKey(other, legal)).not.toBe(decisionKey(features, legal));
  });
});

describe("fnv1a", () => {
  it("is stable per string and spreads neighbouring keys apart", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("")).toBeGreaterThanOrEqual(0);
    for (const key of ["", "a", "decision", '{"seat":1}']) {
      expect(Number.isInteger(fnv1a(key))).toBe(true);
      expect(fnv1a(key)).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("handles the non-ASCII text a persona name puts in the key", () => {
    // A decision key embeds the persona prompt, and personas are named in Japanese too.
    const japanese = "コーリングステーション";
    expect(fnv1a(japanese)).toBe(fnv1a(japanese));
    expect(fnv1a(japanese)).not.toBe(fnv1a("Calling Station"));
    expect(Number.isInteger(fnv1a(japanese))).toBe(true);
    expect(fnv1a(japanese)).toBeGreaterThanOrEqual(0);
    expect(fnv1a(japanese)).toBeLessThanOrEqual(0xffffffff);
  });
});

/** Answers every choice question with a flat distribution, so the rng alone picks the label. */
function flatBackend(): JevBackend {
  return {
    kind: "mock",
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(request.questions)) {
        if (question.type === "choice") {
          const labels = Object.keys(question.criteria);
          const p = 1 / labels.length;
          answers[name] = {
            type: "choice",
            choice: labels[0],
            confidence: p,
            probabilities: Object.fromEntries(labels.map((label) => [label, p])),
          };
        } else if (question.type === "score") {
          answers[name] = { type: "score", score: 2, confidence: 1, legend: {}, probabilities: {} };
        } else {
          answers[name] = { type: "noul", noul: 0.5 };
        }
      }
      return {
        model: "flat",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

describe("key-derived randomness", () => {
  it("samples the same label for the same decision, whenever it is asked", async () => {
    const hand = handWith(3);
    const features = featuresOf(hand, 0);
    const legal = hand.legalActions(0);
    const snapshot = hand.snapshot();
    const key = decisionKey(features, legal);
    const backend = flatBackend();
    const seed = 12345;
    const ask = (rng: ReturnType<typeof createRng>) =>
      decideAction({ backend, seat: 0, features, legal, snapshot, variance: 1, rng });

    // The speculative and the live call derive their rng from the same key, so the answer
    // no longer depends on which of them reached the table.
    const speculative = await ask(createRng(seed ^ fnv1a(key)));
    const live = await ask(createRng(seed ^ fnv1a(key)));
    expect(live.jev?.chosen).toBe(speculative.jev?.chosen);

    // A shared rng, by contrast, hands out a different draw to each caller.
    const shared = createRng(seed);
    const labels = new Set<string>();
    for (let i = 0; i < 8; i++) labels.add(String((await ask(shared)).jev?.chosen));
    expect(labels.size).toBeGreaterThan(1);
  });
});

describe("representativeActions", () => {
  it("offers fold, call and a pot-sized raise when facing a bet", () => {
    const hand = handWith(3);
    // Preflop the "about the pot" rubric level is an open to 3.5 big blinds: 35.
    expect(representativeActions(hand.legalActions(0), hand.snapshot(), 0)).toEqual<Action[]>([
      { type: "fold" },
      { type: "call" },
      { type: "raise", amount: 35 },
    ]);
  });

  it("offers check and a pot-sized bet when checking is free", () => {
    const hand = handWith(3);
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    expect(hand.street).toBe("flop");
    const seat = hand.actingSeat as SeatId;
    expect(representativeActions(hand.legalActions(seat), hand.snapshot(), seat)).toEqual<Action[]>(
      [{ type: "check" }, { type: "bet", amount: 30 }],
    );
  });

  it("re-raises preflop to a multiple of the raise faced", () => {
    const hand = handWith(3, {
      seats: [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
    });
    hand.act(0, { type: "raise", amount: 30 });
    // The same rubric level against a raise to 30 is 3.5 times that raise.
    expect(representativeActions(hand.legalActions(1), hand.snapshot(), 1)).toEqual<Action[]>([
      { type: "fold" },
      { type: "call" },
      { type: "raise", amount: 105 },
    ]);
  });

  it("makes a pot-sized raise after the flop", () => {
    const hand = handWith(3);
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    const bettor = hand.actingSeat as SeatId;
    hand.act(bettor, { type: "bet", amount: 10 });
    const seat = hand.actingSeat as SeatId;
    // Pot 40, 10 to call: a pot-sized raise is 10 + (40 + 10) = 60.
    expect(representativeActions(hand.legalActions(seat), hand.snapshot(), seat)).toEqual<Action[]>(
      [{ type: "fold" }, { type: "call" }, { type: "raise", amount: 60 }],
    );
  });

  it("drops the raise when raising is impossible", () => {
    const hand = handWith(3, {
      seats: [
        { seat: 0, stack: 8 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 100 },
      ],
    });
    // Seat 0 is short of a call, so it can only fold or call all in.
    expect(representativeActions(hand.legalActions(0), hand.snapshot(), 0)).toEqual<Action[]>([
      { type: "fold" },
      { type: "call" },
    ]);
  });
});

describe("speculationTargets", () => {
  it("enumerates the next decision after each representative action", () => {
    const hand = handWith(3);
    const before = hand.snapshot();
    const targets = speculationTargets(hand, 0, [], allCpu);

    // fold / call / raise all leave seat 1 to act, on the same street.
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.seat)).toEqual([1, 1, 1]);
    expect(targets.every((t) => t.snapshot.street === "preflop")).toBe(true);
    expect(targets.map((t) => t.snapshot.currentBet)).toEqual([10, 10, 35]);
    expect(targets.map((t) => t.legal)).toEqual(
      targets.map((t) => ({
        canFold: true,
        canCheck: false,
        callAmount: t.snapshot.currentBet - 5,
        minRaiseTo: t.snapshot.currentBet === 35 ? 60 : 20,
        maxRaiseTo: 100,
      })),
    );

    // Each target carries the hypothetical action that produced it.
    for (const target of targets) {
      expect(target.actions).toHaveLength(1);
      expect(target.actions[0]?.seat).toBe(0);
      expect(target.actions[0]?.type).toBe("ActionTaken");
    }
    expect(targets.map((t) => t.actions[0]?.action)).toEqual([
      { type: "fold" },
      { type: "call" },
      { type: "raise", amount: 35 },
    ]);

    // The live hand is never touched.
    expect(hand.snapshot()).toEqual(before);
    expect(hand.actingSeat).toBe(0);
  });

  it("keeps the caller's earlier actions in front of the hypothetical ones", () => {
    const hand = handWith(4);
    const seat = hand.actingSeat as SeatId;
    const events = hand.act(seat, { type: "call" });
    const history = events.flatMap((e) => (e.type === "ActionTaken" ? [e] : []));
    const targets = speculationTargets(hand, hand.actingSeat as SeatId, history, allCpu);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.actions[0]).toEqual(history[0]);
      expect(target.actions.length).toBeGreaterThanOrEqual(2);
      expect(target.actions.slice(1).every((a) => a.seat !== 3)).toBe(true);
    }
  });

  it("stops the preflop fold chain before the last live player", () => {
    // 3 handed: seat 0 folds, seat 1 folds and the hand is over, so the chain adds nothing.
    expect(speculationTargets(handWith(3), 0, [], allCpu)).toHaveLength(3);

    // 4 handed: seat 3 folds (already covered), seat 0 folds, and the small blind's
    // decision is the one extra state worth prefetching.
    const four = handWith(4);
    expect(four.actingSeat).toBe(3);
    const targets = speculationTargets(four, 3, [], allCpu);
    expect(targets).toHaveLength(4);
    const chained = targets[3] as (typeof targets)[number];
    expect(chained.seat).toBe(1);
    expect(chained.actions.map((a) => [a.seat, a.action.type])).toEqual([
      [3, "fold"],
      [0, "fold"],
    ]);
    expect(chained.snapshot.players.filter((p) => p.folded).map((p) => p.seat)).toEqual([0, 3]);
  });

  it("never speculates past the end of a street", () => {
    const hand = handWith(3);
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    // The big blind can check (ending preflop) or raise; only the raise stays on this street.
    const targets = speculationTargets(hand, 2, [], allCpu);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.seat).toBe(0);
    expect(targets[0]?.snapshot.street).toBe("preflop");
  });

  it("skips human seats and hands that would be over", () => {
    const hand = handWith(3);
    expect(speculationTargets(hand, 0, [], (seat) => seat !== 1)).toEqual([]);

    const headsUp = handWith(2);
    // Folding ends the hand; calling and raising leave the big blind to act.
    const targets = speculationTargets(headsUp, headsUp.actingSeat as SeatId, [], allCpu);
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.seat === 1)).toBe(true);
  });

  it("honours the limit and refuses a hand that is not at the given seat", () => {
    const hand = handWith(4);
    expect(speculationTargets(hand, 3, [], allCpu, 2)).toHaveLength(2);
    expect(speculationTargets(hand, 0, [], allCpu)).toEqual([]);
  });
});

function record(seat: SeatId): DecisionRecord {
  return {
    seat,
    action: { type: "fold" },
    jev: null,
    error: null,
    errorKind: null,
    fallback: false,
    latencyMs: 1,
  };
}

describe("DecisionCache", () => {
  it("returns the started promise on a hit and misses afterwards", async () => {
    const cache = new DecisionCache({});
    const promise = Promise.resolve(record(1));
    cache.prefetch("k", () => promise);
    cache.prefetch("k", () => Promise.resolve(record(2))); // already cached: not started twice

    expect(cache.stats.started).toBe(1);
    const taken = cache.take("k");
    expect(taken).toBe(promise);
    await expect(taken).resolves.toEqual(record(1));
    expect(cache.take("k")).toBeUndefined();
    expect(cache.stats).toEqual({ started: 1, hits: 1, misses: 1, aborted: 0 });
  });

  it("aborts what is in flight and drops what is cached", async () => {
    const cache = new DecisionCache({});
    const signals: AbortSignal[] = [];
    cache.prefetch("a", (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const settled = Promise.resolve(record(0));
    cache.prefetch("b", () => settled);
    await settled;

    cache.clear();
    expect(signals[0]?.aborted).toBe(true);
    expect(cache.take("a")).toBeUndefined();
    expect(cache.take("b")).toBeUndefined();
    // Only the still-running request was aborted; the settled one was simply dropped.
    expect(cache.stats.aborted).toBe(1);
  });

  it("stops starting work beyond the in-flight cap", () => {
    const cache = new DecisionCache({ maxInFlight: 2 });
    for (const key of ["a", "b", "c"]) {
      cache.prefetch(key, () => new Promise(() => {}));
    }
    expect(cache.stats.started).toBe(2);
    expect(cache.take("c")).toBeUndefined();
    expect(cache.take("a")).toBeDefined();
  });

  it("frees a slot once a request settles", async () => {
    const cache = new DecisionCache({ maxInFlight: 1 });
    const done = Promise.resolve(record(0));
    cache.prefetch("a", () => done);
    cache.prefetch("b", () => Promise.resolve(record(1)));
    expect(cache.stats.started).toBe(1);
    await done;
    cache.prefetch("b", () => Promise.resolve(record(1)));
    expect(cache.stats.started).toBe(2);
  });

  it("applies a new in-flight cap to future prefetches", () => {
    const cache = new DecisionCache({ maxInFlight: 1 });
    cache.prefetch("a", () => new Promise(() => {}));
    cache.prefetch("b", () => new Promise(() => {}));
    expect(cache.stats.started).toBe(1); // capped at 1

    cache.setMaxInFlight(3);
    cache.prefetch("b", () => new Promise(() => {}));
    cache.prefetch("c", () => new Promise(() => {}));
    expect(cache.stats.started).toBe(3);

    cache.setMaxInFlight(1);
    cache.prefetch("d", () => new Promise(() => {}));
    expect(cache.stats.started).toBe(3); // already at the new, lower cap
  });
});
