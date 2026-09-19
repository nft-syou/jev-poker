import { rankToChar, type Card } from './cards.js';
import { CATEGORY_ORDER, evaluate7, straightHigh, type HandCategory } from './evaluate.js';

export type PreflopStrength = 'premium' | 'strong' | 'medium' | 'weak' | 'trash';

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
  if (hi.rank === lo.rank) return rankToChar(hi.rank) + rankToChar(lo.rank);
  const suited = hi.suit === lo.suit;
  return rankToChar(hi.rank) + rankToChar(lo.rank) + (suited ? 's' : 'o');
}

export function preflopStrength(hole: readonly Card[]): PreflopStrength {
  return TIERS[preflopKey(hole)] ?? 'trash';
}

export function madeHand(hole: readonly Card[], board: readonly Card[]): HandCategory {
  return evaluate7([...hole, ...board]).category;
}

export type Draw = 'flush_draw' | 'open_ended' | 'gutshot';

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

export type PairKind = 'overpair' | 'top_pair' | 'middle_pair' | 'bottom_pair' | 'underpair' | 'board_pair';

/**
 * How good a one-pair hand is relative to the board. Only meaningful when
 * `madeHand` is `'pair'`; returns `null` otherwise or before the flop.
 * - overpair: pocket pair above every board card
 * - top / middle / bottom pair: a hole card pairs the highest / a middle / the lowest board card
 * - underpair: pocket pair below the top board card
 * - board_pair: the pair is on the board, the hole cards add nothing
 */
export function pairKind(hole: readonly Card[], board: readonly Card[]): PairKind | null {
  if (board.length < 3 || madeHand(hole, board) !== 'pair') return null;
  const [a, b] = hole;
  if (!a || !b) return null;
  const boardRanks = [...new Set(board.map((c) => c.rank))].sort((x, y) => y - x);
  const top = boardRanks[0]!;
  const bottom = boardRanks[boardRanks.length - 1]!;
  if (a.rank === b.rank) return a.rank > top ? 'overpair' : 'underpair';
  const paired = [a, b].find((c) => board.some((bc) => bc.rank === c.rank));
  if (!paired) return 'board_pair';
  if (paired.rank === top) return 'top_pair';
  if (paired.rank === bottom) return 'bottom_pair';
  return 'middle_pair';
}
