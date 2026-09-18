export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export interface Card { readonly rank: Rank; readonly suit: Suit }
export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_CHARS = '23456789TJQKA';
export function newDeck(): Card[] { const d: Card[] = []; for (const suit of SUITS) for (const rank of RANKS) d.push({ rank, suit }); return d; }
export function cardToString(c: Card): string { return RANK_CHARS[c.rank - 2]! + c.suit; }
export function parseCard(s: string): Card {
  const i = RANK_CHARS.indexOf(s[0]!.toUpperCase()); const suit = s[1] as Suit;
  if (s.length !== 2 || i < 0 || !SUITS.includes(suit)) throw new Error(`bad card: ${s}`);
  return { rank: (i + 2) as Rank, suit };
}
export function parseCards(s: string): Card[] { return s.trim().split(/\s+/).filter(Boolean).map(parseCard); }
