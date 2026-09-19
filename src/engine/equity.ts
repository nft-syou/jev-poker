import { cardToString, newDeck, type Card } from './cards.js';
import { evaluate7 } from './evaluate.js';
import { Rng, hashSeed } from './rng.js';

/** Card → small integer so a hand can seed the estimate deterministically. */
function cardCode(c: Card): number {
  return (c.rank - 2) * 4 + 'cdhs'.indexOf(c.suit);
}

/**
 * Monte Carlo estimate of the hero's showdown equity (win + shared ties), in percent,
 * against `opponents` random hands with the remaining board dealt at random.
 *
 * Deterministic: the sample stream is seeded from the visible cards, so the same
 * hole cards and board always yield the same estimate.
 */
export function estimateEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  samples = 150,
): number {
  if (hole.length !== 2) throw new Error('estimateEquity needs 2 hole cards');
  if (board.length > 5) throw new Error('estimateEquity board has more than 5 cards');
  const opp = Math.max(1, Math.min(opponents, 9));
  const known = new Set([...hole, ...board].map(cardToString));
  const rest = newDeck().filter((c) => !known.has(cardToString(c)));
  const rng = new Rng(hashSeed(...[...hole, ...board].map(cardCode), opp));
  const need = 5 - board.length + 2 * opp;
  let equity = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher–Yates: only the first `need` cards are needed.
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(rest.length - i);
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    const fullBoard = [...board, ...rest.slice(0, 5 - board.length)];
    const hero = evaluate7([...hole, ...fullBoard]).score;
    let best = hero;
    let tied = 1;
    let beaten = false;
    for (let o = 0; o < opp; o++) {
      const start = 5 - board.length + 2 * o;
      const v = evaluate7([rest[start]!, rest[start + 1]!, ...fullBoard]).score;
      if (v > best) { beaten = true; break; }
      if (v === best) tied++;
    }
    if (!beaten) equity += 1 / tied;
  }
  return Math.round((100 * equity) / samples);
}

/**
 * Exact current hand strength: the percentage of all possible opponent two-card
 * holdings that the hero's hand beats right now on this board (ties count half).
 * Ignores future cards, so it is a "made hand" strength, not equity. Requires a
 * flop or later; returns `null` before the flop.
 */
export function handStrengthPct(hole: readonly Card[], board: readonly Card[]): number | null {
  if (hole.length !== 2) throw new Error('handStrengthPct needs 2 hole cards');
  if (board.length < 3 || board.length > 5) return null;
  const known = new Set([...hole, ...board].map(cardToString));
  const rest = newDeck().filter((c) => !known.has(cardToString(c)));
  const hero = evaluate7([...hole, ...board]).score;
  let ahead = 0;
  let total = 0;
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const v = evaluate7([rest[i]!, rest[j]!, ...board]).score;
      if (hero > v) ahead += 1;
      else if (hero === v) ahead += 0.5;
      total++;
    }
  }
  return Math.round((100 * ahead) / total);
}

/** Board features that make hands stronger than the hero's category possible. */
export interface BoardTexture {
  paired: boolean;
  /** Three or more cards of one suit on the board. */
  flushPossible: boolean;
  /** Three board ranks within a five-rank window (a straight is possible). */
  straightPossible: boolean;
}

export function boardTexture(board: readonly Card[]): BoardTexture | null {
  if (board.length < 3) return null;
  const ranks = [...new Set(board.map((c) => c.rank))];
  const paired = ranks.length < board.length;
  const suitCounts = new Map<string, number>();
  for (const c of board) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  const flushPossible = [...suitCounts.values()].some((n) => n >= 3);
  const withWheel = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...withWheel].sort((a, b) => a - b);
  let straightPossible = false;
  for (let i = 0; i + 2 < sorted.length; i++) if (sorted[i + 2]! - sorted[i]! <= 4) straightPossible = true;
  return { paired, flushPossible, straightPossible };
}
