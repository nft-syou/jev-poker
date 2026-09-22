import {
  type Card,
  createDeck,
  formatCard,
  type Rank,
  rankChar,
  SUITS,
  type Suit,
} from "./cards.js";
import { evaluateBest } from "./evaluator.js";
import { PREFLOP_RANKING } from "./preflop-rank.js";
import { createRng, hashSeed, randomInt } from "./rng.js";
import type { SeatId, Street } from "./types.js";
import type { HistoryEntry } from "./view.js";

/** A concrete two-card holding. */
export type Combo = readonly [Card, Card];

const RANK_OF: Record<string, Rank> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** Every concrete holding of a class key such as `AA`, `AKs` or `T9o`. */
export function combosOf(key: string): Combo[] {
  const hi = RANK_OF[key[0] ?? ""];
  const lo = RANK_OF[key[1] ?? ""];
  if (hi === undefined || lo === undefined) throw new Error(`bad hand class: ${key}`);
  const out: Combo[] = [];
  for (let i = 0; i < SUITS.length; i++) {
    for (let j = 0; j < SUITS.length; j++) {
      const a = SUITS[i] as Suit;
      const b = SUITS[j] as Suit;
      if (hi === lo) {
        if (i < j)
          out.push([
            { rank: hi, suit: a },
            { rank: lo, suit: b },
          ]);
      } else if (key[2] === "s") {
        if (i === j)
          out.push([
            { rank: hi, suit: a },
            { rank: lo, suit: b },
          ]);
      } else if (i !== j) {
        out.push([
          { rank: hi, suit: a },
          { rank: lo, suit: b },
        ]);
      }
    }
  }
  return out;
}

const TOTAL_COMBOS = 1326;

/** The strongest classes that together cover about `percent` of all 1,326 holdings, as concrete combos. */
export function topPercentRange(percent: number): Combo[] {
  const target = (Math.min(Math.max(percent, 0), 100) / 100) * TOTAL_COMBOS;
  const out: Combo[] = [];
  for (const key of PREFLOP_RANKING) {
    if (out.length >= target) break;
    out.push(...combosOf(key));
  }
  return out;
}

/**
 * How wide a player's range is after their preflop actions, as a share of all hands.
 * Generic assumptions, not tuned to any opponent: a re-raise is the top few percent, an
 * open raise a fifth of hands, a call of a raise a quarter, a limp half, no voluntary
 * action yet anything.
 */
export function preflopRangePercent(seat: SeatId, history: readonly HistoryEntry[]): number {
  let raisesBefore = 0;
  let percent = 100;
  for (const h of history) {
    if (h.street !== "preflop") break;
    const t = h.action.type;
    const aggressive = t === "raise" || t === "bet" || t === "allin";
    if (h.seat === seat) {
      if (aggressive) percent = Math.min(percent, raisesBefore === 0 ? 20 : 6);
      else if (t === "call") percent = Math.min(percent, raisesBefore === 0 ? 50 : 25);
    }
    if (aggressive) raisesBefore++;
  }
  return percent;
}

/** Postflop aggression narrows a range to its best current holdings: a bet keeps the top half, a raise the top quarter. */
function postflopKeepFraction(seat: SeatId, history: readonly HistoryEntry[]): number {
  let keep = 1;
  const betsOnStreet = new Map<Street, number>();
  for (const h of history) {
    if (h.street === "preflop") continue;
    const t = h.action.type;
    if (t !== "bet" && t !== "raise" && t !== "allin") continue;
    const before = betsOnStreet.get(h.street) ?? 0;
    if (h.seat === seat) keep = Math.min(keep, before === 0 ? 0.5 : 0.25);
    betsOnStreet.set(h.street, before + 1);
  }
  return keep;
}

/**
 * The holdings an opponent plausibly has, given what they did this hand: their preflop
 * range, minus anything the visible cards rule out, narrowed to the strongest current
 * holdings if they bet or raised after the flop.
 */
export function inferRange(
  seat: SeatId,
  history: readonly HistoryEntry[],
  board: readonly Card[],
  dead: readonly Card[],
): Combo[] {
  const blocked = new Set([...board, ...dead].map(formatCard));
  let combos = topPercentRange(preflopRangePercent(seat, history)).filter(
    ([a, b]) => !blocked.has(formatCard(a)) && !blocked.has(formatCard(b)),
  );
  const keep = postflopKeepFraction(seat, history);
  if (keep < 1 && board.length >= 3 && combos.length > 0) {
    const scored = combos.map((c) => ({ c, score: evaluateBest([c[0], c[1], ...board]).score }));
    scored.sort((x, y) => y.score - x.score);
    combos = scored.slice(0, Math.max(1, Math.ceil(scored.length * keep))).map((x) => x.c);
  }
  return combos;
}

function code(c: Card): number {
  return (c.rank - 2) * 4 + "cdhs".indexOf(c.suit);
}

/**
 * Monte Carlo showdown equity (win + shared ties, percent) against opponents whose hands
 * are drawn from the given ranges. Deterministic: seeded from the visible cards and the
 * range sizes. An opponent with an empty range (everything blocked) is dealt at random.
 */
export function estimateEquityVsRanges(
  hole: readonly Card[],
  board: readonly Card[],
  ranges: readonly (readonly Combo[])[],
  samples = 150,
): number {
  if (hole.length !== 2) throw new Error("estimateEquityVsRanges needs 2 hole cards");
  const known = new Set([...hole, ...board].map(formatCard));
  const deck = createDeck().filter((c) => !known.has(formatCard(c)));
  const rng = createRng(
    hashSeed(...[...hole, ...board].map(code), ...ranges.map((r) => r.length), 77),
  );
  const opponents = Math.max(1, ranges.length);
  let equity = 0;
  let counted = 0;
  for (let s = 0; s < samples; s++) {
    const used = new Set<string>();
    const hands: Combo[] = [];
    let ok = true;
    for (let o = 0; o < opponents; o++) {
      const range = ranges[o] ?? [];
      let picked: Combo | null = null;
      for (let attempt = 0; attempt < 12 && picked === null; attempt++) {
        const cand: Combo =
          range.length > 0
            ? (range[randomInt(rng, range.length)] as Combo)
            : [
                deck[randomInt(rng, deck.length)] as Card,
                deck[randomInt(rng, deck.length)] as Card,
              ];
        const a = formatCard(cand[0]);
        const b = formatCard(cand[1]);
        if (a === b || used.has(a) || used.has(b) || known.has(a) || known.has(b)) continue;
        picked = cand;
        used.add(a);
        used.add(b);
      }
      if (picked === null) {
        ok = false;
        break;
      }
      hands.push(picked);
    }
    if (!ok) continue;
    const free = deck.filter((c) => !used.has(formatCard(c)));
    const need = 5 - board.length;
    for (let i = 0; i < need; i++) {
      const j = i + randomInt(rng, free.length - i);
      const a = free[i] as Card;
      free[i] = free[j] as Card;
      free[j] = a;
    }
    const full = [...board, ...free.slice(0, need)];
    const hero = evaluateBest([...hole, ...full]).score;
    let tied = 1;
    let beaten = false;
    for (const h of hands) {
      const v = evaluateBest([h[0], h[1], ...full]).score;
      if (v > hero) {
        beaten = true;
        break;
      }
      if (v === hero) tied++;
    }
    if (!beaten) equity += 1 / tied;
    counted++;
  }
  return counted === 0 ? 0 : Math.round((100 * equity) / counted);
}

/** `AKs`-style class key of a holding; exported for tests and diagnostics. */
export function classOf(hole: readonly Card[]): string {
  const [a, b] = hole;
  if (!a || !b) throw new Error("classOf needs 2 cards");
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  if (hi.rank === lo.rank) return rankChar(hi.rank) + rankChar(lo.rank);
  return rankChar(hi.rank) + rankChar(lo.rank) + (hi.suit === lo.suit ? "s" : "o");
}
