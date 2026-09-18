import { describe, expect, it } from "vitest";
import { createDeck, parseCards, sameCard } from "../engine/cards";
import { Hand } from "../engine/hand";
import type { Card, HandSnapshot } from "../engine/index";
import { buildFeatures, detectDraws, positionOf, preflopStrength } from "./features";

function riggedDeck(front: string): Card[] {
  const cards = parseCards(front);
  const rest = createDeck().filter((card) => !cards.some((c) => sameCard(c, card)));
  return [...cards, ...rest];
}

function snapshotWith(seatIds: number[], button: number): HandSnapshot {
  return {
    handNumber: 0,
    button,
    street: "preflop",
    board: [],
    players: seatIds.map((seat) => ({
      seat,
      stack: 100,
      holeCards: [parseCards("As")[0] as Card, parseCards("Kd")[0] as Card],
      contributed: 0,
      streetBet: 0,
      folded: false,
      allIn: false,
    })),
    actingSeat: seatIds[0] ?? null,
    toAct: seatIds,
    currentBet: 0,
    minRaise: 2,
    bigBlind: 2,
    pot: 0,
    complete: false,
  };
}

describe("positionOf", () => {
  it("names heads-up positions", () => {
    const snap = snapshotWith([0, 1], 0);
    expect(positionOf(0, snap)).toBe("SB");
    expect(positionOf(1, snap)).toBe("BB");
  });

  it("names three-handed positions", () => {
    const snap = snapshotWith([0, 1, 2], 0);
    expect([0, 1, 2].map((s) => positionOf(s, snap))).toEqual(["BTN", "SB", "BB"]);
  });

  it("names six-handed positions with the button anywhere", () => {
    const snap = snapshotWith([0, 1, 2, 3, 4, 5], 3);
    expect([4, 5, 0, 1, 2, 3].map((s) => positionOf(s, snap))).toEqual([
      "SB",
      "BB",
      "UTG",
      "MP",
      "CO",
      "BTN",
    ]);
  });

  it("names four- and five-handed positions (button-relative)", () => {
    const four = snapshotWith([0, 1, 2, 3], 0);
    expect([1, 2, 3, 0].map((s) => positionOf(s, four))).toEqual(["SB", "BB", "CO", "BTN"]);
    const five = snapshotWith([0, 1, 2, 3, 4], 0);
    expect([1, 2, 3, 4, 0].map((s) => positionOf(s, five))).toEqual([
      "SB",
      "BB",
      "UTG",
      "CO",
      "BTN",
    ]);
  });
});

describe("preflopStrength", () => {
  it.each([
    ["As Ad", "premium"],
    ["Ah Kd", "premium"],
    ["Jc Jd", "premium"],
    ["Tc Td", "strong"],
    ["Ah Qd", "strong"],
    ["Ks Qs", "strong"],
    ["7c 7d", "medium"],
    ["As 5s", "medium"],
    ["Js Ts", "medium"],
    ["Kh Qd", "medium"],
    ["3c 3d", "weak"],
    ["8s 7s", "weak"],
    ["Ah 4d", "weak"],
    ["7c 2d", "trash"],
    ["Kh 5d", "trash"],
  ])("rates %s as %s", (text, expected) => {
    const [a, b] = parseCards(text) as [Card, Card];
    expect(preflopStrength([a, b])).toBe(expected);
  });
});

describe("detectDraws", () => {
  const cards = (text: string) => parseCards(text);
  it("finds a flush draw using a hole card", () => {
    expect(detectDraws(cards("Ah Kh"), cards("2h 7h 9c"))).toEqual(["flush_draw"]);
  });
  it("ignores a four-flush entirely on the board", () => {
    expect(detectDraws(cards("Ac Kd"), cards("2h 7h 9h Th"))).toEqual([]);
  });
  it("finds an open-ended straight draw", () => {
    expect(detectDraws(cards("9c 8d"), cards("7h 6s Kd"))).toEqual(["open_ended"]);
  });
  it("finds a gutshot", () => {
    expect(detectDraws(cards("9c 8d"), cards("6h 5s Kd"))).toEqual(["gutshot"]);
  });
  it("reports nothing on the river or preflop", () => {
    expect(detectDraws(cards("9c 8d"), cards("7h 6s Kd 2c 2d"))).toEqual([]);
    expect(detectDraws(cards("9c 8d"), [])).toEqual([]);
  });
  it("does not call a made straight a draw", () => {
    expect(detectDraws(cards("9c 8d"), cards("7h 6s 5d"))).toEqual([]);
  });
  it("ignores a straight draw that lives entirely on the board", () => {
    expect(detectDraws(cards("2c 2d"), cards("5h 6s 7d 8c"))).toEqual([]);
  });
  it("still finds a straight draw on the turn when a hole card is needed", () => {
    expect(detectDraws(cards("8s 3c"), cards("5h 6s 7d Kc"))).toEqual(["open_ended"]);
  });
});

describe("buildFeatures", () => {
  it("compresses a live hand into BB-denominated features", () => {
    const hand = new Hand({
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
    const persona = { name: "TAG", description: "Tight and aggressive." };
    const features = buildFeatures({ snapshot: hand.snapshot(), seat: 0, actions: [], persona });
    expect(features.persona).toEqual(persona);
    expect(features.hand).toEqual({
      street: "preflop",
      holeCards: ["Ah", "Kh"],
      board: [],
      madeHand: null,
      draws: [],
      preflopStrength: "premium",
    });
    expect(features.table).toEqual({
      position: "BTN",
      playersInHand: 3,
      playersToAct: 2,
      potBB: 1.5,
      toCallBB: 1,
      potOddsPct: 40,
      effectiveStackBB: 10,
      stacksBB: [
        { seat: 0, stackBB: 10, isAllIn: false, folded: false },
        { seat: 1, stackBB: 9.5, isAllIn: false, folded: false },
        { seat: 2, stackBB: 9, isAllIn: false, folded: false },
      ],
    });
    expect(features.history).toEqual([]);
    expect(features.importantContext.length).toBeGreaterThan(2);
  });

  it("records the hand's action history in BB", () => {
    const hand = new Hand({
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
    hand.act(0, { type: "raise", amount: 30 });
    const actions = hand.events.filter((e) => e.type === "ActionTaken");
    const features = buildFeatures({
      snapshot: hand.snapshot(),
      seat: 1,
      actions,
      persona: { name: "x", description: "y" },
    });
    expect(features.history).toEqual([
      { street: "preflop", seat: 0, action: "raise to 3", committedBB: 3 },
    ]);
    expect(features.table.toCallBB).toBe(2.5);
    expect(features.table.position).toBe("SB");
    // madeHand is computed only when there is a board; on the flop a pair shows up.
    hand.act(1, { type: "call" });
    hand.act(2, { type: "call" });
    const flop = buildFeatures({
      snapshot: hand.snapshot(),
      seat: 1,
      actions: hand.events.filter((e) => e.type === "ActionTaken"),
      persona: { name: "x", description: "y" },
    });
    expect(flop.hand.street).toBe("flop");
    expect(flop.hand.madeHand).not.toBeNull();
  });
});
