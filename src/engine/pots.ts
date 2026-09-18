type SeatId = number;

export interface Pot { amount: number; eligible: SeatId[] }

function arraysEqual(a: readonly SeatId[], b: readonly SeatId[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function buildPots(contributed: Map<SeatId, number>, folded: Set<SeatId>): Pot[] {
  const seats = [...contributed.keys()].sort((a, b) => a - b);
  const levels = [...new Set([...contributed.values()].filter((v) => v > 0))].sort((a, b) => a - b);

  const rawPots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of seats) {
      const c = contributed.get(seat) ?? 0;
      amount += Math.min(c, level) - Math.min(c, prev);
    }
    if (amount > 0) {
      const eligible = seats.filter((seat) => (contributed.get(seat) ?? 0) >= level && !folded.has(seat));
      rawPots.push({ amount, eligible });
    }
    prev = level;
  }

  const merged: Pot[] = [];
  for (const pot of rawPots) {
    const last = merged[merged.length - 1];
    if (last && arraysEqual(last.eligible, pot.eligible)) {
      last.amount += pot.amount;
    } else {
      merged.push({ amount: pot.amount, eligible: [...pot.eligible] });
    }
  }
  return merged;
}

export function awardPots(
  pots: readonly Pot[],
  ranking: (seat: SeatId) => number,
  oddChipOrder: readonly SeatId[],
): { seat: SeatId; amount: number; potIndex: number }[] {
  const results: { seat: SeatId; amount: number; potIndex: number }[] = [];
  pots.forEach((pot, potIndex) => {
    let maxRank = -Infinity;
    for (const seat of pot.eligible) {
      const r = ranking(seat);
      if (r > maxRank) maxRank = r;
    }
    const winners = pot.eligible.filter((seat) => ranking(seat) === maxRank);
    const orderedWinners = oddChipOrder.filter((seat) => winners.includes(seat));
    const leftover = winners.filter((seat) => !oddChipOrder.includes(seat));
    const finalOrder = [...orderedWinners, ...leftover];

    const share = Math.floor(pot.amount / finalOrder.length);
    const remainder = pot.amount - share * finalOrder.length;
    finalOrder.forEach((seat, i) => {
      const amount = share + (i < remainder ? 1 : 0);
      results.push({ seat, amount, potIndex });
    });
  });
  return results;
}
