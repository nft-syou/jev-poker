import type { BlindSchedule, Blinds } from "./types.js";

/** Cash-game schedule: blinds never change. */
export function fixedBlinds(small: number, big: number, ante = 0): BlindSchedule {
  if (!Number.isInteger(big) || big <= 0) throw new Error("big blind must be a positive integer");
  if (!Number.isInteger(small) || small <= 0 || small > big) {
    throw new Error("small blind must be a positive integer no larger than the big blind");
  }
  if (!Number.isInteger(ante) || ante < 0) throw new Error("ante must be a non-negative integer");
  const blinds: Blinds = { small, big, ante };
  return { blindsFor: () => blinds };
}
