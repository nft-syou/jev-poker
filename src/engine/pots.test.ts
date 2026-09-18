import { describe, expect, it } from "vitest";
import { parseCards } from "./cards";
import { evaluateBest } from "./evaluator";
import { awardPots, buildPots } from "./pots";

const hand = (text: string) => evaluateBest(parseCards(text));

describe("buildPots", () => {
  it("makes a single pot when everyone contributed equally", () => {
    const pots = buildPots(
      new Map([
        [0, 30],
        [1, 30],
        [2, 30],
      ]),
      new Set([0, 1, 2]),
    );
    expect(pots).toEqual([{ amount: 90, eligible: [0, 1, 2] }]);
  });

  it("splits a side pot around a short all-in", () => {
    // seat 1 is all in for 50; seats 0 and 2 put in 100 each
    const pots = buildPots(
      new Map([
        [0, 100],
        [1, 50],
        [2, 100],
      ]),
      new Set([0, 1, 2]),
    );
    expect(pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 100, eligible: [0, 2] },
    ]);
  });

  it("gives folded players' chips to the pots they matched", () => {
    // seat 2 folded after putting in 20
    const pots = buildPots(
      new Map([
        [0, 100],
        [1, 100],
        [2, 20],
      ]),
      new Set([0, 1]),
    );
    expect(pots).toEqual([{ amount: 220, eligible: [0, 1] }]);
  });

  it("returns an uncalled bet to the only eligible player via the last pot", () => {
    // seat 0 bet 100, seat 1 folded after 20
    const pots = buildPots(
      new Map([
        [0, 100],
        [1, 20],
      ]),
      new Set([0]),
    );
    expect(pots).toEqual([{ amount: 120, eligible: [0] }]);
  });

  it("conserves chips with several all-in levels", () => {
    const contributions = new Map([
      [0, 10],
      [1, 40],
      [2, 90],
      [3, 90],
    ]);
    const pots = buildPots(contributions, new Set([0, 1, 2, 3]));
    expect(pots.map((p) => p.amount)).toEqual([40, 90, 100]);
    expect(pots.map((p) => p.eligible)).toEqual([
      [0, 1, 2, 3],
      [1, 2, 3],
      [2, 3],
    ]);
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(230);
  });
});

describe("awardPots", () => {
  const values = new Map([
    [0, hand("Ah Ad 2c 3d 9s Js Qs")], // pair of aces
    [1, hand("Kh Kd 2c 3d 9s Js Qs")], // pair of kings
    [2, hand("Ac Ks 2c 3d 9s Js Qs")], // high card
  ]);
  // biome-ignore lint/suspicious/noShadowRestrictedNames: variable name matches the function parameter
  const valueOf = (seat: number) => values.get(seat) as ReturnType<typeof hand>;

  it("gives the whole pot to the best hand", () => {
    const awards = awardPots([{ amount: 90, eligible: [0, 1, 2] }], valueOf, [1, 2, 0]);
    expect(awards).toEqual([{ seat: 0, amount: 90, potIndex: 0 }]);
  });

  it("awards side pots to the best eligible hand", () => {
    const awards = awardPots(
      [
        { amount: 150, eligible: [0, 1, 2] },
        { amount: 100, eligible: [1, 2] },
      ],
      valueOf,
      [1, 2, 0],
    );
    expect(awards).toEqual([
      { seat: 0, amount: 150, potIndex: 0 },
      { seat: 1, amount: 100, potIndex: 1 },
    ]);
  });

  it("splits ties and gives the odd chip to the first seat in order", () => {
    const tie = new Map([
      [0, hand("Ah Kd 2c 3d 9s Js Qs")],
      [1, hand("Ad Kc 2c 3d 9s Js Qs")],
    ]);
    const awards = awardPots(
      [{ amount: 101, eligible: [0, 1] }],
      (seat) => tie.get(seat) as ReturnType<typeof hand>,
      [1, 0],
    );
    expect(awards).toEqual([
      { seat: 1, amount: 51, potIndex: 0 },
      { seat: 0, amount: 50, potIndex: 0 },
    ]);
  });

  it("does not evaluate hands for an uncontested pot", () => {
    const awards = awardPots([{ amount: 120, eligible: [0] }], () => {
      throw new Error("should not evaluate");
    }, [0]);
    expect(awards).toEqual([{ seat: 0, amount: 120, potIndex: 0 }]);
  });
});
