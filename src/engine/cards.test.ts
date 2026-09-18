import { describe, expect, it } from 'vitest';
import { cardToString, newDeck, parseCard, parseCards } from './cards.js';

describe('cards', () => {
  it('deck has 52 unique cards', () => {
    const d = newDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map(cardToString)).size).toBe(52);
  });
  it('round-trips strings', () => {
    expect(cardToString(parseCard('As'))).toBe('As');
    expect(parseCard('Td')).toEqual({ rank: 10, suit: 'd' });
    expect(parseCards('As Kd 2c')).toHaveLength(3);
  });
  it('rejects garbage', () => expect(() => parseCard('Zz')).toThrow());
});
