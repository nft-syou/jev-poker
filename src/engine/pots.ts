import type { HandValue } from "./evaluator";
import type { SeatId } from "./types";

export interface Pot {
  readonly amount: number;
  readonly eligible: readonly SeatId[];
}

export interface Award {
  readonly seat: SeatId;
  readonly amount: number;
  readonly potIndex: number;
}

/**
 * Splits total contributions into main/side pots. Each distinct contribution level of an
 * eligible (not folded) player closes a pot; chips above the highest eligible level
 * (uncalled bets, folded players' excess) are added to the last pot so no chip is lost.
 */
export function buildPots(
  contributions: ReadonlyMap<SeatId, number>,
  eligible: ReadonlySet<SeatId>,
): Pot[] {
  const levels = [
    ...new Set(
      [...contributions]
        .filter(([seat, amount]) => eligible.has(seat) && amount > 0)
        .map(([, amount]) => amount),
    ),
  ].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const [, contributed] of contributions) {
      amount += Math.max(0, Math.min(contributed, level) - previous);
    }
    const eligibleSeats = [...eligible]
      .filter((seat) => (contributions.get(seat) ?? 0) >= level)
      .sort((a, b) => a - b);
    pots.push({ amount, eligible: eligibleSeats });
    previous = level;
  }

  let leftover = 0;
  for (const [, contributed] of contributions) leftover += Math.max(0, contributed - previous);
  const last = pots[pots.length - 1];
  if (leftover > 0 && last !== undefined) {
    pots[pots.length - 1] = { amount: last.amount + leftover, eligible: last.eligible };
  }
  return pots;
}

/** Awards each pot to its best eligible hand(s). Odd chips go to the earliest seat in `oddChipOrder`. */
export function awardPots(
  pots: readonly Pot[],
  // biome-ignore lint/suspicious/noShadowRestrictedNames: parameter name is part of the public interface
  valueOf: (seat: SeatId) => HandValue,
  oddChipOrder: readonly SeatId[],
): Award[] {
  const awards: Award[] = [];
  for (const [potIndex, pot] of pots.entries()) {
    if (pot.amount <= 0 || pot.eligible.length === 0) continue;
    let winners: SeatId[];
    if (pot.eligible.length === 1) {
      winners = [...pot.eligible];
    } else {
      let best = Number.NEGATIVE_INFINITY;
      winners = [];
      for (const seat of pot.eligible) {
        const score = valueOf(seat).score;
        if (score > best) {
          best = score;
          winners = [seat];
        } else if (score === best) {
          winners.push(seat);
        }
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const ordered = oddChipOrder.filter((seat) => winners.includes(seat));
    for (const seat of winners) if (!ordered.includes(seat)) ordered.push(seat);
    for (const seat of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      awards.push({ seat, amount: share + extra, potIndex });
    }
  }
  return awards;
}
