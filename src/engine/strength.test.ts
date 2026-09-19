import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { draws, madeHand, pairKind, preflopStrength } from './strength.js';

describe('preflopStrength', () => {
  it.each([
    ['Ah Ad', 'premium'], ['Ah Kh', 'premium'], ['Ah Kd', 'premium'],
    ['Th Td', 'strong'], ['Ah Qd', 'strong'], ['Kh Qh', 'strong'],
    ['8h 8d', 'medium'], ['Ah 5h', 'medium'], ['Ah Jd', 'medium'],
    ['2h 2d', 'weak'], ['9h 8h', 'weak'], ['Ah 2d', 'weak'],
    ['7h 2d', 'trash'], ['Kh 3d', 'trash'],
  ])('%s → %s', (h, t) => expect(preflopStrength(parseCards(h))).toBe(t));
});
describe('madeHand', () => {
  it('uses hole + board', () => expect(madeHand(parseCards('Ah Ad'), parseCards('Ac 7s 2d'))).toBe('three_of_a_kind'));
});
describe('draws', () => {
  it('flush draw', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7c'))).toContain('flush_draw'));
  it('open ended', () => expect(draws(parseCards('9h 8d'), parseCards('Tc 7s 2d'))).toContain('open_ended'));
  it('gutshot', () => expect(draws(parseCards('9h 8d'), parseCards('Tc 6s 2d'))).toContain('gutshot'));
  it('none on river', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7c 3d 4s'))).toEqual([]));
  it('no draw when already made', () => expect(draws(parseCards('Ah 9h'), parseCards('Kh 2h 7h'))).toEqual([]));
});

describe('pairKind', () => {
  const pk = (h: string, b: string) => pairKind(parseCards(h), parseCards(b));
  it('classifies pairs against the board', () => {
    expect(pk('Ah Ad', 'Kc 7s 2d')).toBe('overpair');
    expect(pk('9h 9d', 'Kc 7s 2d')).toBe('underpair');
    expect(pk('Kh 5d', 'Kc 7s 2d')).toBe('top_pair');
    expect(pk('7h 5d', 'Kc 7s 2d')).toBe('middle_pair');
    expect(pk('2h 5d', 'Kc 7s 2d')).toBe('bottom_pair');
    expect(pk('Ah 5d', 'Kc 7s 7d')).toBe('board_pair');
  });
  it('is null without exactly one pair or before the flop', () => {
    expect(pk('Ah Kd', 'Kc 7s 2d Ks')).toBeNull();
    expect(pk('Ah 5d', 'Kc 7s 2d')).toBeNull();
    expect(pk('Ah Ad', '')).toBeNull();
  });
});
