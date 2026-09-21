/** What the action bar knows about the spot when it offers the player a size. */
export interface SizingSpot {
  /** Everything contributed so far, this street's bets included. */
  pot: number;
  /** The bet to match on this street; 0 when nobody has bet. */
  currentBet: number;
  /** Chips the player still owes to call; 0 when checking is free. */
  callAmount: number;
  preflop: boolean;
  /** The legal "raise to" window. */
  min: number;
  max: number;
}

export type SizingPresetId =
  | "min"
  | "third"
  | "half"
  | "twoThirds"
  | "pot"
  | "x2_5"
  | "x3"
  | "x4"
  | "allin";

export interface SizingPreset {
  id: SizingPresetId;
  /** The "raise to" amount this button sets. */
  amount: number;
  /** False when the size falls outside the legal window; the button stays put, disabled. */
  available: boolean;
}

const POT_FRACTIONS: readonly (readonly [SizingPresetId, number])[] = [
  ["third", 1 / 3],
  ["half", 1 / 2],
  ["twoThirds", 2 / 3],
  ["pot", 1],
];

const OPEN_MULTIPLES: readonly (readonly [SizingPresetId, number])[] = [
  ["x2_5", 2.5],
  ["x3", 3],
  ["x4", 4],
];

/**
 * A pot-sized raise is "call, then bet the pot as it stands after the call", so a fraction
 * `f` raises to `currentBet + f * (pot + callAmount)`. With nobody betting that is plain
 * `f * pot`.
 */
export function potFractionTo(spot: SizingSpot, fraction: number): number {
  return spot.currentBet + Math.round(fraction * (spot.pot + spot.callAmount));
}

/** How big the raise is, as a share of the pot the raiser would be betting into. */
export function potShare(spot: SizingSpot, amount: number): number | null {
  const base = spot.pot + spot.callAmount;
  if (base <= 0) return null;
  return (amount - spot.currentBet) / base;
}

/**
 * The one-tap sizes. The set depends only on the street, never on what happens to be legal:
 * a button that moved or vanished between hands would be pressed by mistake, so a size that
 * does not fit the window is kept and disabled instead.
 *
 * Preflop the convention is a multiple of the bet being faced (the big blind when unopened);
 * after the flop it is a fraction of the pot.
 */
export function sizingPresets(spot: SizingSpot): SizingPreset[] {
  const byMultiple = spot.preflop && spot.currentBet > 0;
  const middle = byMultiple
    ? OPEN_MULTIPLES.map(([id, x]) => [id, Math.round(spot.currentBet * x)] as const)
    : POT_FRACTIONS.map(([id, f]) => [id, potFractionTo(spot, f)] as const);
  return [
    { id: "min", amount: spot.min, available: true },
    ...middle.map(([id, amount]) => ({
      id,
      amount,
      // The ends of the window have their own buttons; between them is what these are for.
      available: amount > spot.min && amount < spot.max,
    })),
    { id: "allin", amount: spot.max, available: true },
  ];
}
