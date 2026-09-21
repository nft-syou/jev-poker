/** The colour tiers a chip can be drawn in, from the smallest denomination upwards. */
export type ChipTier = "white" | "red" | "green" | "black" | "purple";

export interface Chip {
  readonly tier: ChipTier;
  /** What this chip is worth, in chips (not big blinds). */
  readonly value: number;
}

/**
 * Denominations as multiples of the big blind, largest first. Real card rooms colour chips
 * by value rather than by table stakes, so the tiers are pinned to the blind instead of to
 * an absolute number: a 25 BB chip is black whether the big blind is 2 or 200.
 */
export const CHIP_TIERS: readonly { readonly tier: ChipTier; readonly bb: number }[] = [
  { tier: "purple", bb: 100 },
  { tier: "black", bb: 25 },
  { tier: "green", bb: 5 },
  { tier: "red", bb: 1 },
  { tier: "white", bb: 0.5 },
];

/** How many discs a drawn stack may have. Past this the stack reads as a bar, not chips. */
export const MAX_STACK_CHIPS = 6;

/** Chip arithmetic on fractional denominations; keeps 0.5 BB from losing its last chip. */
const EPSILON = 1e-9;

/**
 * The chips a bet of `amount` is made of: largest denominations first, at most
 * `MAX_STACK_CHIPS` of them. The result is for drawing, not for accounting — once the cap is
 * reached the remainder is dropped, because the amount is always printed next to the stack
 * anyway. Any positive amount draws at least one chip.
 *
 * Invariant: the drawn chips never total more than `amount`. Below half a big blind there is
 * no denomination that divides, so that last chip is a *partial* one worth exactly what is
 * left rather than a full white — it is drawn the same, and it keeps the sum honest.
 */
export function chipBreakdown(amount: number, bigBlind: number): Chip[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const unit = bigBlind > 0 ? bigBlind : 1;
  const chips: Chip[] = [];
  let left = amount;
  for (const { tier, bb } of CHIP_TIERS) {
    const value = bb * unit;
    if (value <= 0) continue;
    while (left + EPSILON >= value && chips.length < MAX_STACK_CHIPS) {
      chips.push({ tier, value });
      left -= value;
    }
    if (chips.length >= MAX_STACK_CHIPS) break;
  }
  // Below half a big blind nothing divides; a token white chip worth the remainder shows.
  if (chips.length === 0) chips.push({ tier: "white", value: amount });
  return chips;
}
