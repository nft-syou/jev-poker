import {
  type Card,
  createDeck,
  createRng,
  Hand,
  type LegalActions,
  type PlayerView,
  parseCards,
  sameCard,
} from "@jev-poker/engine";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { APIError, AuthenticationError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { JevBackend } from "./backend";
import {
  type DecisionRecord,
  decideAction,
  fallbackAction,
  type SizingSnapshot,
  sampleLabel,
  sizingToAmount,
} from "./decide";
import { buildFeatures, featuresFromView } from "./features";
import { createMockBackend } from "./mock-backend";
import { PREFLOP_SIZING_RUBRIC, SIZING_RUBRIC } from "./questions";

function riggedDeck(front: string): Card[] {
  const cards = parseCards(front);
  const rest = createDeck().filter((card) => !cards.some((c) => sameCard(c, card)));
  return [...cards, ...rest];
}

function openHand(): Hand {
  return new Hand({
    handNumber: 0,
    button: 0,
    seats: [
      { seat: 0, stack: 100 },
      { seat: 1, stack: 100 },
      { seat: 2, stack: 100 },
    ],
    blinds: { small: 5, big: 10, ante: 0 },
    deck: riggedDeck("Ah Kh 2c 2d 7s 8s"),
  });
}

function fakeBackend(
  answers: (request: SystemOneRequest<Questions>) => Record<string, unknown> | Error,
): JevBackend {
  return {
    kind: "mock",
    async systemOne(request) {
      const result = answers(request as SystemOneRequest<Questions>);
      if (result instanceof Error) throw result;
      return {
        model: "fake",
        answers: result,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as SystemOneResult<typeof request.questions>;
    },
  };
}

const persona = { name: "TAG", description: "tight aggressive" };

/** A Jev reply with the given action probabilities and sizing score. */
function reply(probabilities: Record<string, number>, score = 3) {
  return {
    action: { type: "choice", choice: "fold", confidence: 1, probabilities },
    sizing: { type: "score", score, confidence: 1, legend: {}, probabilities: {} },
    bluff_intent: { type: "noul", noul: 0.2 },
  };
}

// A flop decision on the button, facing a bet of 1 bb into 5 bb (amounts in chips, 100 = 1 bb).
const flopLegal: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 100,
  minRaiseTo: 300,
  maxRaiseTo: 10000,
};
const flopView: PlayerView = {
  seat: 0,
  street: "flop",
  holeCards: parseCards("Ah Kh"),
  board: parseCards("Qh Jh 2c"),
  stacks: [],
  pot: 600,
  toCall: 100,
  currentBet: 100,
  committedThisStreet: 0,
  bigBlind: 100,
  position: "BTN",
  history: [],
};

/** What `JevAgent` hands to `decideAction` for a view: just enough of the hand to size a bet. */
function sizingOf(view: PlayerView): SizingSnapshot {
  return {
    street: view.street,
    currentBet: view.currentBet,
    pot: view.pot,
    bigBlind: view.bigBlind,
    players: [{ seat: view.seat, streetBet: view.committedThisStreet }],
  };
}

// The fake backend never reads the state, so one set of features serves every view below
// (building them costs an exact hand-strength enumeration each time).
const flopFeatures = featuresFromView(flopView, persona);

/** One decision from a fixed Jev reply. */
function decideFrom(
  probabilities: Record<string, number>,
  score: number,
  legal: LegalActions,
  view: PlayerView,
  variance = 0,
  rng = createRng(1),
): Promise<DecisionRecord> {
  return decideAction({
    backend: fakeBackend(() => reply(probabilities, score)),
    seat: view.seat,
    features: flopFeatures,
    legal,
    snapshot: sizingOf(view),
    variance,
    rng,
  });
}

describe("sampleLabel", () => {
  it("returns the argmax when variance is 0", () => {
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      expect(sampleLabel({ fold: 0.2, check_or_call: 0.5, bet_or_raise: 0.3 }, 0, rng)).toBe(
        "check_or_call",
      );
    }
  });

  it("samples proportionally when variance is 1", () => {
    const rng = createRng(1);
    const counts = { fold: 0, check_or_call: 0, bet_or_raise: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[sampleLabel({ fold: 0.1, check_or_call: 0.6, bet_or_raise: 0.3 }, 1, rng)]++;
    }
    expect(counts.check_or_call).toBeGreaterThan(1000);
    expect(counts.fold).toBeGreaterThan(100);
    expect(counts.fold).toBeLessThan(350);
  });

  it("ignores zero-probability and unknown labels", () => {
    const rng = createRng(3);
    expect(sampleLabel({ fold: 0, bet_or_raise: 1 }, 1, rng)).toBe("bet_or_raise");
    expect(() => sampleLabel({}, 1, rng)).toThrow(/no labels/);
  });

  it("takes the most likely label without sampling when the variance is 0.05 or less", () => {
    const never = {
      next: () => {
        throw new Error("the rng must not be used");
      },
    };
    const probabilities = { fold: 0.34, check_or_call: 0.33, bet_or_raise: 0.33 };
    for (const variance of [-1, 0, 0.01, 0.05]) {
      expect(sampleLabel(probabilities, variance, never)).toBe("fold");
    }
    // Just above the guard the label is sampled again (from sharply tempered weights).
    let used = 0;
    const counting = {
      next: () => {
        used++;
        return 0.5;
      },
    };
    expect(sampleLabel({ fold: 0.1, check_or_call: 0.9 }, 0.06, counting)).toBe("check_or_call");
    expect(used).toBe(1);
  });

  it("takes the most likely label when the tempered weights are not finite or all zero", () => {
    const never = {
      next: () => {
        throw new Error("the rng must not be used");
      },
    };
    // (1e300) ** 10 overflows to Infinity.
    expect(sampleLabel({ fold: 1e300, check_or_call: 2e300 }, 0.1, never)).toBe("check_or_call");
    // (1e-300) ** 10 underflows to 0 for every label.
    expect(sampleLabel({ fold: 1e-300, bet_or_raise: 2e-300 }, 0.1, never)).toBe("bet_or_raise");
  });

  it("sharpens the distribution between the extremes", () => {
    const rng = createRng(5);
    const counts = { fold: 0, check_or_call: 0, bet_or_raise: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[sampleLabel({ fold: 0.3, check_or_call: 0.6, bet_or_raise: 0.1 }, 0.15, rng)]++;
    }
    // Exponent 1/0.15: fold keeps about 1% of the weight, bet_or_raise practically none.
    expect(counts.check_or_call).toBeGreaterThan(1900);
    expect(counts.fold).toBeLessThan(100);
    expect(counts.bet_or_raise).toBe(0);
  });
});

describe("sizingToAmount", () => {
  const legal: LegalActions = {
    canFold: true,
    canCheck: false,
    callAmount: 10,
    minRaiseTo: 20,
    maxRaiseTo: 100,
  };
  const hand = openHand();
  // Preflop, unopened: pot 15, current bet 10 (the big blind), seat 0 has 0 in.
  const snapshot = hand.snapshot();

  it("opens in big blinds preflop, by rounded rubric level, and clamps to legal bounds", () => {
    expect(sizingToAmount(0, legal, snapshot, 0)).toBe(20); // 2 bb, also the minimum
    expect(sizingToAmount(1, legal, snapshot, 0)).toBe(25); // 2.5 bb
    expect(sizingToAmount(2, legal, snapshot, 0)).toBe(30); // 3 bb
    expect(sizingToAmount(3, legal, snapshot, 0)).toBe(35); // 3.5 bb
    expect(sizingToAmount(4, legal, snapshot, 0)).toBe(40); // 4 bb
    expect(sizingToAmount(5, legal, snapshot, 0)).toBe(100); // all in
    // Scores are rounded to a rubric level, not interpolated.
    expect(sizingToAmount(4.7, legal, snapshot, 0)).toBe(100);
    expect(sizingToAmount(4.4, legal, snapshot, 0)).toBe(40);
    expect(sizingToAmount(1.5, legal, snapshot, 0)).toBe(30);
    expect(sizingToAmount(1.4, legal, snapshot, 0)).toBe(25);
    // Out-of-range scores are clamped to the rubric.
    expect(sizingToAmount(-3, legal, snapshot, 0)).toBe(20);
    expect(sizingToAmount(9, legal, snapshot, 0)).toBe(100);
  });

  it("re-raises preflop as a multiple of the raise faced", () => {
    const raised = openHand();
    raised.act(0, { type: "raise", amount: 30 });
    const faced = raised.snapshot(); // current bet 30, seat 1 has the small blind in
    const legal3 = raised.legalActions(1);
    expect(legal3).toMatchObject({ callAmount: 25, minRaiseTo: 50, maxRaiseTo: 100 });
    expect(sizingToAmount(0, legal3, faced, 1)).toBe(60); // 2x
    expect(sizingToAmount(1, legal3, faced, 1)).toBe(75); // 2.5x
    expect(sizingToAmount(2, legal3, faced, 1)).toBe(90); // 3x
    expect(sizingToAmount(3, legal3, faced, 1)).toBe(100); // 3.5x = 105, clamped to the stack
  });

  it("sizes postflop as the bet being matched plus a fraction of the pot after calling", () => {
    const post = sizingOf(flopView); // pot 600, 100 to call
    expect(sizingToAmount(0, flopLegal, post, 0)).toBe(300); // minimum
    expect(sizingToAmount(1, flopLegal, post, 0)).toBe(333); // 100 + (1/3) * 700
    expect(sizingToAmount(2, flopLegal, post, 0)).toBe(567); // 100 + (2/3) * 700
    expect(sizingToAmount(3, flopLegal, post, 0)).toBe(800); // 100 + 700
    expect(sizingToAmount(4, flopLegal, post, 0)).toBe(1150); // 100 + 1.5 * 700
    expect(sizingToAmount(5, flopLegal, post, 0)).toBe(10000); // all in
    expect(sizingToAmount(2.4, flopLegal, post, 0)).toBe(567);
    // A seat that is not in the snapshot is treated as having nothing in on this street.
    expect(sizingToAmount(3, flopLegal, post, 7)).toBe(800);
  });

  it("never goes below the minimum or above the maximum", () => {
    const tight: LegalActions = { ...legal, minRaiseTo: 40, maxRaiseTo: 42 };
    expect(sizingToAmount(0, tight, snapshot, 0)).toBe(40);
    expect(sizingToAmount(4.9, tight, snapshot, 0)).toBe(42);
    const post = sizingOf(flopView);
    expect(sizingToAmount(1, { ...flopLegal, minRaiseTo: 400 }, post, 0)).toBe(400);
    expect(sizingToAmount(3, { ...flopLegal, maxRaiseTo: 700 }, post, 0)).toBe(700);
  });

  it("throws when raising is not legal", () => {
    const noRaise: LegalActions = { ...legal, minRaiseTo: null, maxRaiseTo: null };
    expect(() => sizingToAmount(3, noRaise, snapshot, 0)).toThrow(/not legal/);
  });
});

describe("fallbackAction", () => {
  it("checks when possible, otherwise folds", () => {
    expect(
      fallbackAction({
        canFold: false,
        canCheck: true,
        callAmount: null,
        minRaiseTo: 10,
        maxRaiseTo: 90,
      }),
    ).toEqual({ type: "check" });
    expect(
      fallbackAction({
        canFold: true,
        canCheck: false,
        callAmount: 10,
        minRaiseTo: 20,
        maxRaiseTo: 100,
      }),
    ).toEqual({ type: "fold" });
  });
});

describe("decideAction", () => {
  it("turns Jev answers into a legal raise with sizing", async () => {
    const hand = openHand();
    const snapshot = hand.snapshot();
    const legal = hand.legalActions(0);
    const backend = fakeBackend((request) => {
      expect(Object.keys((request.questions.action as { criteria: object }).criteria)).toEqual([
        "fold",
        "check_or_call",
        "bet_or_raise",
      ]);
      return {
        action: {
          type: "choice",
          choice: "bet_or_raise",
          confidence: 0.7,
          probabilities: { fold: 0.1, check_or_call: 0.2, bet_or_raise: 0.7 },
        },
        sizing: { type: "score", score: 3, confidence: 0.6, legend: {}, probabilities: {} },
        bluff_intent: { type: "noul", noul: 0.2 },
      };
    });
    const record = await decideAction({
      backend,
      seat: 0,
      features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
      legal,
      snapshot,
      variance: 0,
      rng: createRng(1),
    });
    expect(record.action).toEqual({ type: "raise", amount: 35 }); // level 3 opens to 3.5 bb
    expect(record.fallback).toBe(false);
    expect(record.error).toBeNull();
    expect(record.jev).toMatchObject({
      chosen: "bet_or_raise",
      sizingScore: 3,
      bluffIntent: 0.2,
      model: "fake",
    });
    expect(() => hand.act(0, record.action)).not.toThrow();
  });

  it("maps check_or_call to check when checking is free", async () => {
    const hand = openHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    const snapshot = hand.snapshot();
    const backend = fakeBackend(() => ({
      action: {
        type: "choice",
        choice: "check_or_call",
        confidence: 1,
        probabilities: { check_or_call: 1, bet_or_raise: 0 },
      },
      sizing: { type: "score", score: 0, confidence: 1, legend: {}, probabilities: {} },
      bluff_intent: { type: "noul", noul: 0 },
    }));
    const record = await decideAction({
      backend,
      seat: 2,
      features: buildFeatures({ snapshot, seat: 2, actions: [], persona }),
      legal: hand.legalActions(2),
      snapshot,
      variance: 0,
      rng: createRng(1),
    });
    expect(record.action).toEqual({ type: "check" });
  });

  it("uses a bet (not a raise) when nobody has bet yet", async () => {
    const hand = openHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    const snapshot = hand.snapshot();
    expect(snapshot.street).toBe("flop");
    const backend = fakeBackend(() => ({
      action: {
        type: "choice",
        choice: "bet_or_raise",
        confidence: 1,
        probabilities: { check_or_call: 0, bet_or_raise: 1 },
      },
      sizing: { type: "score", score: 2, confidence: 1, legend: {}, probabilities: {} },
      bluff_intent: { type: "noul", noul: 0.5 },
    }));
    const record = await decideAction({
      backend,
      seat: 1,
      features: buildFeatures({ snapshot, seat: 1, actions: [], persona }),
      legal: hand.legalActions(1),
      snapshot,
      variance: 0,
      rng: createRng(1),
    });
    expect(record.action).toEqual({ type: "bet", amount: 20 }); // 2/3 of a 30 pot
    expect(() => hand.act(1, record.action)).not.toThrow();
  });

  it("fails open with a safe action when the backend throws", async () => {
    const hand = openHand();
    const snapshot = hand.snapshot();
    const backend = fakeBackend(() => new Error("boom"));
    const record = await decideAction({
      backend,
      seat: 0,
      features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
      legal: hand.legalActions(0),
      snapshot,
      variance: 0.5,
      rng: createRng(1),
    });
    expect(record.action).toEqual({ type: "fold" });
    expect(record.fallback).toBe(true);
    expect(record.jev).toBeNull();
    expect(record.error).toMatch(/boom/);
    expect(record.errorKind).toBe("other");
  });

  it("flags authentication failures", async () => {
    const hand = openHand();
    const snapshot = hand.snapshot();
    const backend = fakeBackend(
      () => new AuthenticationError(401, { error: "bad key" }, new Headers(), "bad key"),
    );
    const record = await decideAction({
      backend,
      seat: 0,
      features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
      legal: hand.legalActions(0),
      snapshot,
      variance: 0.5,
      rng: createRng(1),
    });
    expect(record.errorKind).toBe("auth");
    expect(record.fallback).toBe(true);
  });

  it("flags billing failures (HTTP 402 payment required)", async () => {
    const hand = openHand();
    const snapshot = hand.snapshot();
    const backend = fakeBackend(
      () => new APIError(402, { error: "insufficient credits" }, new Headers(), "payment required"),
    );
    const record = await decideAction({
      backend,
      seat: 0,
      features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
      legal: hand.legalActions(0),
      snapshot,
      variance: 0.5,
      rng: createRng(1),
    });
    expect(record.errorKind).toBe("billing");
    expect(record.fallback).toBe(true);
  });

  it("treats our own proxy's connection-config rejections as auth failures", async () => {
    // A 400 from `/api/jev` means the stored connection cannot address any upstream, so the
    // player has to fix it: the auth path pauses the table and reopens the connection modal.
    for (const body of [{ error: "invalid_route" }, { error: "invalid_gateway_config" }]) {
      const hand = openHand();
      const snapshot = hand.snapshot();
      const backend = fakeBackend(() => new APIError(400, body, new Headers(), "bad request"));
      const record = await decideAction({
        backend,
        seat: 0,
        features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
        legal: hand.legalActions(0),
        snapshot,
        variance: 0.5,
        rng: createRng(1),
      });
      expect(record.errorKind, JSON.stringify(body)).toBe("auth");
      expect(record.fallback).toBe(true);
    }
  });

  it("leaves every other 400 as an ordinary per-decision failure", async () => {
    for (const body of [
      { error: "invalid_request" },
      { error: "invalid_route_ish" },
      { message: "invalid_route" },
      "invalid_route",
      undefined,
      null,
    ]) {
      const hand = openHand();
      const snapshot = hand.snapshot();
      const backend = fakeBackend(() => new APIError(400, body, new Headers(), "bad request"));
      const record = await decideAction({
        backend,
        seat: 0,
        features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
        legal: hand.legalActions(0),
        snapshot,
        variance: 0.5,
        rng: createRng(1),
      });
      expect(record.errorKind, JSON.stringify(body)).toBe("other");
    }
  });

  it("falls back when Jev picks a label that was not offered", async () => {
    const hand = openHand();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    const snapshot = hand.snapshot();
    const backend = fakeBackend(() => ({
      action: { type: "choice", choice: "fold", confidence: 1, probabilities: { fold: 1 } },
      sizing: { type: "score", score: 0, confidence: 1, legend: {}, probabilities: {} },
      bluff_intent: { type: "noul", noul: 0 },
    }));
    const record = await decideAction({
      backend,
      seat: 2,
      features: buildFeatures({ snapshot, seat: 2, actions: [], persona }),
      legal: hand.legalActions(2),
      snapshot,
      variance: 0,
      rng: createRng(1),
    });
    expect(record.action).toEqual({ type: "check" });
    expect(record.fallback).toBe(true);
  });

  it("plays a whole hand with the mock backend", async () => {
    const hand = openHand();
    const backend = createMockBackend();
    const rng = createRng(9);
    let guard = 0;
    while (!hand.isComplete) {
      const seat = hand.actingSeat as number;
      const snapshot = hand.snapshot();
      const record = await decideAction({
        backend,
        seat,
        features: buildFeatures({ snapshot, seat, actions: [], persona }),
        legal: hand.legalActions(seat),
        snapshot,
        variance: 0.5,
        rng,
      });
      expect(record.error).toBeNull();
      hand.act(seat, record.action);
      if (++guard > 100) throw new Error("did not finish");
    }
    expect(hand.stacks().reduce((sum, s) => sum + s.stack, 0)).toBe(300);
  });
});

describe("decideAction request", () => {
  it("asks the questions of the prompt style and forwards the model and the signal", async () => {
    const hand = openHand();
    const snapshot = hand.snapshot();
    const seen: { criteria: unknown; model: unknown; signal: unknown }[] = [];
    const mock = createMockBackend();
    const backend: JevBackend = {
      kind: "mock",
      async systemOne(request, options) {
        seen.push({
          criteria: (request.questions.sizing as { criteria: unknown }).criteria,
          model: request.model,
          signal: options?.signal,
        });
        return mock.systemOne(request);
      },
    };
    const base = {
      backend,
      seat: 0,
      features: buildFeatures({ snapshot, seat: 0, actions: [], persona }),
      legal: hand.legalActions(0),
      snapshot,
      variance: 0,
      rng: createRng(1),
    };
    const controller = new AbortController();
    await decideAction(base);
    await decideAction({
      ...base,
      promptStyle: "split",
      model: "jev-test",
      signal: controller.signal,
    });
    await decideAction({ ...base, promptStyle: "unified" });
    expect(seen).toEqual([
      { criteria: SIZING_RUBRIC, model: undefined, signal: undefined },
      { criteria: PREFLOP_SIZING_RUBRIC, model: "jev-test", signal: controller.signal },
      { criteria: SIZING_RUBRIC, model: undefined, signal: undefined },
    ]);
  });
});

describe("decideAction choice", () => {
  it("variance 0 takes argmax", async () => {
    const record = await decideFrom(
      { fold: 0.2, check_or_call: 0.5, bet_or_raise: 0.3 },
      3,
      flopLegal,
      flopView,
    );
    expect(record.action).toEqual({ type: "call" });
    expect(record.jev?.chosen).toBe("check_or_call");
  });

  it("variance 1 samples by probability", async () => {
    const rng = createRng(2);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const record = await decideFrom(
        { fold: 0.5, check_or_call: 0.5, bet_or_raise: 0 },
        3,
        flopLegal,
        flopView,
        1,
        rng,
      );
      const chosen = record.jev?.chosen ?? "none";
      counts[chosen] = (counts[chosen] ?? 0) + 1;
    }
    expect(counts.fold).toBeGreaterThan(400);
    expect(counts.check_or_call).toBeGreaterThan(400);
    expect(counts.bet_or_raise).toBeUndefined();
  });

  it("ignores illegal choices", async () => {
    const record = await decideFrom(
      { fold: 0.9, check_or_call: 0.1, bet_or_raise: 0 },
      3,
      { ...flopLegal, canFold: false, canCheck: true, callAmount: null },
      { ...flopView, toCall: 0, currentBet: 0 },
    );
    expect(record.action).toEqual({ type: "check" });
    expect(record.jev?.probabilities).toEqual({ check_or_call: 0.1 });
    expect(record.fallback).toBe(false);
  });

  it("never returns a raise when raising is impossible", async () => {
    const record = await decideFrom(
      { fold: 0.1, check_or_call: 0.9, bet_or_raise: 1 },
      3,
      { ...flopLegal, minRaiseTo: null, maxRaiseTo: null },
      flopView,
    );
    expect(record.jev?.chosen).toBe("check_or_call");
    expect(record.jev?.probabilities).toEqual({ fold: 0.1, check_or_call: 0.9 });
    expect(record.action).toEqual({ type: "call" });
  });
});

describe("decideAction sizing", () => {
  const raiseOnly = { bet_or_raise: 1 };
  const at = async (score: number, over: Partial<LegalActions> = {}) =>
    (await decideFrom(raiseOnly, score, { ...flopLegal, ...over }, flopView)).action;

  it("maps sizing to a clamped raise and all-in at the top", async () => {
    expect(await at(0)).toEqual({ type: "raise", amount: 300 });
    // raise to 100 + 1.0 * (600 + 100): a pot-sized raise
    expect(await at(3)).toEqual({ type: "raise", amount: 800 });
    // The top level is the whole stack, reported as a raise to the maximum (never `allin`).
    expect(await at(5)).toEqual({ type: "raise", amount: 10000 });
  });

  it("maps the pot fractions between the extremes", async () => {
    expect(await at(1)).toEqual({ type: "raise", amount: 333 }); // 100 + (1/3)*700
    expect(await at(2)).toEqual({ type: "raise", amount: 567 }); // 100 + (2/3)*700
    expect(await at(4)).toEqual({ type: "raise", amount: 1150 }); // 100 + 1.5*700
  });

  it("goes all-in when the clamped raise reaches the maximum", async () => {
    // The pot-sized raise to 800 exceeds the stack: a raise to everything that is left.
    expect(await at(3, { maxRaiseTo: 700 })).toEqual({ type: "raise", amount: 700 });
  });

  it("bets rather than raises when checking is free", async () => {
    const free = { ...flopView, toCall: 0, currentBet: 0 };
    const record = await decideFrom(
      raiseOnly,
      3,
      { ...flopLegal, canCheck: true, canFold: false, callAmount: null },
      free,
    );
    expect(record.action).toEqual({ type: "bet", amount: 600 }); // a pot-sized bet is the pot
  });
});

describe("decideAction preflop sizing", () => {
  const raiseOnly = { bet_or_raise: 1 };
  const pre: PlayerView = {
    ...flopView,
    street: "preflop",
    board: [],
    pot: 150,
    toCall: 100,
    bigBlind: 100,
  };
  const open: LegalActions = {
    canFold: true,
    canCheck: false,
    callAmount: 100,
    minRaiseTo: 200,
    maxRaiseTo: 10000,
  };
  const amountAt = async (score: number, legal: LegalActions, view: PlayerView) =>
    (await decideFrom(raiseOnly, score, legal, view)).action;

  it("opens in big blinds, not pot fractions", async () => {
    expect(await amountAt(0, open, pre)).toEqual({ type: "raise", amount: 200 });
    expect(await amountAt(2, open, pre)).toEqual({ type: "raise", amount: 300 });
    expect(await amountAt(4, open, pre)).toEqual({ type: "raise", amount: 400 });
    // The top level is all in; over the big blind that is still a raise.
    expect(await amountAt(5, open, pre)).toEqual({ type: "raise", amount: 10000 });
  });

  it("re-raises as a multiple of the raise faced", async () => {
    const faced: PlayerView = {
      ...pre,
      pot: 450,
      toCall: 300,
      // The raise faced is read from the bet to match, not from the history.
      currentBet: 300,
      history: [{ street: "preflop", seat: 1, action: { type: "raise", amount: 300 } }],
    };
    const legal3 = { ...open, callAmount: 300, minRaiseTo: 500 };
    expect(await amountAt(2, legal3, faced)).toEqual({ type: "raise", amount: 900 });
    expect(await amountAt(0, legal3, faced)).toEqual({ type: "raise", amount: 600 });
  });
});

describe("decideAction postflop sizes are pot fractions, not minimum-raise plus a fraction", () => {
  const raiseOnly = { bet_or_raise: 1 };

  it("bets the pot into an unopened 2 bb pot", async () => {
    const v = { ...flopView, pot: 200, toCall: 0, currentBet: 0 };
    const l: LegalActions = {
      canFold: false,
      canCheck: true,
      callAmount: null,
      minRaiseTo: 100,
      maxRaiseTo: 10000,
    };
    expect((await decideFrom(raiseOnly, 3, l, v)).action).toEqual({ type: "bet", amount: 200 });
    expect((await decideFrom(raiseOnly, 2, l, v)).action).toEqual({ type: "bet", amount: 133 });
  });

  it("makes a pot-sized raise to 5 bb over a 1 bb bet into 2 bb", async () => {
    const v = { ...flopView, pot: 300, toCall: 100, currentBet: 100 };
    const l: LegalActions = {
      canFold: true,
      canCheck: false,
      callAmount: 100,
      minRaiseTo: 200,
      maxRaiseTo: 10000,
    };
    expect((await decideFrom(raiseOnly, 3, l, v)).action).toEqual({ type: "raise", amount: 500 });
  });

  it("accounts for chips already committed when re-raising", async () => {
    // Bet 300, raised to 700: pot 1200 (200 + 300 + 700), 400 to call.
    // Pot-sized re-raise: 700 + 1600 = 2300.
    const v = { ...flopView, pot: 1200, toCall: 400, currentBet: 700, committedThisStreet: 300 };
    const l: LegalActions = {
      canFold: true,
      canCheck: false,
      callAmount: 400,
      minRaiseTo: 1100,
      maxRaiseTo: 10000,
    };
    expect((await decideFrom(raiseOnly, 3, l, v)).action).toEqual({ type: "raise", amount: 2300 });
  });
});

describe("decideAction never throws", () => {
  const base = {
    seat: 0,
    features: flopFeatures,
    legal: flopLegal,
    snapshot: sizingOf(flopView),
    variance: 0.5,
    rng: createRng(1),
  };

  it("falls back when the reply is malformed", async () => {
    for (const answers of [{}, { action: {} }, { action: { probabilities: null } }]) {
      const record = await decideAction({ ...base, backend: fakeBackend(() => answers) });
      expect(record.action).toEqual({ type: "fold" });
      expect(record.fallback).toBe(true);
      expect(record.jev).toBeNull();
      expect(record.error).not.toBeNull();
      expect(record.errorKind).toBe("other");
    }
  });

  it("falls back when the backend rejects with something that is not an Error", async () => {
    const backend: JevBackend = {
      kind: "typesafe",
      systemOne: () => Promise.reject("offline"),
    };
    const record = await decideAction({ ...base, backend });
    expect(record).toMatchObject({
      action: { type: "fold" },
      fallback: true,
      jev: null,
      error: "offline",
      errorKind: "other",
    });
  });

  it("checks instead of folding when checking is free", async () => {
    const record = await decideAction({
      ...base,
      legal: { ...flopLegal, canFold: false, canCheck: true, callAmount: null },
      backend: fakeBackend(() => new Error("boom")),
    });
    expect(record.action).toEqual({ type: "check" });
    expect(record.fallback).toBe(true);
  });

  it("does not ask Jev when nothing is legal", async () => {
    let calls = 0;
    const record = await decideAction({
      ...base,
      legal: {
        canFold: false,
        canCheck: false,
        callAmount: null,
        minRaiseTo: null,
        maxRaiseTo: null,
      },
      backend: fakeBackend(() => {
        calls++;
        return reply({ fold: 1 });
      }),
    });
    expect(calls).toBe(0);
    expect(record).toMatchObject({ fallback: true, jev: null, error: "no legal actions" });
  });

  it("falls back when no offered label has a positive probability", async () => {
    const record = await decideFrom(
      { fold: Number.NaN, check_or_call: -1, bet_or_raise: 0 },
      3,
      flopLegal,
      flopView,
    );
    expect(record.fallback).toBe(true);
    expect(record.action).toEqual({ type: "fold" });
    expect(record.jev?.chosen).toBe("fold");
    expect(record.error).toMatch(/not offered/);
  });
});
