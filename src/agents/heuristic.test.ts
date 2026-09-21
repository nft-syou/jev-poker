import { describe, expect, it } from "vitest";
import { parseCards } from "../engine/cards";
import { createRng } from "../engine/rng";
import type { LegalActions } from "../engine/types";
import type { PlayerView } from "../engine/view";
import { featuresFromView } from "../jev/features";
import { chartPreflop, HeuristicAgent } from "./heuristic";
import { isLegal, randomView } from "./testutil";

const agent = new HeuristicAgent();
const seats = (n: number) =>
  Array.from({ length: n }, (_, seat) => ({ seat, stack: 10000, isAllIn: false, folded: false }));
const base = (o: Partial<PlayerView>): PlayerView => ({
  seat: 0,
  street: "preflop",
  holeCards: parseCards("Ah Ad"),
  board: [],
  stacks: seats(6),
  pot: 150,
  toCall: 100,
  currentBet: 100,
  committedThisStreet: 0,
  bigBlind: 100,
  position: "UTG",
  history: [],
  ...o,
});
const open: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 100,
  minRaiseTo: 200,
  maxRaiseTo: 10000,
};
const option: LegalActions = {
  canFold: false,
  canCheck: true,
  callAmount: null,
  minRaiseTo: 200,
  maxRaiseTo: 10000,
};
const persona = { name: "test", description: "" };

describe("HeuristicAgent", () => {
  it("always returns a legal action and is deterministic", async () => {
    const rng = createRng(21);
    for (let i = 0; i < 300; i++) {
      const { view, legal } = randomView(rng);
      const a = await agent.decide(view, legal);
      expect(isLegal(a, legal, view), JSON.stringify({ a, legal, view })).toBe(true);
      expect(await agent.decide(view, legal)).toEqual(a);
    }
  }, 60_000);

  it("opens by position in an unopened pot", async () => {
    expect(await agent.decide(base({}), open)).toEqual({ type: "raise", amount: 250 });
    expect(await agent.decide(base({ holeCards: parseCards("9h 8h") }), open)).toEqual({
      type: "fold",
    }); // weak from UTG
    expect(
      await agent.decide(base({ holeCards: parseCards("9h 8h"), position: "BTN" }), open),
    ).toEqual({ type: "raise", amount: 250 });
    expect(
      await agent.decide(base({ holeCards: parseCards("7h 2d"), position: "BTN" }), open),
    ).toEqual({ type: "fold" });
  });

  it("steals with everything but trash from the heads-up button", async () => {
    // Heads-up the button is named BTN and has posted the small blind.
    const v = (hole: string) =>
      base({
        holeCards: parseCards(hole),
        stacks: seats(2),
        position: "BTN",
        toCall: 50,
        committedThisStreet: 50,
      });
    const l = { ...open, callAmount: 50 };
    expect(await agent.decide(v("9h 8h"), l)).toEqual({ type: "raise", amount: 250 });
    expect(await agent.decide(v("7h 2d"), l)).toEqual({ type: "fold" });
  });

  it("continues against a re-raise only with premium hands", async () => {
    const history = [
      { street: "preflop" as const, seat: 0, action: { type: "raise" as const, amount: 250 } },
      { street: "preflop" as const, seat: 1, action: { type: "raise" as const, amount: 750 } },
    ];
    const v = (hole: string) =>
      base({
        holeCards: parseCards(hole),
        history,
        toCall: 500,
        currentBet: 750,
        committedThisStreet: 250,
        pot: 1150,
      });
    const l = { ...open, callAmount: 500, minRaiseTo: 1250 };
    expect(await agent.decide(v("Ah Ad"), l)).toEqual({ type: "call" });
    expect(await agent.decide(v("Th Td"), l)).toEqual({ type: "fold" });
  });

  it("reads a shove in the history (recorded as allin) as a raise", async () => {
    const history = [
      { street: "preflop" as const, seat: 0, action: { type: "raise" as const, amount: 250 } },
      { street: "preflop" as const, seat: 1, action: { type: "allin" as const } },
    ];
    const v = (hole: string) =>
      base({
        holeCards: parseCards(hole),
        history,
        toCall: 9750,
        currentBet: 10000,
        committedThisStreet: 250,
        pot: 10400,
        stacks: seats(6).map((s) =>
          s.seat === 1
            ? { ...s, stack: 0, isAllIn: true }
            : s.seat === 0
              ? { ...s, stack: 9750 }
              : s,
        ),
      });
    const l: LegalActions = { ...open, callAmount: 9750, minRaiseTo: null, maxRaiseTo: null };
    expect(await agent.decide(v("Ah Ad"), l)).toEqual({ type: "call" });
    expect(await agent.decide(v("Th Td"), l)).toEqual({ type: "fold" });
  });

  it("bets strong hands and folds air postflop", async () => {
    const flop = (hole: string) =>
      base({
        street: "flop",
        holeCards: parseCards(hole),
        board: parseCards("Kc 7s 2d"),
        pot: 600,
        toCall: 0,
        currentBet: 0,
      });
    const free: LegalActions = {
      canFold: false,
      canCheck: true,
      callAmount: null,
      minRaiseTo: 100,
      maxRaiseTo: 10000,
    };
    expect(await agent.decide(flop("Kh Kd"), free)).toEqual({ type: "bet", amount: 600 }); // top set: pot
    expect(await agent.decide(flop("5h 4d"), free)).toEqual({ type: "check" });
    const facing = base({
      street: "flop",
      holeCards: parseCards("5h 4d"),
      board: parseCards("Kc 7s 2d"),
      pot: 900,
      toCall: 300,
      currentBet: 300,
    });
    expect(await agent.decide(facing, { ...open, callAmount: 300, minRaiseTo: 600 })).toEqual({
      type: "fold",
    });
  });

  it("raises (not bets) over a bet, and shoves when the raise reaches the stack", async () => {
    const facing = base({
      street: "flop",
      holeCards: parseCards("Kh Kd"),
      board: parseCards("Kc 7s 2d"),
      pot: 900,
      toCall: 300,
      currentBet: 300,
      history: [{ street: "flop", seat: 1, action: { type: "bet", amount: 300 } }],
    });
    // The bet being matched plus the pot after calling: 300 + (900 + 300).
    expect(await agent.decide(facing, { ...open, callAmount: 300, minRaiseTo: 600 })).toEqual({
      type: "raise",
      amount: 1500,
    });
    expect(
      await agent.decide(facing, { ...open, callAmount: 300, minRaiseTo: 600, maxRaiseTo: 1400 }),
    ).toEqual({ type: "allin" });
  });
});

describe("chartPreflop", () => {
  const decide = (view: PlayerView, legal: LegalActions) =>
    chartPreflop(featuresFromView(view, persona), view, legal);

  it("works from the features alone, like the agent", async () => {
    const view = base({ holeCards: parseCards("Ah Kd") });
    expect(decide(view, open)).toEqual(await agent.decide(view, open));
    expect(decide(view, open)).toEqual({ type: "raise", amount: 250 });
  });

  it("isolates limpers to 4bb, as a raise even from the big blind's option", () => {
    const limped = [{ street: "preflop" as const, seat: 3, action: { type: "call" as const } }];
    const bigBlind = base({
      holeCards: parseCards("Th Td"),
      position: "BB",
      history: limped,
      toCall: 0,
      currentBet: 100,
      committedThisStreet: 100,
      pot: 250,
    });
    expect(decide(bigBlind, option)).toEqual({ type: "raise", amount: 400 });
    // Without a hand worth isolating it takes the free flop.
    expect(decide({ ...bigBlind, holeCards: parseCards("9h 8h") }, option)).toEqual({
      type: "check",
    });
    // Facing the limp from the button: a weak hand calls one big blind, trash folds.
    const button = base({ position: "BTN", history: limped, pot: 250 });
    expect(decide({ ...button, holeCards: parseCards("9h 8h") }, open)).toEqual({ type: "call" });
    expect(decide({ ...button, holeCards: parseCards("7h 2d") }, open)).toEqual({ type: "fold" });
  });

  it("3-bets premium to three times a single raise, and only calls a 3-bet", () => {
    const raised = [
      { street: "preflop" as const, seat: 2, action: { type: "raise" as const, amount: 300 } },
    ];
    const facing = base({ history: raised, toCall: 300, currentBet: 300, pot: 450 });
    const l = { ...open, callAmount: 300, minRaiseTo: 500 };
    expect(decide(facing, l)).toEqual({ type: "raise", amount: 900 });
    expect(decide({ ...facing, holeCards: parseCards("Ah Qd") }, l)).toEqual({ type: "call" });
    expect(decide({ ...facing, holeCards: parseCards("8h 8d") }, l)).toEqual({ type: "call" });
    expect(decide({ ...facing, holeCards: parseCards("9h 8h") }, l)).toEqual({ type: "fold" });

    const reraised = [
      ...raised,
      { street: "preflop" as const, seat: 4, action: { type: "raise" as const, amount: 900 } },
    ];
    const cold = base({ history: reraised, toCall: 900, currentBet: 900, pot: 1350 });
    const l2 = { ...open, callAmount: 900, minRaiseTo: 1500 };
    expect(decide(cold, l2)).toEqual({ type: "call" });
    expect(decide({ ...cold, holeCards: parseCards("Ah Qd") }, l2)).toEqual({ type: "fold" });
  });
});
