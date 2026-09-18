import { describe, expect, it } from 'vitest';
import { awardPots, buildPots } from './pots.js';

describe('buildPots', () => {
  it('single pot when equal contributions', () => {
    expect(buildPots(new Map([[0, 100], [1, 100]]), new Set())).toEqual([{ amount: 200, eligible: [0, 1] }]);
  });
  it('layers side pots by all-in level', () => {
    // seat 0 all-in 50, seats 1 and 2 put 200 each
    expect(buildPots(new Map([[0, 50], [1, 200], [2, 200]]), new Set())).toEqual([
      { amount: 150, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] },
    ]);
  });
  it('folded seats contribute but are not eligible', () => {
    // seat 2 folded after contributing 30; eligible layers for seats 0/1 merge into one pot
    expect(buildPots(new Map([[0, 100], [1, 100], [2, 30]]), new Set([2]))).toEqual([
      { amount: 230, eligible: [0, 1] },
    ]);
  });
  it('folds an empty-eligible layer into the previous pot instead of losing chips', () => {
    // seat 0 folded after contributing 100; seat 1 only put in 50, so the top 50 of
    // seat 0's contribution has no eligible seat and must merge into the seat-1 pot.
    expect(buildPots(new Map([[0, 100], [1, 50]]), new Set([0]))).toEqual([
      { amount: 150, eligible: [1] },
    ]);
  });
});
describe('awardPots', () => {
  it('splits ties and gives odd chip by order', () => {
    const pots = [{ amount: 201, eligible: [0, 1] }];
    expect(awardPots(pots, () => 5, [1, 0])).toEqual([
      { seat: 1, amount: 101, potIndex: 0 }, { seat: 0, amount: 100, potIndex: 0 },
    ]);
  });
  it('best eligible hand takes each pot', () => {
    const pots = [{ amount: 150, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }];
    const rank = (s: number) => ({ 0: 9, 1: 3, 2: 7 } as Record<number, number>)[s]!;
    expect(awardPots(pots, rank, [0, 1, 2])).toEqual([
      { seat: 0, amount: 150, potIndex: 0 }, { seat: 2, amount: 300, potIndex: 1 },
    ]);
  });
  it('throws when a pot has no eligible seats', () => {
    const pots = [{ amount: 50, eligible: [] }];
    expect(() => awardPots(pots, () => 1, [0, 1])).toThrow();
  });
});
