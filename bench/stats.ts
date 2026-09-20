import type { Format, HandRecord, JevSummary, OpponentSummary } from './types.js';

/** Number of seats (= rotations per seed) for a table format. Kept private; bench/matchups.ts owns the canonical version. */
function seatCount(format: Format): number {
  return format === 'hu' ? 2 : 6;
}

/**
 * Linear-interpolation percentile over a sorted ascending array.
 * `idx = p * (n - 1)`, interpolated between the values at `floor(idx)` and `ceil(idx)`.
 * Returns 0 for an empty array.
 */
export function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0]!;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo]!;
  const hiVal = sorted[hi]!;
  if (lo === hi) return loVal;
  const frac = idx - lo;
  return loVal + frac * (hiVal - loVal);
}

/**
 * Mean and 95% confidence interval using the sample standard deviation (n - 1):
 * `half = 1.96 * sd / sqrt(n)`. With fewer than two samples there is no spread to
 * estimate, so `ci` is `null` rather than a misleading zero-width interval.
 */
export function meanCi(xs: number[]): { mean: number; ci: [number, number] | null } {
  const n = xs.length;
  if (n === 0) return { mean: 0, ci: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, ci: null };
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
  const half = (1.96 * Math.sqrt(variance)) / Math.sqrt(n);
  return { mean, ci: [mean - half, mean + half] };
}

/**
 * Did Jev itself reach the showdown? `wentToShowdown` is a property of the table:
 * the hand can be shown down by others after Jev folded. Older result files lack the
 * explicit flag, so fall back to "the table showed down and Jev never folded".
 */
export function jevReachedShowdown(h: HandRecord): boolean {
  if (h.jevAtShowdown !== undefined) return h.jevAtShowdown;
  return h.wentToShowdown && !h.decisions.some((d) => d.action.type === 'fold');
}

function average(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function summarize(hands: HandRecord[], format: Format): { jev: JevSummary; opponent: OpponentSummary } {
  const seats = seatCount(format);
  const groups = new Map<number, HandRecord[]>();
  for (const h of hands) {
    const group = groups.get(h.seedIndex);
    if (group) group.push(h);
    else groups.set(h.seedIndex, [h]);
  }

  // The estimator is balanced only over complete rotation groups (Jev in every seat once
  // for the same deal); a partial run's unfinished groups are left out of bb/100 and its CI.
  const complete = [...groups.values()].filter((g) => g.length === seats);
  const completeHands = complete.flat();
  const xs = complete.map((g) => g.reduce((acc, h) => acc + (h.net[h.jevSeat] ?? 0), 0) / g.length);
  const { mean, ci } = meanCi(xs);

  const allDecisions = hands.flatMap((h) => h.decisions);
  const latencies = allDecisions.map((d) => d.latencyMs).sort((a, b) => a - b);

  const jevShowdowns = hands.filter(jevReachedShowdown);
  const showdownWins = jevShowdowns.filter((h) => (h.net[h.jevSeat] ?? 0) > 0).length;

  const jev: JevSummary = {
    bb100: mean * 100,
    ci95: ci === null ? null : [ci[0] * 100, ci[1] * 100],
    n: complete.length,
    incompleteGroups: groups.size - complete.length,
    hands: hands.length,
    decisions: allDecisions.length,
    apiCalls: allDecisions.filter((d) => d.apiCall === true).length,
    failOpen: allDecisions.filter((d) => d.error !== undefined).length,
    latencyMs: { mean: average(latencies), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    vpip: average(hands.map((h) => (h.jevVpip ? 1 : 0))),
    pfr: average(hands.map((h) => (h.jevPfr ? 1 : 0))),
    showdowns: jevShowdowns.length,
    showdownWinRate: jevShowdowns.length === 0 ? null : showdownWins / jevShowdowns.length,
  };

  const oppSeats = Math.max(seats - 1, 1);
  const opponent: OpponentSummary = {
    // Same hands as Jev's estimate, so the two figures mirror each other (zero-sum).
    bb100PerSeat: average(
      completeHands.map((h) => (h.net.reduce((acc, v, seat) => (seat === h.jevSeat ? acc : acc + v), 0) / oppSeats) * 100),
    ),
    vpip: average(hands.map((h) => h.oppVpip)),
    pfr: average(hands.map((h) => h.oppPfr)),
  };

  return { jev, opponent };
}
