import type { Speed } from "./storage";

/**
 * How long each piece of the table's presentation stays up, in milliseconds. Every overlay
 * reads its window from here so that a change of speed moves all of them together: at max
 * speed the engine fires decisions faster than a 2.5 s bubble can clear, and overlays that
 * kept their own constants would queue up on top of each other.
 */
export interface PresentationTimings {
  /** Floor on the "thinking" line, so a sub-frame answer is still seen. */
  thinkingHoldMs: number;
  /** How long a decision bubble stays after the seat has acted. */
  decisionHoldMs: number;
  /** How long the big FOLD / CALL / RAISE label flashes at a seat. */
  calloutMs: number;
  /** Travel time of a chip sliding between a seat, its bet spot and the pot. */
  chipMoveMs: number;
  /** How long the pot number takes to roll to its new value. */
  potCountMs: number;
  /** How long a winning seat keeps its glow. */
  winnerGlowMs: number;
  /** Duration of a hole-card flip at showdown and of a board card popping in. */
  cardFlipMs: number;
}

/**
 * The table by speed. The numbers are tuned so that nothing overlaps at the speed it belongs
 * to: at every speed the longest overlay (the decision bubble) still clears before the next
 * decision can land, and the chip moves finish well inside their callout.
 */
const TIMINGS: Record<Speed, PresentationTimings> = {
  slow: {
    thinkingHoldMs: 600,
    decisionHoldMs: 2500,
    calloutMs: 900,
    chipMoveMs: 450,
    potCountMs: 600,
    winnerGlowMs: 1200,
    cardFlipMs: 400,
  },
  normal: {
    thinkingHoldMs: 600,
    decisionHoldMs: 2500,
    calloutMs: 900,
    chipMoveMs: 450,
    potCountMs: 600,
    winnerGlowMs: 1200,
    cardFlipMs: 400,
  },
  fast: {
    thinkingHoldMs: 300,
    decisionHoldMs: 1400,
    calloutMs: 600,
    chipMoveMs: 300,
    potCountMs: 400,
    winnerGlowMs: 800,
    cardFlipMs: 300,
  },
  max: {
    thinkingHoldMs: 120,
    decisionHoldMs: 650,
    calloutMs: 380,
    chipMoveMs: 180,
    potCountMs: 220,
    winnerGlowMs: 450,
    cardFlipMs: 180,
  },
};

/** The presentation windows for a table running at `speed`. */
export function presentationTimings(speed: Speed): PresentationTimings {
  return TIMINGS[speed] ?? TIMINGS.normal;
}
