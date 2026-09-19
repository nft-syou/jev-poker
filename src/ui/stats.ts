import type { GameEvent, SeatId } from "../engine/types";
import type { DecisionRecord } from "../jev/decide";

/** `persona:<id>` for a CPU seat, `human:<name>` for a human one. */
export type StatsKey = string;

export interface PlayerStats {
  handsPlayed: number;
  /** Hands in which the seat received at least one pot award. */
  handsWon: number;
  /** Hands with a voluntary preflop call, bet or raise (posted blinds do not count). */
  vpipHands: number;
  /** Hands with a preflop bet or raise. */
  pfrHands: number;
  /** Hands the seat reached a showdown in. */
  showdowns: number;
  /** Showdown hands the seat won a pot in. */
  showdownsWon: number;
  /** Hands the seat was all in during. */
  allIns: number;
  rebuys: number;
  /** Σ(stack at HandEnded − stack at HandStarted) − Σ rebuy amounts. */
  netChips: number;
  jevDecisions: number;
  jevFallbacks: number;
  /** Decisions Jev answered with `bet_or_raise`; the aggression the ticker reports. */
  jevRaises: number;
  /** Σ latency over every decision, prefetched or not: how long Jev takes to answer. */
  jevLatencyMs: number;
  /** Σ latency over the decisions the table actually waited for; a prefetched one cost 0. */
  jevWaitMs: number;
  /** Σ bluff intent (0..1) over the decisions Jev actually answered. */
  jevBluffSum: number;
}

export const EMPTY_STATS: PlayerStats = {
  handsPlayed: 0,
  handsWon: 0,
  vpipHands: 0,
  pfrHands: 0,
  showdowns: 0,
  showdownsWon: 0,
  allIns: 0,
  rebuys: 0,
  netChips: 0,
  jevDecisions: 0,
  jevFallbacks: 0,
  jevRaises: 0,
  jevLatencyMs: 0,
  jevWaitMs: 0,
  jevBluffSum: 0,
};

/** Field order for the field-wise arithmetic below; keep it in sync with `PlayerStats`. */
const FIELDS = Object.keys(EMPTY_STATS) as (keyof PlayerStats)[];

export function statsKeyFor(seat: {
  kind: "human" | "cpu";
  name: string;
  personaId?: string;
}): StatsKey {
  // Humans are told apart by name; CPUs share a line per persona, so "the LAG" accumulates
  // across seats and sessions no matter which chair it sat in.
  return seat.kind === "human" ? `human:${seat.name}` : `persona:${seat.personaId ?? "unknown"}`;
}

export function addStats(a: PlayerStats, b: PlayerStats): PlayerStats {
  const sum = { ...EMPTY_STATS };
  for (const field of FIELDS) sum[field] = a[field] + b[field];
  return sum;
}

/** Rounded percentage, or null when there is nothing to divide by. */
export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Accumulates one hand at a time. Feed it every engine event plus the CPU decision records,
 * then call `flush()` once `HandEnded` has been seen to get the per-seat deltas.
 */
export class HandStatsTracker {
  private deltas = new Map<SeatId, PlayerStats>();
  private startStacks = new Map<SeatId, number>();
  private endStacks = new Map<SeatId, number>();
  private rebought = new Map<SeatId, number>();
  private vpip = new Set<SeatId>();
  private pfr = new Set<SeatId>();
  private allIn = new Set<SeatId>();
  private won = new Set<SeatId>();
  private sawShowdown = false;

  onEvent(event: GameEvent): void {
    switch (event.type) {
      case "HandStarted": {
        // A new hand always starts clean, even if the previous one was never flushed.
        this.reset();
        for (const seat of event.seats) {
          this.startStacks.set(seat.id, seat.stack);
          this.statsFor(seat.id).handsPlayed = 1;
        }
        break;
      }
      case "ActionTaken": {
        const stats = this.statsFor(event.seat);
        if (event.street === "preflop") {
          const type = event.action.type;
          // Blinds arrive as `BlindsPosted`, so every preflop call here is voluntary.
          if (type === "call" || type === "bet" || type === "raise") this.vpip.add(event.seat);
          if (type === "bet" || type === "raise") this.pfr.add(event.seat);
        }
        if (event.allIn && !this.allIn.has(event.seat)) {
          this.allIn.add(event.seat);
          stats.allIns = 1;
        }
        break;
      }
      case "Showdown": {
        this.sawShowdown = true;
        for (const hand of event.hands) this.statsFor(hand.seat).showdowns = 1;
        break;
      }
      case "PotAwarded": {
        for (const award of event.awards) {
          if (award.amount > 0) this.won.add(award.seat);
        }
        break;
      }
      case "SeatRebought": {
        this.statsFor(event.seat).rebuys += 1;
        this.rebought.set(event.seat, (this.rebought.get(event.seat) ?? 0) + event.amount);
        break;
      }
      case "HandEnded": {
        for (const seat of event.stacks) this.endStacks.set(seat.id, seat.stack);
        break;
      }
      default:
        break;
    }
  }

  /** `prefetched` says the answer was already in hand, so the table waited no time for it. */
  onDecision(record: DecisionRecord, prefetched = false): void {
    const stats = this.statsFor(record.seat);
    stats.jevDecisions += 1;
    stats.jevLatencyMs += record.latencyMs;
    if (!prefetched) stats.jevWaitMs += record.latencyMs;
    if (record.fallback) stats.jevFallbacks += 1;
    // Only a real answer carries a bluff intent; the average divides by the non-fallbacks.
    else if (record.jev !== null) {
      stats.jevBluffSum += record.jev.bluffIntent;
      if (record.jev.chosen === "bet_or_raise") stats.jevRaises += 1;
    }
  }

  /** Per-seat deltas for the hand just finished; resets the accumulator. */
  flush(): Map<SeatId, PlayerStats> {
    const result = this.deltas;
    for (const [seat, stats] of result) {
      if (this.vpip.has(seat)) stats.vpipHands = 1;
      if (this.pfr.has(seat)) stats.pfrHands = 1;
      if (this.won.has(seat)) {
        stats.handsWon = 1;
        if (this.sawShowdown) stats.showdownsWon = 1;
      }
      const started = this.startStacks.get(seat);
      const ended = this.endStacks.get(seat);
      if (started !== undefined && ended !== undefined) {
        stats.netChips = ended - started - (this.rebought.get(seat) ?? 0);
      }
    }
    this.reset();
    return result;
  }

  private reset(): void {
    this.deltas = new Map();
    this.startStacks = new Map();
    this.endStacks = new Map();
    this.rebought = new Map();
    this.vpip = new Set();
    this.pfr = new Set();
    this.allIn = new Set();
    this.won = new Set();
    this.sawShowdown = false;
  }

  private statsFor(seat: SeatId): PlayerStats {
    let stats = this.deltas.get(seat);
    if (stats === undefined) {
      stats = { ...EMPTY_STATS };
      this.deltas.set(seat, stats);
    }
    return stats;
  }
}
