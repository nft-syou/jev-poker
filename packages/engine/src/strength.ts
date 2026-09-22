import { type Card, RANKS, type Rank, rankChar, SUITS } from "./cards.js";
import { evaluateBest, HAND_CATEGORIES, type HandCategory } from "./evaluator.js";

export type PreflopStrength = "premium" | "strong" | "medium" | "weak" | "trash";

const PREMIUM = ["AA", "KK", "QQ", "JJ", "AKs", "AKo"];
const STRONG = ["TT", "99", "AQs", "AQo", "AJs", "KQs", "ATs", "KJs"];
const MEDIUM = [
  "88",
  "77",
  "66",
  "AJo",
  "KQo",
  "QJs",
  "JTs",
  "T9s",
  "KTs",
  "QTs",
  "A9s",
  "A8s",
  "A7s",
  "A6s",
  "A5s",
  "A4s",
  "A3s",
  "A2s",
  "ATo",
  "KJo",
];
const WEAK = [
  "55",
  "44",
  "33",
  "22",
  "98s",
  "87s",
  "76s",
  "65s",
  "54s",
  "J9s",
  "T8s",
  "97s",
  "86s",
  "A9o",
  "A8o",
  "A7o",
  "A6o",
  "A5o",
  "A4o",
  "A3o",
  "A2o",
  "KTo",
  "QJo",
  "QTo",
  "JTo",
  "K9s",
  "Q9s",
  "J8s",
];

const TIERS: Record<string, PreflopStrength> = {};
for (const k of PREMIUM) TIERS[k] = "premium";
for (const k of STRONG) TIERS[k] = "strong";
for (const k of MEDIUM) TIERS[k] = "medium";
for (const k of WEAK) TIERS[k] = "weak";

function preflopKey(hole: readonly Card[]): string {
  const [a, b] = hole;
  if (!a || !b) throw new Error("preflopKey needs 2 hole cards");
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  if (hi.rank === lo.rank) return rankChar(hi.rank) + rankChar(lo.rank);
  const suited = hi.suit === lo.suit;
  return rankChar(hi.rank) + rankChar(lo.rank) + (suited ? "s" : "o");
}

export function preflopStrength(hole: readonly Card[]): PreflopStrength {
  return TIERS[preflopKey(hole)] ?? "trash";
}

export function madeHand(hole: readonly Card[], board: readonly Card[]): HandCategory {
  return evaluateBest([...hole, ...board]).category;
}

export type Draw = "flush_draw" | "open_ended" | "gutshot";

export function detectDraws(hole: readonly Card[], board: readonly Card[]): Draw[] {
  if (board.length < 3 || board.length > 4) return [];
  const all = [...hole, ...board];
  const draws: Draw[] = [];

  for (const suit of SUITS) {
    const total = all.filter((c) => c.suit === suit).length;
    const inHole = hole.filter((c) => c.suit === suit).length;
    if (total === 4 && inHole >= 1) draws.push("flush_draw");
  }

  const made = evaluateBest(all);
  const straightOrBetter =
    HAND_CATEGORIES.indexOf(made.category) >= HAND_CATEGORIES.indexOf("straight");
  if (!straightOrBetter) {
    const present = new Set<number>(all.map((c) => c.rank));
    const boardPresent = new Set<number>(board.map((c) => c.rank));
    const boardOnlyOuts = new Set<number>(
      RANKS.filter((rank) => !boardPresent.has(rank) && hasStraight([...boardPresent, rank])),
    );
    const outs = RANKS.filter(
      (rank) => !present.has(rank) && hasStraight([...present, rank]) && !boardOnlyOuts.has(rank),
    );
    if (outs.length >= 2) draws.push("open_ended");
    else if (outs.length === 1) draws.push("gutshot");
  }
  return draws;
}

function hasStraight(ranks: readonly number[]): boolean {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high--) {
    if ([0, 1, 2, 3, 4].every((d) => set.has(high - d))) return true;
  }
  return false;
}

export type PairKind =
  | "overpair"
  | "top_pair"
  | "middle_pair"
  | "bottom_pair"
  | "underpair"
  | "board_pair";

/**
 * How good a one-pair hand is relative to the board. Only meaningful when
 * `madeHand` is `'pair'`; returns `null` otherwise or before the flop.
 * - overpair: pocket pair above every board card
 * - top / middle / bottom pair: a hole card pairs the highest / a middle / the lowest board card
 * - underpair: pocket pair below the top board card
 * - board_pair: the pair is on the board, the hole cards add nothing
 */
export function pairKind(hole: readonly Card[], board: readonly Card[]): PairKind | null {
  if (board.length < 3 || madeHand(hole, board) !== "pair") return null;
  const [a, b] = hole;
  if (!a || !b) return null;
  const boardRanks = [...new Set(board.map((c) => c.rank))].sort((x, y) => y - x);
  // The board has at least three cards here, so both ends exist.
  const top = boardRanks[0] as Rank;
  const bottom = boardRanks[boardRanks.length - 1] as Rank;
  if (a.rank === b.rank) return a.rank > top ? "overpair" : "underpair";
  const paired = [a, b].find((c) => board.some((bc) => bc.rank === c.rank));
  if (!paired) return "board_pair";
  if (paired.rank === top) return "top_pair";
  if (paired.rank === bottom) return "bottom_pair";
  return "middle_pair";
}
