import type { Format, HandRecord, JevSummary, OpponentSummary } from './types.js';

/** Number of seats for a given table format. Kept private; bench/matchups.ts owns the canonical version. */
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
 * Mean and 95% confidence interval using the sample standard deviation (n - 1).
 * `half = 1.96 * sd / sqrt(n)`. All fields are 0 for an empty array; `sd` is 0 (and thus
 * `lo === hi === mean`) when there are fewer than 2 samples.
 */
export function meanCi(xs: number[]): { mean: number; lo: number; hi: number } {
  const n = xs.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let sd = 0;
  if (n >= 2) {
    const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    sd = Math.sqrt(variance);
  }
  const half = (1.96 * sd) / Math.sqrt(n);
  return { mean, lo: mean - half, hi: mean + half };
}

export function summarize(hands: HandRecord[], format: Format): { jev: JevSummary; opponent: OpponentSummary } {
  const groups = new Map<number, HandRecord[]>();
  for (const h of hands) {
    const group = groups.get(h.seedIndex);
    if (group) group.push(h);
    else groups.set(h.seedIndex, [h]);
  }

  const xs: number[] = [];
  for (const group of groups.values()) {
    const sum = group.reduce((acc, h) => acc + (h.net[h.jevSeat] ?? 0), 0);
    xs.push(sum / group.length);
  }

  const { mean, lo, hi } = meanCi(xs);
  const bb100 = mean * 100;
  const ci95: [number, number] = [lo * 100, hi * 100];

  const allDecisions = hands.flatMap((h) => h.decisions);
  const decisions = allDecisions.length;
  const apiCalls = allDecisions.filter((d) => d.apiCall === true).length;
  const failOpen = allDecisions.filter((d) => d.error !== undefined).length;

  const latencies = allDecisions.map((d) => d.latencyMs).sort((a, b) => a - b);
  const latencyMs = {
    mean: latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
  };

  const vpip = hands.length === 0 ? 0 : hands.filter((h) => h.jevVpip).length / hands.length;
  const pfr = hands.length === 0 ? 0 : hands.filter((h) => h.jevPfr).length / hands.length;

  const showdownHands = hands.filter((h) => h.wentToShowdown);
  const showdownWins = showdownHands.filter((h) => h.jevWonShowdown === true).length;
  const showdownWinRate = showdownHands.length === 0 ? null : showdownWins / showdownHands.length;

  const jev: JevSummary = {
    bb100,
    ci95,
    n: groups.size,
    hands: hands.length,
    decisions,
    apiCalls,
    failOpen,
    latencyMs,
    vpip,
    pfr,
    showdownWinRate,
  };

  const seats = seatCount(format);
  const oppSeats = Math.max(seats - 1, 1);
  const oppBb100PerSeatXs = hands.map((h) => {
    const nonJevSum = h.net.reduce((acc, v, seat) => (seat === h.jevSeat ? acc : acc + v), 0);
    return (nonJevSum / oppSeats) * 100;
  });
  const bb100PerSeat = oppBb100PerSeatXs.length === 0 ? 0 : oppBb100PerSeatXs.reduce((a, b) => a + b, 0) / oppBb100PerSeatXs.length;
  const oppVpip = hands.length === 0 ? 0 : hands.reduce((acc, h) => acc + h.oppVpip, 0) / hands.length;
  const oppPfr = hands.length === 0 ? 0 : hands.reduce((acc, h) => acc + h.oppPfr, 0) / hands.length;

  const opponent: OpponentSummary = {
    bb100PerSeat,
    vpip: oppVpip,
    pfr: oppPfr,
  };

  return { jev, opponent };
}
