import type { OpponentStats } from '../src/jev/compress.js';
import type { HandAction } from './types.js';

interface Tally {
  hands: number;
  vpip: number;
  pfr: number;
  postflopActions: number;
  postflopAggressive: number;
}

/**
 * Session memory for the benchmark: how each kind of opponent has played so far in this
 * matchup. Keyed by agent id, not by seat, because Jev rotates through the seats while the
 * opponents around it stay the same kind of player.
 *
 * Hands finish out of order under concurrency, so what a decision sees is "the hands that
 * had finished by then" — an honest stand-in for a player's memory of a live session.
 */
export class ProfileTracker {
  private readonly tallies = new Map<string, Tally>();

  /** Fold one finished hand into the tallies. `agentIdOfSeat` lists every seat, Jev's included (it is skipped by the caller's choice of seats). */
  record(actions: readonly HandAction[], opponentSeats: ReadonlyMap<number, string>): void {
    for (const [seat, agentId] of opponentSeats) {
      const mine = actions.filter((a) => a.seat === seat);
      const pre = mine.filter((a) => a.street === 'preflop');
      const post = mine.filter((a) => a.street !== 'preflop');
      const aggressive = (t: HandAction['type']) => t === 'bet' || t === 'raise' || t === 'allin';
      const t = this.tallies.get(agentId) ?? { hands: 0, vpip: 0, pfr: 0, postflopActions: 0, postflopAggressive: 0 };
      t.hands += 1;
      if (pre.some((a) => a.type === 'call' || aggressive(a.type))) t.vpip += 1;
      if (pre.some((a) => aggressive(a.type))) t.pfr += 1;
      t.postflopActions += post.length;
      t.postflopAggressive += post.filter((a) => aggressive(a.type)).length;
      this.tallies.set(agentId, t);
    }
  }

  /** `null` until a few hands have been seen: a percentage over three hands is noise. */
  statsFor(agentId: string, minHands = 20): OpponentStats | null {
    const t = this.tallies.get(agentId);
    if (t === undefined || t.hands < minHands) return null;
    return {
      hands: t.hands,
      vpipPct: Math.round((100 * t.vpip) / t.hands),
      pfrPct: Math.round((100 * t.pfr) / t.hands),
      postflopAggressionPct: t.postflopActions === 0 ? 0 : Math.round((100 * t.postflopAggressive) / t.postflopActions),
    };
  }
}
