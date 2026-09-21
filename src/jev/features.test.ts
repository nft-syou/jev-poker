import { describe, expect, it } from "vitest";
import { createDeck, parseCards, sameCard } from "../engine/cards";
import { Hand } from "../engine/hand";
import type { Card, HandSnapshot } from "../engine/index";
import type { PlayerView } from "../engine/view";
import {
  buildFeatures,
  detectDraws,
  featuresFromView,
  type OpponentStats,
  POSTFLOP_TASK,
  PREFLOP_TASK,
  positionOf,
  preflopStrength,
  TASK,
} from "./features";
import { PRESET_PERSONAS, personaPrompt } from "./personas";

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

function preset(id: string) {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`no preset persona ${id}`);
  return personaPrompt(persona);
}

describe("positionOf", () => {
  it("names heads-up positions", () => {
    const snap = snapshotWith([0, 1], 0);
    // Heads-up the button posts the small blind; it is named for acting last postflop.
    expect(positionOf(0, snap)).toBe("BTN");
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
    expect(features.task).toBe(TASK);
    expect(features.persona).toEqual(persona);
    // Preflop there is no made hand and no draw: the keys are absent, not null or empty.
    expect(features.hand).toEqual({
      street: "preflop",
      holeCards: "Ah Kh",
      board: "",
      preflopStrength: "premium",
      // AKs against two random hands is about 51%; 150 seeded samples land on 56.
      equityVsRandomPct: 56,
    });
    expect(features.table).toEqual({
      position: "BTN",
      playersInHand: 3,
      opponentsNotAllIn: 2,
      potBB: 1.5,
      toCallBB: 1,
      potOddsPct: 40,
      requiredEquityPct: 40,
      effectiveStackBB: 9.5,
      stackToPotRatio: 6.7,
      unopenedPot: true,
      raisesThisStreet: 0,
      myBetWasRaisedThisStreet: false,
      stacksBB: [
        { seat: 0, isMe: true, stackBB: 10, isAllIn: false, folded: false },
        { seat: 1, isMe: false, stackBB: 9.5, isAllIn: false, folded: false },
        { seat: 2, isMe: false, stackBB: 9, isAllIn: false, folded: false },
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
      { street: "preflop", seat: 0, isMe: false, action: "raise", amountBB: 3 },
    ]);
    expect(features.table.toCallBB).toBe(2.5);
    expect(features.table.position).toBe("SB");
    expect(features.table.unopenedPot).toBe(false);
    expect(features.table.raisesThisStreet).toBe(1);
    // madeHand is computed only when there is a board; on the flop a pair shows up.
    expect("madeHand" in features.hand).toBe(false);
    hand.act(1, { type: "call" });
    hand.act(2, { type: "call" });
    const flop = buildFeatures({
      snapshot: hand.snapshot(),
      seat: 1,
      actions: hand.events.filter((e) => e.type === "ActionTaken"),
      persona: { name: "x", description: "y" },
    });
    expect(flop.hand.street).toBe("flop");
    expect(flop.hand.madeHand).toBeDefined();
    expect(flop.history.map((h) => [h.seat, h.isMe, h.action])).toEqual([
      [0, false, "raise"],
      [1, true, "call"],
      [2, false, "call"],
    ]);
  });

  it("passes the feature options through to featuresFromView", () => {
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
    const features = buildFeatures({
      snapshot: hand.snapshot(),
      seat: 0,
      actions: [],
      persona: { name: "x", description: "y" },
      options: { style: "split", rangeEquity: true },
    });
    expect(features.task).toBe(PREFLOP_TASK);
    expect(features.hand.equityVsRangePct).toBeDefined();
  });
});

// A flop seen from the button at a three-seat table: seat 1 raised preflop, seat 2 is all in.
const view: PlayerView = {
  seat: 0,
  street: "flop",
  holeCards: parseCards("Ah Kh"),
  board: parseCards("Qh Jh 2c"),
  stacks: [
    { seat: 0, stack: 9000, isAllIn: false, folded: false },
    { seat: 1, stack: 5000, isAllIn: false, folded: false },
    { seat: 2, stack: 0, isAllIn: true, folded: false },
  ],
  pot: 1200,
  toCall: 400,
  currentBet: 400,
  committedThisStreet: 0,
  bigBlind: 100,
  position: "BTN",
  history: [{ street: "preflop", seat: 1, action: { type: "raise", amount: 300 } }],
};

describe("featuresFromView", () => {
  it("matches snapshot shape", () => {
    const s = featuresFromView(view, preset("tag"));
    expect(s.persona.name).toBe("TAG");
    expect(s.hand).toMatchObject({
      street: "flop",
      holeCards: "Ah Kh",
      board: "Qh Jh 2c",
      madeHand: "high_card",
      draws: ["flush_draw", "gutshot"],
      preflopStrength: "premium",
    });
    expect(s.table).toMatchObject({
      position: "BTN",
      playersInHand: 3,
      opponentsNotAllIn: 1,
      potBB: 12,
      toCallBB: 4,
      potOddsPct: 25,
      requiredEquityPct: 25,
      effectiveStackBB: 50,
      stackToPotRatio: 7.5,
    });
    expect(s.history).toEqual([
      { street: "preflop", seat: 1, isMe: false, action: "raise", amountBB: 3 },
    ]);
    // An explicit actor object measurably hurt play; isMe flags carry identity.
    expect("actor" in s).toBe(false);
    expect(s.table.stacksBB.map((x) => x.isMe)).toEqual([true, false, false]);
    expect(s).toMatchSnapshot();
  });

  it("never includes other hole cards", () => {
    // Structural check: every card-looking token in the serialised state must be
    // one of the acting seat's hole cards or a board card. Seats 1 and 2 hold
    // cards too, and nothing about them may leak in.
    const json = JSON.stringify(featuresFromView(view, preset("tag")));
    const tokens = json.match(/\b[2-9TJQKA][cdhs]\b/g) ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    expect([...new Set(tokens)].sort()).toEqual(["2c", "Ah", "Jh", "Kh", "Qh"]);
  });

  it("copies only the name and description of the persona", () => {
    const persona = { name: "x", description: "y", variance: 0.3 };
    expect(featuresFromView(view, persona).persona).toEqual({ name: "x", description: "y" });
  });
});

describe("featuresFromView omissions", () => {
  const base: PlayerView = { ...view, history: [] };
  it("omits madeHand and draws preflop", () => {
    const s = featuresFromView({ ...base, street: "preflop", board: [] }, preset("rock"));
    expect("madeHand" in s.hand).toBe(false);
    expect("pairKind" in s.hand).toBe(false);
    expect("draws" in s.hand).toBe(false);
    expect("beatsPctOfHands" in s.hand).toBe(false);
    expect("board_texture" in s.hand).toBe(false);
    expect(s.hand.board).toBe("");
  });
  it("omits draws but keeps madeHand on the river", () => {
    const s = featuresFromView(
      { ...base, street: "river", board: parseCards("Qh Jh 2c 7d 3s") },
      preset("rock"),
    );
    expect(s.hand.madeHand).toBe("high_card");
    expect("draws" in s.hand).toBe(false);
  });
  it("reports pairKind only for a one-pair hand", () => {
    const pair = featuresFromView({ ...base, board: parseCards("Ad 7s 2c") }, preset("rock"));
    expect(pair.hand).toMatchObject({ madeHand: "pair", pairKind: "top_pair" });
    expect("pairKind" in featuresFromView(base, preset("rock")).hand).toBe(false);
  });
  it("reports zero pot odds when nothing is due and rounds bb to one decimal", () => {
    const s = featuresFromView({ ...base, toCall: 0, pot: 1250 }, preset("rock"));
    expect(s.table.potOddsPct).toBe(0);
    expect(s.table.requiredEquityPct).toBe(0);
    expect(s.table.toCallBB).toBe(0);
    expect(s.table.potBB).toBe(12.5);
    expect(s.table.stacksBB).toEqual([
      { seat: 0, isMe: true, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, isMe: false, stackBB: 50, isAllIn: false, folded: false },
      { seat: 2, isMe: false, stackBB: 0, isAllIn: true, folded: false },
    ]);
  });
  it("marks a folded seat", () => {
    const stacks = [
      { seat: 0, stack: 9000, isAllIn: false, folded: false },
      { seat: 1, stack: 5000, isAllIn: false, folded: true },
    ];
    const s = featuresFromView({ ...base, stacks }, preset("rock"));
    expect(s.table.playersInHand).toBe(1);
    expect(s.table.stacksBB).toEqual([
      // two seats: no identity flags heads-up
      { seat: 0, stackBB: 90, isAllIn: false, folded: false },
      { seat: 1, stackBB: 50, isAllIn: false, folded: true },
    ]);
  });
  it("tolerates an empty stack list", () => {
    const s = featuresFromView({ ...base, stacks: [] }, preset("rock"));
    expect(s.table).toMatchObject({ playersInHand: 0, opponentsNotAllIn: 0, effectiveStackBB: 0 });
  });
});

describe("featuresFromView stack to pot ratio", () => {
  it("divides the acting stack by the pot, to one decimal", () => {
    expect(featuresFromView(view, preset("tag")).table.stackToPotRatio).toBe(7.5);
    expect(featuresFromView({ ...view, pot: 7000 }, preset("tag")).table.stackToPotRatio).toBe(1.3);
  });
  it("is a large constant when the pot is empty", () => {
    expect(featuresFromView({ ...view, pot: 0 }, preset("tag")).table.stackToPotRatio).toBe(99);
  });
});

describe("featuresFromView opponents not all in", () => {
  it("counts live opponents with chips behind, never the actor or folded seats", () => {
    const seat = (id: number, over: Partial<PlayerView["stacks"][number]> = {}) => ({
      seat: id,
      stack: 5000,
      isAllIn: false,
      folded: false,
      ...over,
    });
    const table = (stacks: PlayerView["stacks"]) =>
      featuresFromView({ ...view, stacks }, preset("tag")).table;
    expect(table([seat(0), seat(1), seat(2), seat(3)])).toMatchObject({
      playersInHand: 4,
      opponentsNotAllIn: 3,
    });
    expect(
      table([seat(0), seat(1, { folded: true }), seat(2, { stack: 0, isAllIn: true }), seat(3)]),
    ).toMatchObject({ playersInHand: 3, opponentsNotAllIn: 1 });
    // The actor being all in does not change the count of opponents.
    expect(table([seat(0, { stack: 0, isAllIn: true }), seat(1)])).toMatchObject({
      playersInHand: 2,
      opponentsNotAllIn: 1,
    });
  });
});

describe("featuresFromView street aggression", () => {
  const mk = (history: PlayerView["history"]) =>
    featuresFromView({ ...view, history }, preset("tag")).table;
  it("flags a raised bet on the current street only", () => {
    expect(mk([])).toMatchObject({ raisesThisStreet: 0, myBetWasRaisedThisStreet: false });
    const raisedOnFlop: PlayerView["history"] = [
      { street: "flop", seat: 0, action: { type: "bet", amount: 200 } },
      { street: "flop", seat: 1, action: { type: "raise", amount: 600 } },
    ];
    expect(mk(raisedOnFlop)).toMatchObject({
      raisesThisStreet: 2,
      myBetWasRaisedThisStreet: true,
    });
    const raisedPreflopOnly: PlayerView["history"] = [
      { street: "preflop", seat: 0, action: { type: "raise", amount: 300 } },
      { street: "preflop", seat: 1, action: { type: "raise", amount: 900 } },
    ];
    expect(mk(raisedPreflopOnly)).toMatchObject({
      raisesThisStreet: 0,
      myBetWasRaisedThisStreet: false,
    });
    const iRaisedLast: PlayerView["history"] = [
      { street: "flop", seat: 1, action: { type: "bet", amount: 200 } },
      { street: "flop", seat: 0, action: { type: "raise", amount: 600 } },
    ];
    expect(mk(iRaisedLast)).toMatchObject({
      raisesThisStreet: 2,
      myBetWasRaisedThisStreet: false,
    });
  });
  it("counts an all-in shove as a raise", () => {
    // `historyEntry` reports a bet or raise that put the seat all in as `allin`.
    const shoved: PlayerView["history"] = [
      { street: "flop", seat: 0, action: { type: "bet", amount: 200 } },
      { street: "flop", seat: 2, action: { type: "allin" } },
    ];
    expect(mk(shoved)).toMatchObject({ raisesThisStreet: 2, myBetWasRaisedThisStreet: true });
    const s = featuresFromView({ ...view, history: shoved }, preset("tag"));
    expect(s.history[1]).toEqual({ street: "flop", seat: 2, isMe: false, action: "allin" });
  });
});

describe("featuresFromView unopened pot", () => {
  const pre = (history: PlayerView["history"]) =>
    featuresFromView({ ...view, street: "preflop", board: [], history }, preset("tag")).table;
  it("is true preflop when only folds precede the actor, false once someone enters, absent postflop", () => {
    expect(pre([]).unopenedPot).toBe(true);
    expect(pre([{ street: "preflop", seat: 1, action: { type: "fold" } }]).unopenedPot).toBe(true);
    expect(pre([{ street: "preflop", seat: 1, action: { type: "call" } }]).unopenedPot).toBe(false);
    expect(
      pre([{ street: "preflop", seat: 2, action: { type: "raise", amount: 300 } }]).unopenedPot,
    ).toBe(false);
    expect("unopenedPot" in featuresFromView(view, preset("tag")).table).toBe(false);
  });
});

describe("featuresFromView split format", () => {
  it("gives preflop and postflop decisions different task and context, and leaves unified unchanged", () => {
    const unified = featuresFromView(view, preset("tag"));
    const explicit = featuresFromView(view, preset("tag"), { style: "unified" });
    const post = featuresFromView(view, preset("tag"), { style: "split" });
    const pre = featuresFromView({ ...view, street: "preflop", board: [] }, preset("tag"), {
      style: "split",
    });
    expect(unified.task).toBe(TASK);
    expect(explicit).toEqual(unified);
    expect(post.task).toBe(POSTFLOP_TASK);
    expect(pre.task).toBe(PREFLOP_TASK);
    expect(post.task).not.toBe(pre.task);
    expect(post.importantContext.some((l) => l.includes("beatsPctOfHands"))).toBe(true);
    expect(pre.importantContext.some((l) => l.includes("beatsPctOfHands"))).toBe(false);
    expect(pre.importantContext.some((l) => l.includes("unopenedPot"))).toBe(true);
    expect(post.importantContext.some((l) => l.includes("unopenedPot"))).toBe(false);
    // Hand/table content is the same either way; only the wording differs.
    expect(post.hand).toEqual(unified.hand);
    expect(post.table).toEqual(unified.table);
  });
});

describe("featuresFromView identity flags", () => {
  it("marks the actor only at tables with three or more seats", () => {
    const three = featuresFromView(view, preset("tag"));
    expect(three.table.stacksBB.map((x) => x.isMe)).toEqual([true, false, false]);
    expect(three.history.every((h) => h.isMe === false)).toBe(true);
    const headsUp = featuresFromView({ ...view, stacks: view.stacks.slice(0, 2) }, preset("tag"));
    expect(headsUp.table.stacksBB.some((x) => "isMe" in x)).toBe(false);
    expect(headsUp.history.some((h) => "isMe" in h)).toBe(false);
  });
});

describe("featuresFromView range-aware equity", () => {
  const kk: PlayerView = {
    ...view,
    street: "preflop",
    board: [],
    // Ks Kc, not the Kh Kd of the old test: both estimates are 150 seeded samples, and with the
    // new RNG stream Kh Kd draws 78 / 78 where 20,000 samples give 71 / 82.
    holeCards: parseCards("Ks Kc"),
    stacks: view.stacks.slice(0, 2),
  };
  const on = { rangeEquity: true };

  it("is lower than the random-hand equity once an opponent has raised, and equal-ish with no action", () => {
    expect("equityVsRangePct" in featuresFromView({ ...kk, history: [] }, preset("tag")).hand).toBe(
      false,
    );
    const off = featuresFromView({ ...kk, history: [] }, preset("tag"), { rangeEquity: false });
    expect("equityVsRangePct" in off.hand).toBe(false);
    const quiet = featuresFromView({ ...kk, history: [] }, preset("tag"), on).hand;
    expect(Math.abs((quiet.equityVsRangePct ?? 0) - quiet.equityVsRandomPct)).toBeLessThanOrEqual(
      8,
    );
    const reraised = featuresFromView(
      {
        ...kk,
        history: [
          { street: "preflop", seat: 0, action: { type: "raise", amount: 300 } },
          { street: "preflop", seat: 1, action: { type: "raise", amount: 900 } },
        ],
      },
      preset("tag"),
      on,
    ).hand;
    // KK: about 82% against a random hand, about 71% against a 3-bet range.
    expect(reraised).toMatchObject({ equityVsRandomPct: 83, equityVsRangePct: 75 });
    expect(reraised.equityVsRangePct ?? 100).toBeLessThan(reraised.equityVsRandomPct - 5);
  });

  it("swaps the guidance to refer to equityVsRangePct, in both formats", () => {
    const discount = "discount it heavily against aggression";
    for (const style of ["unified", "split"] as const) {
      const plain = featuresFromView(view, preset("tag"), { style }).importantContext;
      const ranged = featuresFromView(view, preset("tag"), { style, ...on }).importantContext;
      expect(plain.some((l) => l.includes("equityVsRangePct"))).toBe(false);
      expect(plain.some((l) => l.includes(discount))).toBe(true);
      expect(plain.some((l) => l.includes("compare your equity with requiredEquityPct"))).toBe(
        true,
      );
      expect(ranged).toHaveLength(plain.length);
      expect(ranged.some((l) => l.includes(discount))).toBe(false);
      expect(ranged.some((l) => l.includes("judge calls and raises by equityVsRangePct"))).toBe(
        true,
      );
      expect(
        ranged.some((l) => l.includes("compare equityVsRangePct with requiredEquityPct")),
      ).toBe(true);
      expect(ranged.some((l) => l.includes("compare your equity with"))).toBe(false);
    }
  });
});

describe("featuresFromView opponent statistics", () => {
  const stats: OpponentStats = { hands: 40, vpipPct: 22, pfrPct: 15, postflopAggressionPct: 35 };

  it("lists the known live opponents and adds the guidance that explains them", () => {
    const asked: number[] = [];
    const s = featuresFromView(view, preset("tag"), {
      opponentStatsFor: (seat) => {
        asked.push(seat);
        return seat === 1 ? stats : null;
      },
    });
    expect(s.table.opponentStats).toEqual([{ seat: 1, ...stats }]);
    expect(asked).not.toContain(0); // never the acting seat
    const plain = featuresFromView(view, preset("tag")).importantContext;
    expect(s.importantContext).toHaveLength(plain.length + 1);
    expect(s.importantContext.slice(0, plain.length)).toEqual(plain);
    expect(s.importantContext.at(-1)).toContain("opponentStats describes");
  });

  it("is absent, with no extra guidance, when nothing is known or nothing was asked for", () => {
    const plain = featuresFromView(view, preset("tag"));
    expect("opponentStats" in plain.table).toBe(false);
    const unknown = featuresFromView(view, preset("tag"), { opponentStatsFor: () => null });
    expect("opponentStats" in unknown.table).toBe(false);
    expect(unknown.importantContext).toEqual(plain.importantContext);
  });

  it("leaves folded opponents out", () => {
    const stacks = view.stacks.map((s) => (s.seat === 1 ? { ...s, folded: true } : s));
    const s = featuresFromView({ ...view, stacks }, preset("tag"), {
      opponentStatsFor: () => stats,
    });
    expect(s.table.opponentStats).toEqual([{ seat: 2, ...stats }]);
  });
});
