import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { APIError, AuthenticationError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { createDeck, parseCards, sameCard } from "../engine/cards";
import { Hand } from "../engine/hand";
import type { Card } from "../engine/index";
import { createRng } from "../engine/rng";
import type { LegalActions } from "../engine/types";
import type { JevBackend } from "./backend";
import { decideAction, fallbackAction, sampleLabel, sizingToAmount } from "./decide";
import { buildFeatures } from "./features";
import { createMockBackend } from "./mock-backend";

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
  const snapshot = hand.snapshot(); // pot 15, current bet 10, seat 0 has 0 in

  it("maps rubric levels to pot fractions and clamps to legal bounds", () => {
    expect(sizingToAmount(0, legal, snapshot, 0)).toBe(20); // minimum
    expect(sizingToAmount(3, legal, snapshot, 0)).toBe(35); // pot-sized: 10 + (15 + 10)
    expect(sizingToAmount(4, legal, snapshot, 0)).toBe(48); // 1.5x: 10 + 25 * 1.5 = 47.5 -> 48
    expect(sizingToAmount(5, legal, snapshot, 0)).toBe(100); // all in
    expect(sizingToAmount(4.7, legal, snapshot, 0)).toBe(100);
    expect(sizingToAmount(1.5, legal, snapshot, 0)).toBe(23); // 10 + 25 * 0.5 = 22.5 -> 23
  });

  it("never goes below the minimum or above the maximum", () => {
    const tight: LegalActions = { ...legal, minRaiseTo: 40, maxRaiseTo: 42 };
    expect(sizingToAmount(0, tight, snapshot, 0)).toBe(40);
    expect(sizingToAmount(4.9, tight, snapshot, 0)).toBe(42);
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
    expect(record.action).toEqual({ type: "raise", amount: 35 });
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
