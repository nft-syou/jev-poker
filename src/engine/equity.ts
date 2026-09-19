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
