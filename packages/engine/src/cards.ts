export type Suit = "c" | "d" | "h" | "s";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export const SUITS: readonly Suit[] = ["c", "d", "h", "s"];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_CHARS = "23456789TJQKA";

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

export function rankChar(rank: Rank): string {
  return RANK_CHARS.charAt(rank - 2);
}

export function formatCard(card: Card): string {
  return `${RANK_CHARS.charAt(card.rank - 2)}${card.suit}`;
}

export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`invalid card "${text}"`);
  const rankIndex = RANK_CHARS.indexOf(text.charAt(0).toUpperCase());
  const suit = text.charAt(1).toLowerCase();
  if (rankIndex < 0 || !isSuit(suit)) throw new Error(`invalid card "${text}"`);
  return { rank: (rankIndex + 2) as Rank, suit };
}

export function parseCards(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(parseCard);
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

function isSuit(value: string): value is Suit {
  return (SUITS as readonly string[]).includes(value);
}
