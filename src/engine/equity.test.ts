import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { estimateEquity } from './equity.js';

describe('estimateEquity', () => {
  it('AA heads-up preflop is about 85%', () => {
    const e = estimateEquity(parseCards('Ah Ad'), [], 1, 600);
    expect(e).toBeGreaterThan(80);
    expect(e).toBeLessThan(90);
  });
  it('72o heads-up preflop is about 35%', () => {
    const e = estimateEquity(parseCards('7h 2d'), [], 1, 600);
    expect(e).toBeGreaterThan(28);
    expect(e).toBeLessThan(42);
  });
  it('drops with more opponents', () => {
    expect(estimateEquity(parseCards('Ah Kd'), [], 5, 400)).toBeLessThan(estimateEquity(parseCards('Ah Kd'), [], 1, 400));
  });
  it('is 100% with the nuts on the river', () => {
    expect(estimateEquity(parseCards('Ah Kh'), parseCards('Qh Jh Th 2c 3d'), 3, 100)).toBe(100);
  });
  it('is deterministic for the same cards', () => {
    expect(estimateEquity(parseCards('9c 8c'), parseCards('7d 6s 2h'), 2)).toBe(estimateEquity(parseCards('9c 8c'), parseCards('7d 6s 2h'), 2));
  });
  it('rejects bad input', () => {
    expect(() => estimateEquity(parseCards('Ah'), [], 1)).toThrow();
  });
});
