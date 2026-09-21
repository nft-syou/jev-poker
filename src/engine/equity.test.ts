import { describe, expect, it } from "vitest";
import { parseCards } from "./cards";
import { boardTexture, estimateEquity, handStrengthPct } from "./equity";

describe("estimateEquity", () => {
  it("AA heads-up preflop is about 85%", () => {
    const e = estimateEquity(parseCards("Ah Ad"), [], 1, 600);
    expect(e).toBeGreaterThan(80);
    expect(e).toBeLessThan(90);
  });
  it("72o heads-up preflop is about 35%", () => {
    const e = estimateEquity(parseCards("7h 2d"), [], 1, 600);
    expect(e).toBeGreaterThan(28);
    expect(e).toBeLessThan(42);
  });
  it("drops with more opponents", () => {
    expect(estimateEquity(parseCards("Ah Kd"), [], 5, 400)).toBeLessThan(
      estimateEquity(parseCards("Ah Kd"), [], 1, 400),
    );
  });
  it("is 100% with the nuts on the river", () => {
    expect(estimateEquity(parseCards("Ah Kh"), parseCards("Qh Jh Th 2c 3d"), 3, 100)).toBe(100);
  });
  it("is deterministic for the same cards", () => {
    expect(estimateEquity(parseCards("9c 8c"), parseCards("7d 6s 2h"), 2)).toBe(
      estimateEquity(parseCards("9c 8c"), parseCards("7d 6s 2h"), 2),
    );
  });
  it("rejects bad input", () => {
    expect(() => estimateEquity(parseCards("Ah"), [], 1)).toThrow();
    expect(() => estimateEquity(parseCards("Ah Kh"), parseCards("Qh Jh Th 2c 3d 4s"), 1)).toThrow();
  });
});

describe("handStrengthPct", () => {
  it("is null before the flop and 100 with the nuts", () => {
    expect(handStrengthPct(parseCards("Ah Kh"), [])).toBeNull();
    expect(handStrengthPct(parseCards("Ah Kh"), parseCards("Qh Jh Th"))).toBe(100);
  });
  it("rates weak two pair below a set", () => {
    // 7s and 2s with KK on board = kings up
    const weakTwoPair = handStrengthPct(parseCards("7h 2d"), parseCards("7c 2c Kd Ks 9h")) ?? -1;
    const set = handStrengthPct(parseCards("Kh Kd"), parseCards("Kc 7c 2d")) ?? -1;
    expect(weakTwoPair).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(weakTwoPair);
    expect(set).toBeGreaterThan(95);
  });
  it("rates high card low on a coordinated board", () => {
    expect(handStrengthPct(parseCards("7h 2d"), parseCards("Ac Kc Qd")) ?? 100).toBeLessThan(20);
  });
});

describe("boardTexture", () => {
  it("detects paired, flush and straight boards", () => {
    expect(boardTexture(parseCards("Kc Kd 2h"))).toEqual({
      paired: true,
      flushPossible: false,
      straightPossible: false,
    });
    expect(boardTexture(parseCards("Kc 9c 2c"))).toEqual({
      paired: false,
      flushPossible: true,
      straightPossible: false,
    });
    expect(boardTexture(parseCards("9c 8d 5h"))).toEqual({
      paired: false,
      flushPossible: false,
      straightPossible: true,
    });
    expect(boardTexture(parseCards("Ac 3d 5h"))).toEqual({
      paired: false,
      flushPossible: false,
      straightPossible: true,
    });
    expect(boardTexture(parseCards("Ac 8d 2h"))).toEqual({
      paired: false,
      flushPossible: false,
      straightPossible: false,
    });
    expect(boardTexture([])).toBeNull();
  });
});
