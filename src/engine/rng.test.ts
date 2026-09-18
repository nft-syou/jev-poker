import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from './rng.js';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('differs across seeds', () => expect(new Rng(1).next()).not.toBe(new Rng(2).next()));
  it('int(n) stays in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) { const v = r.int(6); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6); }
  });
  it('shuffle is a permutation and seed-stable', () => {
    const s1 = new Rng(3).shuffle([1, 2, 3, 4, 5]);
    const s2 = new Rng(3).shuffle([1, 2, 3, 4, 5]);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('hashSeed mixes parts', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(1, 2)).toBe(hashSeed(1, 2));
  });
});
