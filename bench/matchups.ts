import type { Format, Opponent } from "./types";

const OPPONENTS: readonly Opponent[] = ["random", "caller", "rules"];
const FORMATS: readonly Format[] = ["hu", "6max"];

/** Number of seats at the table for a given format. */
export function seatCount(format: Format): number {
  return format === "hu" ? 2 : 6;
}

/**
 * How many seat rotations make one full cycle: Jev occupies every seat exactly
 * once, so each deck is played from every position.
 */
export function rotations(format: Format): number {
  return seatCount(format);
}

/**
 * Expand a possibly-wildcard matchup selection into concrete pairs, in
 * opponent-major order (`random × hu, random × 6max, caller × hu, ...`).
 */
export function expandMatchups(
  opponent: Opponent | "all",
  format: Format | "all",
): { opponent: Opponent; format: Format }[] {
  const opponents = opponent === "all" ? OPPONENTS : [opponent];
  const formats = format === "all" ? FORMATS : [format];
  const out: { opponent: Opponent; format: Format }[] = [];
  for (const o of opponents) for (const f of formats) out.push({ opponent: o, format: f });
  return out;
}
