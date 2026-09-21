import { describe, expect, it } from "vitest";
import { potFractionTo, potShare, type SizingSpot, sizingPresets } from "./betSizing";

const FLOP_BET: SizingSpot = {
  pot: 60,
  currentBet: 0,
  callAmount: 0,
  preflop: false,
  min: 2,
  max: 500,
};

/** Pot was 60, a player bet 30: 90 in the middle, 30 to call. */
const FLOP_RAISE: SizingSpot = {
  pot: 90,
  currentBet: 30,
  callAmount: 30,
  preflop: false,
  min: 60,
  max: 500,
};

const amounts = (spot: SizingSpot) =>
  Object.fromEntries(sizingPresets(spot).map((p) => [p.id, p.available ? p.amount : null]));

describe("potFractionTo", () => {
  it("is a plain fraction of the pot when nobody has bet", () => {
    expect(potFractionTo(FLOP_BET, 1 / 2)).toBe(30);
    expect(potFractionTo(FLOP_BET, 1)).toBe(60);
  });

  it("calls first and then bets the pot when facing a bet", () => {
    // Call 30 makes the pot 120; a pot-sized raise puts in 120 more on top of the 30.
    expect(potFractionTo(FLOP_RAISE, 1)).toBe(150);
    expect(potFractionTo(FLOP_RAISE, 1 / 2)).toBe(90);
  });
});

describe("potShare", () => {
  it("reads a size back as a share of the pot it bets into", () => {
    expect(potShare(FLOP_BET, 30)).toBeCloseTo(0.5);
    expect(potShare(FLOP_RAISE, 150)).toBeCloseTo(1);
    expect(potShare({ ...FLOP_BET, pot: 0 }, 10)).toBeNull();
  });
});

describe("sizingPresets", () => {
  it("offers pot fractions after the flop, between min and all-in", () => {
    expect(amounts(FLOP_BET)).toEqual({
      min: 2,
      third: 20,
      half: 30,
      twoThirds: 40,
      pot: 60,
      allin: 500,
    });
  });

  it("offers multiples of the bet being faced before the flop", () => {
    const unopened: SizingSpot = {
      pot: 3,
      currentBet: 2,
      callAmount: 2,
      preflop: true,
      min: 4,
      max: 200,
    };
    expect(amounts(unopened)).toEqual({ min: 4, x2_5: 5, x3: 6, x4: 8, allin: 200 });
    // Facing an open to 6, the same buttons make it 15, 18 and 24.
    expect(amounts({ ...unopened, pot: 9, currentBet: 6, callAmount: 6, min: 10 })).toEqual({
      min: 10,
      x2_5: 15,
      x3: 18,
      x4: 24,
      allin: 200,
    });
  });

  it("keeps every button in place and disables the sizes that do not fit the window", () => {
    // A short stack: only a third of the pot is both above the minimum and below all-in.
    const short = { ...FLOP_BET, min: 10, max: 35 };
    const presets = sizingPresets(short);
    expect(presets.map((p) => p.id)).toEqual(["min", "third", "half", "twoThirds", "pot", "allin"]);
    expect(amounts(short)).toEqual({
      min: 10,
      third: 20,
      half: 30,
      twoThirds: null,
      pot: null,
      allin: 35,
    });
    // A size that lands exactly on an end of the window is that end's button, not its own.
    expect(amounts({ ...FLOP_BET, min: 20 }).third).toBeNull();
  });
});
