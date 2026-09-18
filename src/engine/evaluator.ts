import type { Card, Rank } from "./cards";

export type HandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush";

/** Weakest first. */
export const HAND_CATEGORIES: readonly HandCategory[] = [
  "high_card",
  "pair",
  "two_pair",
  "three_of_a_kind",
  "straight",
  "flush",
  "full_house",
  "four_of_a_kind",
  "straight_flush",
];

export interface HandValue {
  readonly category: HandCategory;
  /** Tie-break ranks, most significant first (e.g. full house: [trips, pair]). */
  readonly ranks: readonly Rank[];
  /** Higher is better; equal means a tie. */
  readonly score: number;
}

export function evaluate5(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new Error(`evaluate5 needs 5 cards, got ${cards.length}`);
  const counts = new Map<Rank, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  // Groups sorted by count desc, then rank desc: [[rank, count], ...]
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = groups.map(([rank]) => rank).sort((a, b) => b - a);
  const firstSuit = cards[0]?.suit;
  const isFlush = cards.every((card) => card.suit === firstSuit);
  const straightHigh = straightHighCard(distinct);
  const [g0, g1] = groups;
  const count0 = g0?.[1] ?? 0;
  const count1 = g1?.[1] ?? 0;

  let category: HandCategory;
  let ranks: Rank[];
  if (straightHigh !== null && isFlush) {
    category = "straight_flush";
    ranks = [straightHigh];
  } else if (count0 === 4) {
    category = "four_of_a_kind";
    ranks = groups.map(([rank]) => rank);
  } else if (count0 === 3 && count1 === 2) {
    category = "full_house";
    ranks = groups.map(([rank]) => rank);
  } else if (isFlush) {
    category = "flush";
    ranks = distinct;
  } else if (straightHigh !== null) {
    category = "straight";
    ranks = [straightHigh];
  } else if (count0 === 3) {
    category = "three_of_a_kind";
    ranks = groups.map(([rank]) => rank);
  } else if (count0 === 2 && count1 === 2) {
    category = "two_pair";
    ranks = groups.map(([rank]) => rank);
  } else if (count0 === 2) {
    category = "pair";
    ranks = groups.map(([rank]) => rank);
  } else {
    category = "high_card";
    ranks = distinct;
  }
  return { category, ranks, score: encode(category, ranks) };
}

export function evaluateBest(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateBest needs between 5 and 7 cards, got ${cards.length}`);
  }
  if (cards.length === 5) return evaluate5(cards);
  let best: HandValue | null = null;
  for (const combo of combinations(cards.length, 5)) {
    const value = evaluate5(combo.map((index) => cards[index] as Card));
    if (best === null || value.score > best.score) best = value;
  }
  return best as HandValue;
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}

/** `distinct` must be sorted descending. Returns the straight's high card or null. */
function straightHighCard(distinct: readonly Rank[]): Rank | null {
  if (distinct.length !== 5) return null;
  const top = distinct[0] as Rank;
  const bottom = distinct[4] as Rank;
  if (top - bottom === 4) return top;
  // Wheel: A 5 4 3 2
  if (top === 14 && distinct[1] === 5 && bottom === 2) return 5;
  return null;
}

function encode(category: HandCategory, ranks: readonly Rank[]): number {
  let score = HAND_CATEGORIES.indexOf(category);
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return score;
}

function* combinations(n: number, k: number): Generator<number[]> {
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield [...indices];
    let i = k - 1;
    while (i >= 0 && (indices[i] as number) === n - k + i) i--;
    if (i < 0) return;
    indices[i] = (indices[i] as number) + 1;
    for (let j = i + 1; j < k; j++) indices[j] = (indices[j - 1] as number) + 1;
  }
}
