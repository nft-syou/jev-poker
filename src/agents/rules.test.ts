import { describe, expect, it } from "vitest";
import { parseCards } from "../engine/cards";
import type { LegalActions } from "../engine/types";
import type { PlayerView } from "../engine/view";
import { RulesAgent } from "./rules";

/** Heads-up on the button (which posts the small blind): 50 in, 50 more to call the big blind. */
const base = (o: Partial<PlayerView>): PlayerView => {
  const committedThisStreet = o.committedThisStreet ?? (o.street === undefined ? 50 : 0);
  return {
    seat: 0,
    street: "preflop",
    holeCards: parseCards("Ah Ad"),
    board: [],
    stacks: [
      { seat: 0, stack: 10000, isAllIn: false, folded: false },
      { seat: 1, stack: 10000, isAllIn: false, folded: false },
    ],
    pot: 150,
    toCall: 50,
    bigBlind: 100,
    position: "BTN",
    history: [],
    ...o,
    currentBet: o.currentBet ?? (o.toCall ?? 50) + committedThisStreet,
    committedThisStreet,
  };
};
const open: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 50,
  minRaiseTo: 200,
  maxRaiseTo: 10000,
};
const agent = new RulesAgent();

describe("RulesAgent preflop", () => {
  it("opens premium to 3bb", async () => {
    const v = base({});
    expect(v.currentBet).toBe(100);
    // The big blind is a bet, so an open is a raise.
    expect(await agent.decide(v, open)).toEqual({ type: "raise", amount: 300 });
  });
  it("3-bets premium to 3x", async () => {
    const v = base({
      history: [{ street: "preflop", seat: 1, action: { type: "raise", amount: 300 } }],
      toCall: 250,
      pot: 450,
    });
    expect(v.currentBet).toBe(300);
    expect(await agent.decide(v, { ...open, callAmount: 250, minRaiseTo: 500 })).toEqual({
      type: "raise",
      amount: 900,
    });
  });
  it("re-raises premium to three times the largest raise so far", async () => {
    const v = base({
      history: [
        { street: "preflop", seat: 1, action: { type: "raise", amount: 300 } },
        { street: "preflop", seat: 0, action: { type: "raise", amount: 900 } },
        { street: "preflop", seat: 1, action: { type: "raise", amount: 2000 } },
      ],
      toCall: 1100,
      committedThisStreet: 900,
      pot: 2900,
    });
    expect(await agent.decide(v, { ...open, callAmount: 1100, minRaiseTo: 3100 })).toEqual({
      type: "raise",
      amount: 6000,
    });
  });
  it("medium calls an unraised pot and folds to a raise", async () => {
    expect(await agent.decide(base({ holeCards: parseCards("8h 8d") }), open)).toEqual({
      type: "call",
    });
    const v = base({
      holeCards: parseCards("8h 8d"),
      history: [{ street: "preflop", seat: 1, action: { type: "raise", amount: 300 } }],
    });
    expect(await agent.decide(v, open)).toEqual({ type: "fold" });
  });
  it("medium folds to a shove, which the history records as allin", async () => {
    const v = base({
      holeCards: parseCards("8h 8d"),
      history: [{ street: "preflop", seat: 1, action: { type: "allin" } }],
      toCall: 9950,
      pot: 10050,
    });
    const l: LegalActions = { ...open, callAmount: 9950, minRaiseTo: null, maxRaiseTo: null };
    expect(await agent.decide(v, l)).toEqual({ type: "fold" });
    // A premium hand cannot raise any more, so it calls.
    expect(await agent.decide({ ...v, holeCards: parseCards("Ah Ad") }, l)).toEqual({
      type: "call",
    });
  });
  it("trash checks when free, folds otherwise", async () => {
    expect(await agent.decide(base({ holeCards: parseCards("7h 2d") }), open)).toEqual({
      type: "fold",
    });
    // The big blind's option: nothing to call against a live bet of one big blind.
    const option = base({
      holeCards: parseCards("7h 2d"),
      position: "BB",
      toCall: 0,
      committedThisStreet: 100,
      pot: 200,
      history: [{ street: "preflop", seat: 1, action: { type: "call" } }],
    });
    expect(option.currentBet).toBe(100);
    expect(
      await agent.decide(option, {
        canFold: false,
        canCheck: true,
        callAmount: null,
        minRaiseTo: 200,
        maxRaiseTo: 10000,
      }),
    ).toEqual({ type: "check" });
  });
  it("raises (not bets) a premium hand from the big blind's option", async () => {
    const option = base({
      position: "BB",
      toCall: 0,
      committedThisStreet: 100,
      pot: 200,
      history: [{ street: "preflop", seat: 1, action: { type: "call" } }],
    });
    expect(
      await agent.decide(option, {
        canFold: false,
        canCheck: true,
        callAmount: null,
        minRaiseTo: 200,
        maxRaiseTo: 10100,
      }),
    ).toEqual({ type: "raise", amount: 300 });
  });
});

describe("RulesAgent postflop", () => {
  const flop = (hole: string, board: string, toCall: number, pot = 300) =>
    base({ street: "flop", holeCards: parseCards(hole), board: parseCards(board), toCall, pot });
  const free: LegalActions = {
    canFold: false,
    canCheck: true,
    callAmount: null,
    minRaiseTo: 100,
    maxRaiseTo: 10000,
  };
  it("bets two pair+ for 2/3 pot", async () => {
    const v = flop("Ah Kd", "As Kc 2d", 0);
    expect(v.currentBet).toBe(0);
    expect(await agent.decide(v, free)).toEqual({ type: "bet", amount: 200 });
  });
  it("calls with a pair when cheap, folds when expensive", async () => {
    expect(
      await agent.decide(flop("Ah 5d", "As Kc 2d", 100), {
        ...open,
        callAmount: 100,
        minRaiseTo: 200,
      }),
    ).toEqual({ type: "call" });
    expect(
      await agent.decide(flop("Ah 5d", "As Kc 2d", 300), {
        ...open,
        callAmount: 300,
        minRaiseTo: 600,
      }),
    ).toEqual({ type: "fold" });
  });
  it("calls a draw only when very cheap", async () => {
    expect(
      await agent.decide(flop("9h 8h", "Th 7c 2h", 50), {
        ...open,
        callAmount: 50,
        minRaiseTo: 100,
      }),
    ).toEqual({ type: "call" });
    expect(
      await agent.decide(flop("9h 8h", "Th 7c 2h", 200), {
        ...open,
        callAmount: 200,
        minRaiseTo: 400,
      }),
    ).toEqual({ type: "fold" });
  });
  it("does not chase a draw that is only on the board", async () => {
    // Four hearts on the board and none in hand: `detectDraws` reports nothing, so it folds.
    const v = base({
      street: "turn",
      holeCards: parseCards("As Kd"),
      board: parseCards("Qh 9h 5h 2h"),
      toCall: 50,
      pot: 300,
    });
    expect(await agent.decide(v, { ...open, callAmount: 50, minRaiseTo: 100 })).toEqual({
      type: "fold",
    });
    // With a heart in hand the same price is a call.
    expect(
      await agent.decide(
        { ...v, holeCards: parseCards("Ah Kd"), board: parseCards("Qh 9h 5h 2c") },
        { ...open, callAmount: 50, minRaiseTo: 100 },
      ),
    ).toEqual({ type: "call" });
  });
  it("goes all-in when the clamp hits the max", async () => {
    expect(
      await agent.decide(flop("Ah Kd", "As Kc 2d", 0, 30000), { ...free, maxRaiseTo: 10000 }),
    ).toEqual({ type: "allin" });
  });
});

describe("RulesAgent re-raise sizing", () => {
  it("counts chips already committed on the street", async () => {
    // Bet 300, raised to 700: pot 1200, 400 to call. Two thirds of the pot after calling (1600) on top of 700.
    const v = base({
      street: "flop",
      holeCards: parseCards("Ah Kd"),
      board: parseCards("As Kc 2d"),
      pot: 1200,
      toCall: 400,
      currentBet: 700,
      committedThisStreet: 300,
    });
    const l: LegalActions = {
      canFold: true,
      canCheck: false,
      callAmount: 400,
      minRaiseTo: 1100,
      maxRaiseTo: 10000,
    };
    expect(await agent.decide(v, l)).toEqual({ type: "raise", amount: 1767 });
  });
  it("is unchanged for a first raise over a bet", async () => {
    const v = base({
      street: "flop",
      holeCards: parseCards("Ah Kd"),
      board: parseCards("As Kc 2d"),
      pot: 300,
      toCall: 100,
      currentBet: 100,
      committedThisStreet: 0,
    });
    const l: LegalActions = {
      canFold: true,
      canCheck: false,
      callAmount: 100,
      minRaiseTo: 200,
      maxRaiseTo: 10000,
    };
    expect(await agent.decide(v, l)).toEqual({ type: "raise", amount: 367 });
  });
});
