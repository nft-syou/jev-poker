import { describe, expect, it } from "vitest";
import { type Card, createDeck, formatCard, parseCards, sameCard } from "./cards.js";
import { Hand } from "./hand.js";
import type { HandSnapshot, Street } from "./types.js";
import {
  type ActionTakenEvent,
  betOrRaiseTo,
  historyEntry,
  type Position,
  playerView,
  positionOf,
} from "./view.js";

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

function actionsOf(hand: Hand): ActionTakenEvent[] {
  return hand.events.filter((e): e is ActionTakenEvent => e.type === "ActionTaken");
}

function taken(
  action: ActionTakenEvent["action"],
  allIn: boolean,
  street: Street = "flop",
): ActionTakenEvent {
  return { type: "ActionTaken", street, seat: 3, action, amount: 0, allIn };
}

describe("positionOf", () => {
  it("names the heads-up button BTN and the other seat BB", () => {
    const snap = snapshotWith([0, 1], 0);
    expect(positionOf(0, snap)).toBe("BTN");
    expect(positionOf(1, snap)).toBe("BB");
    const other = snapshotWith([2, 5], 5);
    expect(positionOf(5, other)).toBe("BTN");
    expect(positionOf(2, other)).toBe("BB");
  });

  it("names three-handed positions", () => {
    const snap = snapshotWith([0, 1, 2], 0);
    expect([0, 1, 2].map((s) => positionOf(s, snap))).toEqual(["BTN", "SB", "BB"]);
    const moved = snapshotWith([0, 1, 2], 2);
    expect([0, 1, 2].map((s) => positionOf(s, moved))).toEqual(["SB", "BB", "BTN"]);
  });

  it("names four- and five-handed positions (the seat before the button is CO)", () => {
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

  it("names six-handed positions with the button anywhere", () => {
    const names: Position[] = ["SB", "BB", "UTG", "MP", "CO", "BTN"];
    const seats = [0, 1, 2, 3, 4, 5];
    for (const button of seats) {
      const snap = snapshotWith(seats, button);
      const clockwiseFromSmallBlind = seats.map((_, i) => (button + 1 + i) % 6);
      expect(clockwiseFromSmallBlind.map((s) => positionOf(s, snap))).toEqual(names);
    }
  });

  it("works with gaps in the seat numbers", () => {
    const snap = snapshotWith([1, 3, 4, 7], 4);
    expect([7, 1, 3, 4].map((s) => positionOf(s, snap))).toEqual(["SB", "BB", "CO", "BTN"]);
  });

  it("throws for a seat or a button that is not in the hand", () => {
    expect(() => positionOf(9, snapshotWith([0, 1, 2], 0))).toThrow(/seat 9 is not in the hand/);
    expect(() => positionOf(0, snapshotWith([0, 1, 2], 8))).toThrow(/button is not seated/);
  });
});

describe("historyEntry", () => {
  it("records an all-in bet or raise as allin", () => {
    expect(historyEntry(taken({ type: "bet", amount: 700 }, true))).toEqual({
      street: "flop",
      seat: 3,
      action: { type: "allin" },
    });
    expect(historyEntry(taken({ type: "raise", amount: 1500 }, true, "preflop"))).toEqual({
      street: "preflop",
      seat: 3,
      action: { type: "allin" },
    });
  });

  it("keeps an all-in call a call", () => {
    expect(historyEntry(taken({ type: "call" }, true, "turn"))).toEqual({
      street: "turn",
      seat: 3,
      action: { type: "call" },
    });
  });

  it("leaves normal actions unchanged", () => {
    const actions: ActionTakenEvent["action"][] = [
      { type: "fold" },
      { type: "check" },
      { type: "call" },
      { type: "bet", amount: 200 },
      { type: "raise", amount: 600 },
    ];
    for (const action of actions) {
      expect(historyEntry(taken(action, false, "river"))).toEqual({
        street: "river",
        seat: 3,
        action,
      });
    }
  });
});

describe("playerView", () => {
  // Seat 0 (button) As Ks, seat 1 (small blind) Qd Qc, seat 2 (big blind, 150 chips) 7h 2d.
  const deck = riggedDeck("As Ks Qd Qc 7h 2d Kd 8c 3s 4h 9d");
  const newHand = () =>
    new Hand({
      handNumber: 4,
      button: 0,
      seats: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
        { seat: 2, stack: 150 },
      ],
      blinds: { small: 50, big: 100, ante: 0 },
      deck,
    });

  it("shows the first seat to act its cards, the blinds and nothing else", () => {
    const hand = newHand();
    const view = playerView(hand.snapshot(), 0, actionsOf(hand));
    expect(view.seat).toBe(0);
    expect(view.street).toBe("preflop");
    expect(view.holeCards.map(formatCard)).toEqual(["As", "Ks"]);
    expect(view.board).toEqual([]);
    expect(view.pot).toBe(150);
    expect(view.toCall).toBe(100);
    expect(view.currentBet).toBe(100);
    expect(view.committedThisStreet).toBe(0);
    expect(view.bigBlind).toBe(100);
    expect(view.position).toBe("BTN");
    expect(view.history).toEqual([]);
    expect(view.stacks).toEqual([
      { seat: 0, stack: 1000, isAllIn: false, folded: false },
      { seat: 1, stack: 950, isAllIn: false, folded: false },
      { seat: 2, stack: 50, isAllIn: false, folded: false },
    ]);
  });

  it("counts the blinds as chips committed on the street", () => {
    const hand = newHand();
    hand.act(0, { type: "raise", amount: 300 });
    const small = playerView(hand.snapshot(), 1, actionsOf(hand));
    expect(small.position).toBe("SB");
    expect(small.holeCards.map(formatCard)).toEqual(["Qd", "Qc"]);
    expect(small.committedThisStreet).toBe(50);
    expect(small.currentBet).toBe(300);
    expect(small.toCall).toBe(250);
    expect(small.pot).toBe(450);
    expect(small.history).toEqual([
      { street: "preflop", seat: 0, action: { type: "raise", amount: 300 } },
    ]);
    // Any seat can be viewed, not only the acting one.
    const big = playerView(hand.snapshot(), 2, actionsOf(hand));
    expect(big.position).toBe("BB");
    expect(big.committedThisStreet).toBe(100);
  });

  it("caps toCall at the stack", () => {
    const hand = newHand();
    hand.act(0, { type: "raise", amount: 300 });
    hand.act(1, { type: "call" });
    const big = playerView(hand.snapshot(), 2, actionsOf(hand));
    expect(big.currentBet).toBe(300);
    expect(big.committedThisStreet).toBe(100);
    expect(big.toCall).toBe(50);
    expect(big.toCall).toBe(hand.legalActions(2).callAmount);
  });

  it("maps the history and follows stacks, flags and the board through the hand", () => {
    const hand = newHand();
    hand.act(0, { type: "raise", amount: 300 });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "allin" }); // 50 more into a bet of 300: the engine reports a call
    const flop = playerView(hand.snapshot(), 1, actionsOf(hand));
    expect(flop.street).toBe("flop");
    expect(flop.board.map(formatCard)).toEqual(["Kd", "8c", "3s"]);
    expect(flop.pot).toBe(750);
    expect(flop.currentBet).toBe(0);
    expect(flop.toCall).toBe(0);
    expect(flop.committedThisStreet).toBe(0);
    expect(flop.stacks).toEqual([
      { seat: 0, stack: 700, isAllIn: false, folded: false },
      { seat: 1, stack: 700, isAllIn: false, folded: false },
      { seat: 2, stack: 0, isAllIn: true, folded: false },
    ]);

    hand.act(1, { type: "check" });
    hand.act(0, { type: "allin" }); // a bet of 700 that puts the seat all in
    const facing = playerView(hand.snapshot(), 1, actionsOf(hand));
    expect(facing.toCall).toBe(700);
    expect(facing.currentBet).toBe(700);
    expect(facing.pot).toBe(1450);
    expect(facing.history).toEqual([
      { street: "preflop", seat: 0, action: { type: "raise", amount: 300 } },
      { street: "preflop", seat: 1, action: { type: "call" } },
      { street: "preflop", seat: 2, action: { type: "call" } },
      { street: "flop", seat: 1, action: { type: "check" } },
      { street: "flop", seat: 0, action: { type: "allin" } },
    ]);
    expect(facing.stacks[0]).toEqual({ seat: 0, stack: 0, isAllIn: true, folded: false });

    hand.act(1, { type: "fold" });
    expect(hand.isComplete).toBe(true);
    const done = playerView(hand.snapshot(), 1, actionsOf(hand));
    expect(done.street).toBe("showdown");
    expect(done.board.map(formatCard)).toEqual(["Kd", "8c", "3s", "4h", "9d"]);
    expect(done.stacks).toEqual([
      { seat: 0, stack: 1450, isAllIn: true, folded: false },
      { seat: 1, stack: 700, isAllIn: false, folded: true },
      { seat: 2, stack: 0, isAllIn: true, folded: false },
    ]);
    expect(done.history.at(-1)).toEqual({ street: "flop", seat: 1, action: { type: "fold" } });
  });

  it("gives the heads-up big blind its option: nothing to call against a live bet", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 1,
      seats: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
      blinds: { small: 50, big: 100, ante: 0 },
      deck: riggedDeck("As Ks Qd Qc"),
    });
    const button = playerView(hand.snapshot(), 1, actionsOf(hand));
    expect(button.position).toBe("BTN");
    expect(button.committedThisStreet).toBe(50);
    expect(button.toCall).toBe(50);
    hand.act(1, { type: "call" });

    const big = playerView(hand.snapshot(), 0, actionsOf(hand));
    expect(big.position).toBe("BB");
    expect(big.toCall).toBe(0);
    expect(big.currentBet).toBe(100);
    expect(big.committedThisStreet).toBe(100);
    expect(hand.legalActions(0).canCheck).toBe(true);
    // The big blind counts as a bet, so putting in more is a raise; the engine agrees.
    const action = betOrRaiseTo(big, 300);
    expect(action).toEqual({ type: "raise", amount: 300 });
    expect(() => hand.act(0, action)).not.toThrow();
  });

  it("does not count antes as chips committed on the street", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 0,
      seats: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
        { seat: 2, stack: 1000 },
      ],
      blinds: { small: 50, big: 100, ante: 10 },
      deck: riggedDeck("As Ks Qd Qc 7h 2d"),
    });
    const big = playerView(hand.snapshot(), 2, actionsOf(hand));
    expect(big.committedThisStreet).toBe(100);
    expect(big.pot).toBe(180);
    expect(big.stacks.map((s) => s.stack)).toEqual([990, 940, 890]);
  });

  it("throws for a seat that is not in the hand", () => {
    const hand = newHand();
    expect(() => playerView(hand.snapshot(), 9, actionsOf(hand))).toThrow(
      /seat 9 is not in the hand/,
    );
  });
});

describe("betOrRaiseTo", () => {
  it("is a bet when nobody has bet, a raise otherwise", () => {
    expect(betOrRaiseTo({ currentBet: 0 }, 250)).toEqual({ type: "bet", amount: 250 });
    expect(betOrRaiseTo({ currentBet: 100 }, 250)).toEqual({ type: "raise", amount: 250 });
  });

  it("names a postflop wager the way the engine accepts it", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 1,
      seats: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
      blinds: { small: 50, big: 100, ante: 0 },
      deck: riggedDeck("As Ks Qd Qc"),
    });
    hand.act(1, { type: "call" });
    hand.act(0, { type: "check" });
    const first = playerView(hand.snapshot(), 0, actionsOf(hand));
    expect(first.street).toBe("flop");
    const bet = betOrRaiseTo(first, 200);
    expect(bet.type).toBe("bet");
    expect(() => hand.act(0, { type: "raise", amount: 200 })).toThrow(/use bet/);
    hand.act(0, bet);
    const second = playerView(hand.snapshot(), 1, actionsOf(hand));
    const raise = betOrRaiseTo(second, 600);
    expect(raise.type).toBe("raise");
    expect(() => hand.act(1, { type: "bet", amount: 600 })).toThrow(/use raise/);
    expect(() => hand.act(1, raise)).not.toThrow();
  });
});
