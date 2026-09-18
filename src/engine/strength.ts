import type { Card, Rank } from './cards.js';
import { CATEGORY_ORDER, evaluate7, type HandCategory } from './evaluate.js';

export type PreflopStrength = 'premium' | 'strong' | 'medium' | 'weak' | 'trash';

const RANK_CHARS = '23456789TJQKA';
const rankChar = (r: Rank): string => RANK_CHARS[r - 2]!;

const PREMIUM = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'];
const STRONG = ['TT', '99', 'AQs', 'AQo', 'AJs', 'KQs', 'ATs', 'KJs'];
const MEDIUM = [
  '88', '77', '66', 'AJo', 'KQo', 'QJs', 'JTs', 'T9s', 'KTs', 'QTs',
  'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', 'ATo', 'KJo',
];
const WEAK = [
  '55', '44', '33', '22',
  '98s', '87s', '76s', '65s', '54s', 'J9s', 'T8s', '97s', '86s',
  'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o',
  'KTo', 'QJo', 'QTo', 'JTo', 'K9s', 'Q9s', 'J8s',
];

const TIERS: Record<string, PreflopStrength> = {};
for (const k of PREMIUM) TIERS[k] = 'premium';
for (const k of STRONG) TIERS[k] = 'strong';
for (const k of MEDIUM) TIERS[k] = 'medium';
for (const k of WEAK) TIERS[k] = 'weak';

function preflopKey(hole: readonly Card[]): string {
  const [a, b] = hole;
  if (!a || !b) throw new Error('preflopKey needs 2 hole cards');
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  if (hi.rank === lo.rank) return rankChar(hi.rank) + rankChar(lo.rank);
  const suited = hi.suit === lo.suit;
  return rankChar(hi.rank) + rankChar(lo.rank) + (suited ? 's' : 'o');
}

export function preflopStrength(hole: readonly Card[]): PreflopStrength {
  return TIERS[preflopKey(hole)] ?? 'trash';
}

export function madeHand(hole: readonly Card[], board: readonly Card[]): HandCategory {
  return evaluate7([...hole, ...board]).category;
}

export type Draw = 'flush_draw' | 'open_ended' | 'gutshot';

function straightHigh(distinctDesc: number[]): number | null {
  const set = new Set(distinctDesc);
  for (const hi of distinctDesc) if ([hi - 1, hi - 2, hi - 3, hi - 4].every((r) => set.has(r))) return hi;
  if ([14, 5, 4, 3, 2].every((r) => set.has(r))) return 5;
  return null;
}

export function draws(hole: readonly Card[], board: readonly Card[]): Draw[] {
  if (board.length !== 3 && board.length !== 4) return [];
  const combined = [...hole, ...board];
  const category = evaluate7(combined).category;
  const categoryIndex = CATEGORY_ORDER.indexOf(category);
  const result: Draw[] = [];

  if (categoryIndex < CATEGORY_ORDER.indexOf('flush')) {
    const suitCounts = new Map<string, number>();
    for (const c of combined) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    if ([...suitCounts.values()].some((n) => n === 4)) result.push('flush_draw');
  }

  if (categoryIndex < CATEGORY_ORDER.indexOf('straight')) {
    const rankSet = new Set(combined.map((c) => c.rank));
    const outs = new Set<number>();
    for (let r = 2; r <= 14; r++) {
      const withOut = [...rankSet, r];
      const distinctDesc = [...new Set(withOut)].sort((a, b) => b - a);
      if (straightHigh(distinctDesc) !== null) outs.add(r);
    }
    if (outs.size >= 2) result.push('open_ended');
    else if (outs.size === 1) result.push('gutshot');
  }

  return result.sort();
}
