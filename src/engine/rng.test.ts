import { describe, expect, it } from "vitest";
import { createRng, hashSeed, randomInt, randomSeed, shuffle } from "./rng";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds and stays in [0, 1)", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
    for (const v of [...seqA, ...seqB]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("shuffles into a permutation without mutating the input", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(items, createRng(7));
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffle(items, createRng(7))).toEqual(shuffled);
  });

  it("produces an integer seed", () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });
});

describe("hashSeed", () => {
  it("is deterministic", () => {
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
    expect(hashSeed()).toBe(hashSeed());
  });

  it("depends on the order and the number of parts", () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(3, 2, 1));
    expect(hashSeed(1)).not.toBe(hashSeed(1, 0));
    expect(hashSeed(0)).not.toBe(hashSeed());
  });

  it("returns an unsigned 32-bit integer", () => {
    const inputs = [[], [0], [1], [-1], [2 ** 31], [2 ** 32 + 5], [7, 11, 13], [51, 50, 49, 1]];
    for (const parts of inputs) {
      const h = hashSeed(...parts);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("spreads nearby inputs over distinct seeds", () => {
    const seeds = new Set(Array.from({ length: 1000 }, (_, i) => hashSeed(i, 7)));
    expect(seeds.size).toBe(1000);
  });

  it("derives independent streams", () => {
    const a = createRng(hashSeed(5, 0));
    const b = createRng(hashSeed(5, 1));
    expect(Array.from({ length: 5 }, () => a.next())).not.toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });
});

describe("randomInt", () => {
  it("stays in [0, n) and reaches every value", () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(rng, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("is always 0 for n = 1", () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) expect(randomInt(rng, 1)).toBe(0);
  });

  it("is deterministic for the same seed", () => {
    const a = createRng(123);
    const b = createRng(123);
    expect(Array.from({ length: 20 }, () => randomInt(a, 52))).toEqual(
      Array.from({ length: 20 }, () => randomInt(b, 52)),
    );
  });

  it("consumes exactly one value of the stream", () => {
    const a = createRng(77);
    const b = createRng(77);
    expect(randomInt(a, 10)).toBe(Math.floor(b.next() * 10));
    expect(a.next()).toBe(b.next());
  });
});
