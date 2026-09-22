import { describe, expect, it } from "vitest";
import { parseCards } from "./cards.js";
import { compareHands, evaluate5, evaluateBest } from "./evaluator.js";

const v = (text: string) => evaluateBest(parseCards(text));

describe("evaluate5", () => {
  it.each([
    ["As Ks Qs Js Ts", "straight_flush", [14]],
    ["5h 4h 3h 2h Ah", "straight_flush", [5]],
    ["9c 9d 9h 9s Kd", "four_of_a_kind", [9, 13]],
    ["9c 9d 9h Kd Ks", "full_house", [9, 13]],
    ["2h 7h 9h Jh Kh", "flush", [13, 11, 9, 7, 2]],
    ["5h 4c 3d 2s As", "straight", [5]],
    ["Th 9c 8d 7s 6s", "straight", [10]],
    ["Ah Ac Ad 5s 2c", "three_of_a_kind", [14, 5, 2]],
    ["Ah Ac 5d 5s Kc", "two_pair", [14, 5, 13]],
    ["Ah Ac 9d 5s 2c", "pair", [14, 9, 5, 2]],
    ["Ah Jc 9d 5s 2c", "high_card", [14, 11, 9, 5, 2]],
  ])("classifies %s as %s", (text, category, ranks) => {
    const value = evaluate5(parseCards(text));
    expect(value.category).toBe(category);
    expect(value.ranks).toEqual(ranks);
  });

  it("rejects the wrong number of cards", () => {
    expect(() => evaluate5(parseCards("As Ks"))).toThrow(/5 cards/);
  });
});

describe("ordering", () => {
  it("ranks categories in poker order", () => {
    const ordered = [
      "Ah Jc 9d 5s 2c",
      "Ah Ac 9d 5s 2c",
      "Ah Ac 5d 5s Kc",
      "Ah Ac Ad 5s 2c",
      "Th 9c 8d 7s 6s",
      "2h 7h 9h Jh Kh",
      "9c 9d 9h Kd Ks",
      "9c 9d 9h 9s Kd",
      "As Ks Qs Js Ts",
    ].map(v);
    for (let i = 1; i < ordered.length; i++) {
      expect(compareHands(ordered[i] as never, ordered[i - 1] as never)).toBeGreaterThan(0);
    }
  });

  it("breaks ties with kickers", () => {
    expect(compareHands(v("Ah Ac 9d 5s 2c"), v("Ah Ac 8d 5s 2c"))).toBeGreaterThan(0);
    expect(compareHands(v("Kh Kc 9d 9s Ac"), v("Kh Kc 9d 9s Qc"))).toBeGreaterThan(0);
    expect(compareHands(v("2h 7h 9h Jh Kh"), v("2c 7c 9c Tc Kc"))).toBeGreaterThan(0);
    expect(compareHands(v("Th 9c 8d 7s 6s"), v("5h 4c 3d 2s As"))).toBeGreaterThan(0);
  });

  it("treats equal hands as ties regardless of suits", () => {
    expect(compareHands(v("Ah Kc 9d 5s 2c"), v("Ad Ks 9c 5h 2d"))).toBe(0);
  });
});

describe("evaluateBest", () => {
  it("finds the best 5 of 7", () => {
    // Board gives a flush; hole cards give a straight. The flush wins.
    const value = v("Ah 2c 3h 4h 5h 9h Kd");
    expect(value.category).toBe("flush");
  });

  it("finds a full house hidden in 7 cards", () => {
    expect(v("Ah Ac Ad 5s 5c 9d 2c").category).toBe("full_house");
  });

  it("works with 6 cards", () => {
    expect(v("Ah Ac 5d 5s Kc 2d").category).toBe("two_pair");
  });

  it("rejects fewer than 5 or more than 7 cards", () => {
    expect(() => v("Ah Ac 5d 5s")).toThrow(/between 5 and 7/);
    expect(() => v("Ah Ac 5d 5s Kc 2d 3d 4d")).toThrow(/between 5 and 7/);
  });
});
