import { describe, expect, it } from "vitest";
import { type ChipTier, chipBreakdown, MAX_STACK_CHIPS } from "./chips";

const tiers = (amount: number, bigBlind: number): ChipTier[] =>
  chipBreakdown(amount, bigBlind).map((chip) => chip.tier);

describe("chipBreakdown", () => {
  it("draws nothing for a seat that has not bet", () => {
    expect(chipBreakdown(0, 2)).toEqual([]);
    expect(chipBreakdown(-10, 2)).toEqual([]);
    expect(chipBreakdown(Number.NaN, 2)).toEqual([]);
  });

  it("puts each denomination boundary on its own tier", () => {
    expect(tiers(1, 2)).toEqual(["white"]); // 0.5 BB
    expect(tiers(2, 2)).toEqual(["red"]); // 1 BB
    expect(tiers(10, 2)).toEqual(["green"]); // 5 BB
    expect(tiers(50, 2)).toEqual(["black"]); // 25 BB
    expect(tiers(200, 2)).toEqual(["purple"]); // 100 BB
  });

  it("stays just below a boundary until the boundary is reached", () => {
    expect(tiers(9, 2)).toEqual(["red", "red", "red", "red", "white"]); // 4.5 BB
    expect(tiers(49, 2)).toEqual(["green", "green", "green", "green", "red", "red"]);
  });

  it("takes the largest denominations first", () => {
    // 263 = 200 + 50 + 10 + 2 + 1, one chip of every tier.
    expect(tiers(263, 2)).toEqual(["purple", "black", "green", "red", "white"]);
  });

  it("scales the tiers with the big blind", () => {
    expect(tiers(100, 200)).toEqual(["white"]); // 0.5 BB at a 200-chip blind
    expect(tiers(20000, 200)).toEqual(["purple"]);
    // With no blind to scale by, one chip is one unit.
    expect(tiers(5, 0)).toEqual(["green"]);
  });

  it("always draws at least one chip for a positive amount", () => {
    expect(tiers(0.25, 2)).toEqual(["white"]);
    expect(chipBreakdown(0.25, 2)).toHaveLength(1);
  });

  it("caps the drawn stack and keeps the biggest chips", () => {
    const big = chipBreakdown(20000, 2);
    expect(big).toHaveLength(MAX_STACK_CHIPS);
    expect(big.every((chip) => chip.tier === "purple")).toBe(true);

    // 199 chips at a blind of 2 is 3 blacks, then greens — eight chips if nothing capped it.
    const mixed = chipBreakdown(199, 2);
    expect(mixed).toHaveLength(MAX_STACK_CHIPS);
    expect(mixed.map((chip) => chip.tier)).toEqual([
      "black",
      "black",
      "black",
      "green",
      "green",
      "green",
    ]);
  });

  it("never draws more than the amount it was given", () => {
    for (const amount of [1, 3, 7, 13, 64, 199, 1234]) {
      const total = chipBreakdown(amount, 2).reduce((sum, chip) => sum + chip.value, 0);
      expect(total, `${amount}`).toBeLessThanOrEqual(amount);
    }
  });
});
