import type { Format, Opponent } from "./types";

/** The single-kind opponents that `all` expands to; the mixed tables are asked for by name. */
const OPPONENTS: readonly Opponent[] = ["random", "caller", "rules"];

/**
 * The five players around the measured seat at a mixed table, in seat order. A kind is a
 * baseline bot, `heuristic`, or `jev:<persona>` for a Jev CPU with that persona.
 */
export const MIXED_LINEUPS: Record<"mixed" | "mixed-jev", readonly string[]> = {
  mixed: ["rules", "caller", "random", "heuristic", "rules"],
  "mixed-jev": ["jev:rock", "jev:lag", "jev:maniac", "jev:station", "jev:tag"],
};

export const HERO_PLAYER = "hero";

export function isMixed(opponent: Opponent): opponent is "mixed" | "mixed-jev" {
  return opponent === "mixed" || opponent === "mixed-jev";
}

/**
 * Who sits where: a player id per seat. At a mixed table every player has its own id
 * (`kind@index`), so the session memory tells two `rules` players apart. With one kind of
 * bot everywhere the id is the kind itself: they are the same player, and pooling them is what
 * the earlier `--profile` runs did.
 */
export function playersAt(opponent: Opponent, format: Format, jevSeat: number): string[] {
  const n = seatCount(format);
  if (!isMixed(opponent)) {
    return Array.from({ length: n }, (_, seat) => (seat === jevSeat ? HERO_PLAYER : opponent));
  }
  const lineup = MIXED_LINEUPS[opponent];
  if (lineup.length !== n - 1) throw new Error(`${opponent} is a ${lineup.length + 1}-seat table`);
  const players: string[] = [];
  let next = 0;
  for (let seat = 0; seat < n; seat++) {
    if (seat === jevSeat) players.push(HERO_PLAYER);
    else {
      players.push(`${lineup[next] as string}@${next}`);
      next += 1;
    }
  }
  return players;
}

/** `rules@4` → `rules`. */
export function kindOf(playerId: string): string {
  const at = playerId.lastIndexOf("@");
  return at === -1 ? playerId : playerId.slice(0, at);
}
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
  if (opponent !== "all" && isMixed(opponent)) {
    if (format === "hu") throw new Error(`${opponent} is a six-handed table: use --format 6max`);
    return [{ opponent, format: "6max" }];
  }
  const formats = format === "all" ? FORMATS : [format];
  const out: { opponent: Opponent; format: Format }[] = [];
  for (const o of opponents) for (const f of formats) out.push({ opponent: o, format: f });
  return out;
}
