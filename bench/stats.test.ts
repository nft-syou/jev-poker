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
    expect(r).toEqual({ mean: 1, lo: 1, hi: 1 });
    // mean 2, sample sd sqrt(4.5) = 2.1213, half = 1.96 * 2.1213 / sqrt(2) = 2.94
    const two = meanCi([0.5, 3.5]);
    expect(two.mean).toBeCloseTo(2, 1);
    expect(two.lo).toBeCloseTo(-0.94, 1);
    expect(two.hi).toBeCloseTo(4.94, 1);
  });

  it('summarize groups mirrored hands per seed', () => {
    const hands = [rec(0, 0, 2), rec(0, 1, -1), rec(1, 0, 4), rec(1, 1, 3)]; // x = [0.5, 3.5]
    const s = summarize(hands, 'hu');
    expect(s.jev.n).toBe(2);
    expect(s.jev.hands).toBe(4);
    expect(s.jev.bb100).toBeCloseTo(200);
    // Same CI as meanCi([0.5, 3.5]), scaled to 100 hands.
    expect(s.jev.ci95[0]).toBeCloseTo(-94.0, 1);
    expect(s.jev.ci95[1]).toBeCloseTo(494.0, 1);
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
          choice: 'fold',
          action: { type: 'fold' },
          probabilities: { fold: 1, check_or_call: 0, bet_or_raise: 0 },
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
