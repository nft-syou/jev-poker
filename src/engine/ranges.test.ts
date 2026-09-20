import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { estimateEquity } from './equity.js';
import { PREFLOP_RANKING } from './preflop-rank.js';
import { classOf, combosOf, estimateEquityVsRanges, inferRange, preflopRangePercent, topPercentRange } from './ranges.js';
import type { HistoryEntry } from './types.js';

describe('preflop ranking', () => {
  it('lists each of the 169 classes once, aces first and the worst offsuit hands last', () => {
    expect(PREFLOP_RANKING).toHaveLength(169);
    expect(new Set(PREFLOP_RANKING).size).toBe(169);
    expect(PREFLOP_RANKING[0]).toBe('AA');
    expect(PREFLOP_RANKING.slice(0, 5)).toEqual(['AA', 'KK', 'QQ', 'JJ', 'TT']);
    expect(PREFLOP_RANKING.indexOf('AKs')).toBeLessThan(PREFLOP_RANKING.indexOf('AKo'));
    expect(PREFLOP_RANKING.indexOf('AKs')).toBeLessThan(PREFLOP_RANKING.indexOf('AJs'));
    expect(PREFLOP_RANKING.indexOf('72o')).toBeGreaterThan(150);
  });
});

describe('combos and ranges', () => {
  it('expands classes to 6 / 4 / 12 holdings', () => {
    expect(combosOf('AA')).toHaveLength(6);
    expect(combosOf('AKs')).toHaveLength(4);
    expect(combosOf('AKo')).toHaveLength(12);
    expect(classOf(parseCards('Kd Ah'))).toBe('AKo');
    expect(classOf(parseCards('9h 9d'))).toBe('99');
  });
  it('covers about the requested share of all holdings', () => {
    const six = topPercentRange(6);
    expect(six.length).toBeGreaterThanOrEqual(0.06 * 1326);
    expect(six.length).toBeLessThan(0.09 * 1326);
    const classes = new Set(six.map((c) => classOf(c)));
    expect(classes.has('AA')).toBe(true);
    expect(classes.has('72o')).toBe(false);
    expect(topPercentRange(100)).toHaveLength(1326);
  });
});

describe('range inference', () => {
  const open: HistoryEntry[] = [{ street: 'preflop', seat: 1, action: { type: 'raise', amount: 300 } }];
  const threeBet: HistoryEntry[] = [...open, { street: 'preflop', seat: 2, action: { type: 'raise', amount: 900 } }];
  it('reads width from preflop actions', () => {
    expect(preflopRangePercent(1, open)).toBe(20);
    expect(preflopRangePercent(2, threeBet)).toBe(6);
    expect(preflopRangePercent(3, [...open, { street: 'preflop', seat: 3, action: { type: 'call' } }])).toBe(25);
    expect(preflopRangePercent(4, [{ street: 'preflop', seat: 4, action: { type: 'call' } }])).toBe(50);
    expect(preflopRangePercent(5, open)).toBe(100);
  });
  it('removes holdings blocked by visible cards and narrows after a postflop bet', () => {
    const board = parseCards('Ah 7d 2c');
    const wide = inferRange(1, open, board, parseCards('As Kd'));
    expect(wide.some(([a, b]) => [a, b].some((c) => c.rank === 14 && c.suit === 'h'))).toBe(false);
    const bet: HistoryEntry[] = [...open, { street: 'flop', seat: 1, action: { type: 'bet', amount: 200 } }];
    const narrow = inferRange(1, bet, board, parseCards('As Kd'));
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow.length).toBeGreaterThan(0);
  });
});

describe('estimateEquityVsRanges', () => {
  it('is lower against a tight range than against random hands', () => {
    const kk = parseCards('Kh Kd');
    const vsRandom = estimateEquity(kk, [], 1, 400);
    const vsTight = estimateEquityVsRanges(kk, [], [topPercentRange(6)], 400);
    expect(vsTight).toBeLessThan(vsRandom - 10);
    expect(estimateEquityVsRanges(parseCards('7h 2d'), [], [topPercentRange(6)], 400)).toBeLessThan(25);
  });
  it('matches random equity for a 100% range, and is deterministic', () => {
    const hole = parseCards('Ah Qh');
    const a = estimateEquityVsRanges(hole, [], [topPercentRange(100)], 600);
    expect(Math.abs(a - estimateEquity(hole, [], 1, 600))).toBeLessThanOrEqual(6);
    expect(estimateEquityVsRanges(hole, [], [topPercentRange(100)], 600)).toBe(a);
  });
});
