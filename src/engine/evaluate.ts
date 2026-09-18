import type { Card } from './cards.js';
export type HandCategory = 'high_card'|'pair'|'two_pair'|'three_of_a_kind'|'straight'|'flush'|'full_house'|'four_of_a_kind'|'straight_flush';
export const CATEGORY_ORDER: readonly HandCategory[] = ['high_card','pair','two_pair','three_of_a_kind','straight','flush','full_house','four_of_a_kind','straight_flush'];
export interface HandValue { category: HandCategory; ranks: number[]; score: number }

export function straightHigh(distinctDesc: number[]): number | null {
  const set = new Set(distinctDesc);
  for (const hi of distinctDesc) if ([hi-1,hi-2,hi-3,hi-4].every((r) => set.has(r))) return hi;
  if ([14,5,4,3,2].every((r) => set.has(r))) return 5;
  return null;
}
export function evaluate5(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new Error('evaluate5 needs 5 cards');
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]); // [rank,count]
  const distinctDesc = groups.map((g) => g[0]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const sHigh = groups.length === 5 ? straightHigh(distinctDesc) : null;
  let category: HandCategory; let ranks: number[];
  const byGroup = groups.map((g) => g[0]);
  if (sHigh !== null && flush) { category = 'straight_flush'; ranks = [sHigh]; }
  else if (groups[0]![1] === 4) { category = 'four_of_a_kind'; ranks = byGroup; }
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) { category = 'full_house'; ranks = byGroup; }
  else if (flush) { category = 'flush'; ranks = distinctDesc; }
  else if (sHigh !== null) { category = 'straight'; ranks = [sHigh]; }
  else if (groups[0]![1] === 3) { category = 'three_of_a_kind'; ranks = byGroup; }
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) { category = 'two_pair'; ranks = byGroup; }
  else if (groups[0]![1] === 2) { category = 'pair'; ranks = byGroup; }
  else { category = 'high_card'; ranks = distinctDesc; }
  let score = CATEGORY_ORDER.indexOf(category);
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return { category, ranks, score };
}
export function evaluate7(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluate7 needs 5..7 cards');
  let best: HandValue | null = null;
  const n = cards.length;
  const idx = [0, 1, 2, 3, 4];
  const visit = () => { const v = evaluate5(idx.map((i) => cards[i]!)); if (!best || v.score > best.score) best = v; };
  // enumerate combinations
  const rec = (start: number, depth: number) => {
    if (depth === 5) { visit(); return; }
    for (let i = start; i <= n - (5 - depth); i++) { idx[depth] = i; rec(i + 1, depth + 1); }
  };
  rec(0, 0);
  return best!;
}
export function compareHands(a: HandValue, b: HandValue): number { return a.score - b.score; }
