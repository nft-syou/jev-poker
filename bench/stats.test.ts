import { describe, expect, it } from 'vitest';
import { meanCi, percentile, summarize } from './stats.js';
import type { HandRecord } from './types.js';

const rec = (seedIndex: number, rotation: number, jevNet: number, extra: Partial<HandRecord> = {}): HandRecord => ({
  seedIndex,
  rotation,
  jevSeat: rotation,
  net: rotation === 0 ? [jevNet, -jevNet] : [-jevNet, jevNet],
  wentToShowdown: false,
  jevWonShowdown: null,
  jevVpip: true,
  jevPfr: false,
  oppVpip: 1,
  oppPfr: 0,
  decisions: [
    {
      street: 'preflop',
      choice: 'check_or_call',
      action: { type: 'call' },
      probabilities: { fold: 0, check_or_call: 1, bet_or_raise: 0 },
      sizingScore: null,
      bluffIntent: null,
      latencyMs: 100,
      apiCall: true,
    },
  ],
  ...extra,
});

describe('stats', () => {
  it('percentile', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85);
  });

  it('meanCi', () => {
    const r = meanCi([1, 1, 1, 1]);
    expect(r).toEqual({ mean: 1, ci: [1, 1] });
    // One sample has no spread to estimate: no interval rather than a zero-width one.
    expect(meanCi([3])).toEqual({ mean: 3, ci: null });
    expect(meanCi([])).toEqual({ mean: 0, ci: null });
    // mean 2, sample sd sqrt(4.5) = 2.1213, half = 1.96 * 2.1213 / sqrt(2) = 2.94
    const two = meanCi([0.5, 3.5]);
    expect(two.mean).toBeCloseTo(2, 1);
    expect(two.ci?.[0]).toBeCloseTo(-0.94, 1);
    expect(two.ci?.[1]).toBeCloseTo(4.94, 1);
  });

  it('summarize groups mirrored hands per seed', () => {
    const hands = [rec(0, 0, 2), rec(0, 1, -1), rec(1, 0, 4), rec(1, 1, 3)]; // x = [0.5, 3.5]
    const s = summarize(hands, 'hu');
    expect(s.jev.n).toBe(2);
    expect(s.jev.hands).toBe(4);
    expect(s.jev.bb100).toBeCloseTo(200);
    // Same CI as meanCi([0.5, 3.5]), scaled to 100 hands.
    expect(s.jev.ci95?.[0]).toBeCloseTo(-94.0, 1);
    expect(s.jev.ci95?.[1]).toBeCloseTo(494.0, 1);
    expect(s.jev.incompleteGroups).toBe(0);
    expect(s.jev.decisions).toBe(4);
    expect(s.jev.apiCalls).toBe(4);
    expect(s.jev.failOpen).toBe(0);
    expect(s.jev.latencyMs.mean).toBe(100);
    expect(s.jev.vpip).toBe(1);
    expect(s.jev.pfr).toBe(0);
    expect(s.jev.showdownWinRate).toBeNull();
    expect(s.opponent.bb100PerSeat).toBeCloseTo(-200);
  });

  it('counts fail-open and showdown wins', () => {
    const h = rec(0, 0, 1, {
      wentToShowdown: true,
      jevWonShowdown: true,
      decisions: [
        {
          street: 'flop',
          choice: 'check_or_call',
          action: { type: 'check' },
          probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0 },
          sizingScore: null,
          bluffIntent: null,
          latencyMs: 5,
          apiCall: false,
          error: 'x',
        },
      ],
    });
    const s = summarize([h], 'hu');
    expect(s.jev.failOpen).toBe(1);
    expect(s.jev.apiCalls).toBe(0);
    expect(s.jev.showdownWinRate).toBe(1);
  });
});

describe("summarize: balanced groups and Jev's own showdowns", () => {
  it('leaves incomplete rotation groups out of the estimate for both sides', () => {
    // Seed 0 is complete (+1, +1); seed 1 has only one of its two rotations (-1).
    const s = summarize([rec(0, 0, 1), rec(0, 1, 1), rec(1, 0, -1)], 'hu');
    expect(s.jev.n).toBe(1);
    expect(s.jev.incompleteGroups).toBe(1);
    expect(s.jev.hands).toBe(3);
    expect(s.jev.bb100).toBeCloseTo(100);
    expect(s.jev.ci95).toBeNull();
    expect(s.opponent.bb100PerSeat).toBeCloseTo(-100);
  });
  it('counts only showdowns Jev was still in', () => {
    const fold = { street: 'flop' as const, choice: 'fold' as const, action: { type: 'fold' as const }, probabilities: { fold: 1, check_or_call: 0, bet_or_raise: 0 }, sizingScore: null, bluffIntent: null, latencyMs: 1, apiCall: true };
    const hands = [
      rec(0, 0, 5, { wentToShowdown: true }),                       // Jev showed down and won
      rec(0, 1, -5, { wentToShowdown: true }),                      // Jev showed down and lost
      rec(1, 0, -1, { wentToShowdown: true, decisions: [fold] }),   // table showed down after Jev folded (old file, derived)
      rec(1, 1, -1, { wentToShowdown: true, jevAtShowdown: false }) // same, explicit flag
    ];
    const s = summarize(hands, 'hu');
    expect(s.jev.showdowns).toBe(2);
    expect(s.jev.showdownWinRate).toBe(0.5);
  });
});
