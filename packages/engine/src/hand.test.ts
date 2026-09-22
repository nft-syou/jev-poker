import { describe, expect, it } from "vitest";
import { type Card, createDeck, parseCards, sameCard } from "./cards.js";
import { Hand, type HandOptions } from "./hand.js";
import { createRng } from "./rng.js";
import type { Action, GameEvent, LegalActions } from "./types.js";

/** Puts the listed cards at the front of a full deck (dealt first), rest in default order. */
function riggedDeck(front: string): Card[] {
  const cards = parseCards(front);
  const rest = createDeck().filter((card) => !cards.some((c) => sameCard(c, card)));
  return [...cards, ...rest];
}

function threeHanded(overrides: Partial<HandOptions> = {}): Hand {
  return new Hand({
    handNumber: 0,
    button: 0,
    seats: [
      { seat: 0, stack: 100 },
      { seat: 1, stack: 100 },
      { seat: 2, stack: 100 },
    ],
    blinds: { small: 5, big: 10, ante: 0 },
    deck: createDeck(),
    ...overrides,
  });
}

const types = (events: readonly GameEvent[]) => events.map((e) => e.type);

describe("Hand setup", () => {
  it("posts blinds left of the button and starts left of the big blind", () => {
    const hand = threeHanded();
    const posted = hand.events.find((e) => e.type === "BlindsPosted");
    expect(posted).toEqual({
      type: "BlindsPosted",
      posts: [
        { seat: 1, kind: "small", amount: 5 },
        { seat: 2, kind: "big", amount: 10 },
      ],
    });
    expect(types(hand.events)).toEqual(["BlindsPosted", "HoleCardsDealt"]);
    const snap = hand.snapshot();
    expect(snap.actingSeat).toBe(0);
    expect(snap.toAct).toEqual([0, 1, 2]);
    expect(snap.pot).toBe(15);
    expect(snap.street).toBe("preflop");
    expect(hand.legalActions(0)).toEqual<LegalActions>({
      canFold: true,
      canCheck: false,
      callAmount: 10,
      minRaiseTo: 20,
      maxRaiseTo: 100,
    });
    expect(hand.legalActions(1).canFold).toBe(false);
  });

  it("deals two cards per player from the front of the deck", () => {
    const hand = threeHanded({ deck: riggedDeck("As Ad Ks Kd Qs Qd") });
    const dealt = hand.events.find((e) => e.type === "HoleCardsDealt");
    expect(dealt).toEqual({
      type: "HoleCardsDealt",
      hands: [
        { seat: 0, cards: parseCards("As Ad") },
        { seat: 1, cards: parseCards("Ks Kd") },
        { seat: 2, cards: parseCards("Qs Qd") },
      ],
    });
  });

  it("heads-up: the button posts the small blind and acts first preflop", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 0,
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100 },
      ],
      blinds: { small: 5, big: 10, ante: 0 },
      deck: createDeck(),
    });
    const posted = hand.events.find((e) => e.type === "BlindsPosted");
    expect(posted).toMatchObject({
      posts: [
        { seat: 0, kind: "small", amount: 5 },
        { seat: 1, kind: "big", amount: 10 },
      ],
    });
    expect(hand.actingSeat).toBe(0);
    hand.act(0, { type: "call" });
    expect(hand.actingSeat).toBe(1);
    const events = hand.act(1, { type: "check" });
    expect(types(events)).toEqual(["ActionTaken", "StreetDealt"]);
    expect(hand.street).toBe("flop");
    expect(hand.snapshot().board).toHaveLength(3);
    // Postflop the non-button acts first.
    expect(hand.actingSeat).toBe(1);
  });

  it("rejects invalid setups", () => {
    expect(() => threeHanded({ seats: [{ seat: 0, stack: 100 }] })).toThrow(/at least 2/);
    expect(() => threeHanded({ button: 9 })).toThrow(/button/);
    expect(() =>
      threeHanded({
        seats: [
          { seat: 0, stack: 100 },
          { seat: 1, stack: 0 },
        ],
      }),
    ).toThrow(/no chips/);
    expect(() =>
      threeHanded({
        seats: [
          { seat: 0, stack: 100 },
          { seat: 0, stack: 100 },
        ],
      }),
    ).toThrow(/unique/);
  });

  it("posts partial blinds and antes, marking players all in", () => {
    const hand = threeHanded({
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 3 },
        { seat: 2, stack: 1 },
      ],
      blinds: { small: 5, big: 10, ante: 1 },
    });
    const posted = hand.events.find((e) => e.type === "BlindsPosted");
    expect(posted).toEqual({
      type: "BlindsPosted",
      posts: [
        { seat: 0, kind: "ante", amount: 1 },
        { seat: 1, kind: "ante", amount: 1 },
        { seat: 2, kind: "ante", amount: 1 },
        { seat: 1, kind: "small", amount: 2 },
        { seat: 2, kind: "big", amount: 0 },
      ],
    });
    // Seats 1 and 2 are all in from the blinds/ante alone, leaving fewer than 2 live
    // players, so the hand runs itself out immediately without seat 0 acting.
    expect(hand.isComplete).toBe(true);
    const snap = hand.snapshot();
    const p1 = snap.players.find((p) => p.seat === 1);
    const p2 = snap.players.find((p) => p.seat === 2);
    expect(p1).toMatchObject({ contributed: 3, allIn: true });
    expect(p2).toMatchObject({ contributed: 1, allIn: true });
    expect(snap.pot).toBe(5);
  });
});

describe("Hand betting", () => {
  it("gives the big blind the option after limps", () => {
    const hand = threeHanded();
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    expect(hand.actingSeat).toBe(2);
    expect(hand.legalActions(2)).toEqual<LegalActions>({
      canFold: false,
      canCheck: true,
      callAmount: null,
      minRaiseTo: 20,
      maxRaiseTo: 100,
    });
    const events = hand.act(2, { type: "check" });
    expect(types(events)).toEqual(["ActionTaken", "StreetDealt"]);
    expect(hand.street).toBe("flop");
    expect(hand.actingSeat).toBe(1);
    expect(hand.snapshot().toAct).toEqual([1, 2, 0]);
    expect(hand.legalActions(1)).toEqual<LegalActions>({
      canFold: false,
      canCheck: true,
      callAmount: null,
      minRaiseTo: 10,
      maxRaiseTo: 90,
    });
  });

  it("enforces minimum raise sizes and reopens action", () => {
    const hand = threeHanded();
    hand.act(0, { type: "raise", amount: 30 });
    expect(hand.legalActions(1).minRaiseTo).toBe(50);
    expect(() => hand.act(1, { type: "raise", amount: 40 })).toThrow(/illegal/);
    hand.act(1, { type: "raise", amount: 50 });
    expect(hand.legalActions(2).minRaiseTo).toBe(70);
    hand.act(2, { type: "call" });
    // Seat 0 must act again because seat 1 re-raised.
    expect(hand.actingSeat).toBe(0);
    expect(hand.legalActions(0).callAmount).toBe(20);
  });

  it("rejects out-of-turn and mismatched actions", () => {
    const hand = threeHanded();
    expect(() => hand.act(1, { type: "call" })).toThrow(/not acting/);
    expect(() => hand.act(0, { type: "check" })).toThrow(/facing a bet/);
    expect(() => hand.act(0, { type: "bet", amount: 30 })).toThrow(/use raise/);
    hand.act(0, { type: "call" });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "check" });
    expect(() => hand.act(1, { type: "raise", amount: 20 })).toThrow(/use bet/);
    expect(() => hand.act(1, { type: "fold" })).toThrow(/cannot fold/);
  });

  it("awards an uncontested pot without a showdown", () => {
    const hand = threeHanded();
    hand.act(0, { type: "raise", amount: 30 });
    hand.act(1, { type: "fold" });
    const events = hand.act(2, { type: "fold" });
    expect(types(events)).toEqual(["ActionTaken", "PotAwarded"]);
    expect(hand.isComplete).toBe(true);
    expect(hand.actingSeat).toBeNull();
    expect(events[1]).toEqual({
      type: "PotAwarded",
      pots: [{ amount: 45, eligible: [0] }],
      awards: [{ seat: 0, amount: 45, potIndex: 0 }],
    });
    expect(hand.stacks()).toEqual([
      { id: 0, stack: 115 },
      { id: 1, stack: 95 },
      { id: 2, stack: 90 },
    ]);
    expect(() => hand.act(0, { type: "check" })).toThrow(/complete/);
  });

  it("runs out the board when everyone is all in", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 0,
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100 },
      ],
      blinds: { small: 5, big: 10, ante: 0 },
      deck: riggedDeck("As Ad Ks Kd 2c 5d 9h Jc 7s"),
    });
    const shove = hand.act(0, { type: "allin" });
    expect(shove[0]).toMatchObject({
      type: "ActionTaken",
      action: { type: "raise", amount: 100 },
      amount: 95,
      allIn: true,
    });
    const events = hand.act(1, { type: "call" });
    expect(types(events)).toEqual([
      "ActionTaken",
      "StreetDealt",
      "StreetDealt",
      "StreetDealt",
      "Showdown",
      "PotAwarded",
    ]);
    expect(hand.snapshot().board).toEqual(parseCards("2c 5d 9h Jc 7s"));
    expect(hand.stacks()).toEqual([
      { id: 0, stack: 200 },
      { id: 1, stack: 0 },
    ]);
  });

  it("builds side pots and treats a short all-in as a call", () => {
    const hand = new Hand({
      handNumber: 0,
      button: 0,
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 50 },
        { seat: 2, stack: 100 },
      ],
      blinds: { small: 5, big: 10, ante: 0 },
      deck: riggedDeck("2c 7d Ah Ad Kh Kd 3s 4s 9c Jd Qs"),
    });
    hand.act(0, { type: "allin" });
    const short = hand.act(1, { type: "allin" });
    expect(short[0]).toMatchObject({ action: { type: "call" }, amount: 45, allIn: true });
    const events = hand.act(2, { type: "call" });
    const awarded = events.find((e) => e.type === "PotAwarded");
    expect(awarded).toEqual({
      type: "PotAwarded",
      pots: [
        { amount: 150, eligible: [0, 1, 2] },
        { amount: 100, eligible: [0, 2] },
      ],
      awards: [
        { seat: 1, amount: 150, potIndex: 0 },
        { seat: 2, amount: 100, potIndex: 1 },
      ],
    });
    expect(hand.stacks()).toEqual([
      { id: 0, stack: 0 },
      { id: 1, stack: 150 },
      { id: 2, stack: 100 },
    ]);
  });

  it("lets a short stack shove for less than a min-raise", () => {
    const hand = threeHanded({
      seats: [
        { seat: 0, stack: 15 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 100 },
      ],
    });
    expect(hand.legalActions(0)).toEqual<LegalActions>({
      canFold: true,
      canCheck: false,
      callAmount: 10,
      minRaiseTo: 15,
      maxRaiseTo: 15,
    });
    hand.act(0, { type: "raise", amount: 15 });
    // A shove for less does not reopen the min-raise size: the next min raise is still 20.
    expect(hand.legalActions(1).minRaiseTo).toBe(25);
  });

  it("does not reopen raising after a short all-in that is not a full raise", () => {
    const hand = threeHanded({
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 40 },
      ],
    });
    hand.act(0, { type: "raise", amount: 30 }); // minRaise becomes 20
    hand.act(1, { type: "call" });
    hand.act(2, { type: "allin" }); // to 40: increment 10 < 20, not a full raise
    expect(hand.actingSeat).toBe(0);
    expect(hand.legalActions(0)).toEqual<LegalActions>({
      canFold: true,
      canCheck: false,
      callAmount: 10,
      minRaiseTo: null,
      maxRaiseTo: null,
    });
    expect(() => hand.act(0, { type: "raise", amount: 60 })).toThrow(/not allowed/);
    hand.act(0, { type: "call" });
    expect(hand.legalActions(1).minRaiseTo).toBeNull();
    hand.act(1, { type: "call" });
    // Everyone matched; the flop is dealt and raising is open again.
    expect(hand.street).toBe("flop");
    expect(hand.legalActions(1).minRaiseTo).toBe(10);
  });
});

describe("Hand invariants", () => {
  function randomLegalAction(
    legal: LegalActions,
    currentBet: number,
    rng: ReturnType<typeof createRng>,
  ): Action {
    const options: Action[] = [];
    if (legal.canFold) options.push({ type: "fold" });
    if (legal.canCheck) options.push({ type: "check" });
    if (legal.callAmount !== null) options.push({ type: "call" });
    if (legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
      const span = legal.maxRaiseTo - legal.minRaiseTo;
      const amount = legal.minRaiseTo + Math.floor(rng.next() * (span + 1));
      // The big blind may check while a bet (the blind) is live, so decide bet/raise by currentBet.
      options.push({ type: currentBet === 0 ? "bet" : "raise", amount });
      options.push({ type: "allin" });
    }
    return options[Math.floor(rng.next() * options.length)] as Action;
  }

  it("conserves chips and always terminates under random legal play", () => {
    const rng = createRng(2024);
    for (let i = 0; i < 300; i++) {
      const count = 2 + Math.floor(rng.next() * 5);
      const seats = Array.from({ length: count }, (_, seat) => ({
        seat,
        stack: 10 + Math.floor(rng.next() * 300),
      }));
      const total = seats.reduce((sum, s) => sum + s.stack, 0);
      const deck = createDeck();
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng.next() * (j + 1));
        const tmp = deck[j] as Card;
        deck[j] = deck[k] as Card;
        deck[k] = tmp;
      }
      const hand = new Hand({
        handNumber: i,
        button: Math.floor(rng.next() * count),
        seats,
        blinds: { small: 1, big: 2, ante: rng.next() < 0.3 ? 1 : 0 },
        deck,
      });
      let guard = 0;
      while (!hand.isComplete) {
        const seat = hand.actingSeat;
        if (seat === null) throw new Error("no acting seat on an incomplete hand");
        hand.act(seat, randomLegalAction(hand.legalActions(seat), hand.snapshot().currentBet, rng));
        if (++guard > 500) throw new Error("hand did not terminate");
      }
      expect(hand.stacks().reduce((sum, s) => sum + s.stack, 0)).toBe(total);
      expect(hand.events.filter((e) => e.type === "PotAwarded")).toHaveLength(1);
    }
  });
});

describe("Hand clone", () => {
  it("isolates the copy: acting on it leaves the original untouched", () => {
    const hand = threeHanded();
    const before = hand.snapshot();
    const beforeEvents = [...hand.events];
    const clone = hand.clone();

    clone.act(0, { type: "raise", amount: 30 });
    clone.act(1, { type: "fold" });
    clone.act(2, { type: "call" });

    expect(clone.street).toBe("flop");
    expect(hand.snapshot()).toEqual(before);
    expect(hand.events).toEqual(beforeEvents);
    expect(hand.actingSeat).toBe(0);
    expect(hand.street).toBe("preflop");
    expect(hand.snapshot().board).toEqual([]);
    expect(hand.legalActions(0)).toEqual<LegalActions>({
      canFold: true,
      canCheck: false,
      callAmount: 10,
      minRaiseTo: 20,
      maxRaiseTo: 100,
    });
  });

  it("replays identically: clone and original agree on the same actions", () => {
    const hand = threeHanded({ deck: riggedDeck("As Ad Ks Kd Qs Qd") });
    const clone = hand.clone();
    expect(clone.snapshot()).toEqual(hand.snapshot());

    const line: [number, Action][] = [
      [0, { type: "call" }],
      [1, { type: "call" }],
      [2, { type: "check" }],
      [1, { type: "bet", amount: 20 }],
      [2, { type: "call" }],
      [0, { type: "fold" }],
    ];
    for (const [seat, action] of line) {
      expect(clone.legalActions(seat)).toEqual(hand.legalActions(seat));
      const mine = clone.act(seat, action);
      expect(mine).toEqual(hand.act(seat, action));
      expect(clone.snapshot()).toEqual(hand.snapshot());
    }
    expect(clone.events).toEqual(hand.events);
    expect(clone.stacks()).toEqual(hand.stacks());
  });

  it("copies the short-all-in raise lock so the copy keeps its own", () => {
    const hand = threeHanded({
      seats: [
        { seat: 0, stack: 100 },
        { seat: 1, stack: 100 },
        { seat: 2, stack: 26 },
      ],
    });
    hand.act(0, { type: "raise", amount: 20 });
    hand.act(1, { type: "call" });
    hand.act(2, { type: "allin" }); // 26 total: a raise that is too small to reopen
    expect(hand.legalActions(0).minRaiseTo).toBeNull();

    const clone = hand.clone();
    expect(clone.legalActions(0)).toEqual(hand.legalActions(0));
    clone.act(0, { type: "call" });
    clone.act(1, { type: "call" });
    expect(clone.street).toBe("flop");
    expect(hand.legalActions(0).minRaiseTo).toBeNull();
    expect(hand.street).toBe("preflop");
    expect(hand.actingSeat).toBe(0);
  });
});
