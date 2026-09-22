import {
  classifyByThresholds,
  classifyWithJev,
  type JevBackend,
  MIN_HANDS_FOR_TYPE,
  type OpponentStats,
  type OpponentType,
} from "@jev-poker/agent";
import type { HandAction } from "./types";

interface Tally {
  hands: number;
  vpip: number;
  pfr: number;
  postflopActions: number;
  postflopAggressive: number;
  /** Postflop actions that answer a bet: a fold, a call or a raise. */
  facedBet: number;
  foldedToBet: number;
  /** Chips won or lost, in big blinds. */
  netBB: number;
}

/**
 * When to treat a player's tendencies as worth exploiting: only once the player has lost this
 * much over at least this many hands. Chosen offline before the run (bench/EXPERIMENTS.md, exp10):
 * the bots that lose 400-500 bb/100 pass it almost always, Jev personas almost never.
 */
export const LOSING_PLAYER = { minHands: 100, maxBB100: -150 } as const;

function emptyTally(): Tally {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    postflopActions: 0,
    postflopAggressive: 0,
    facedBet: 0,
    foldedToBet: 0,
    netBB: 0,
  };
}

function addTally(into: Tally, hand: Tally, sign: 1 | -1): void {
  into.hands += sign * hand.hands;
  into.vpip += sign * hand.vpip;
  into.pfr += sign * hand.pfr;
  into.postflopActions += sign * hand.postflopActions;
  into.postflopAggressive += sign * hand.postflopAggressive;
  into.facedBet += sign * hand.facedBet;
  into.foldedToBet += sign * hand.foldedToBet;
  into.netBB += sign * hand.netBB;
}

/**
 * Session memory for the benchmark: how each player at the table has played so far in this
 * matchup. Keyed by player id, not by seat, because Jev rotates through the seats while the
 * players around it keep their identity.
 *
 * Hands finish out of order under concurrency, so what a decision sees is "the hands that
 * had finished by then" — an honest stand-in for a player's memory of a live session.
 */
export class ProfileTracker {
  private readonly tallies = new Map<string, Tally>();
  /** Per-hand tallies of each player, oldest first; kept only when a window is set. */
  private readonly recent = new Map<string, Tally[]>();
  private readonly seen = new Map<string, number>();

  /**
   * `windowHands`: remember only each player's most recent hands, like a player who has sat at
   * the table for that long. Unlimited when omitted.
   */
  constructor(private readonly windowHands?: number) {}

  /**
   * Fold one finished hand into the tallies; `players` maps each opponent's seat to its player
   * id, `net` is every seat's result in big blinds (omitted by callers that do not track money).
   */
  record(
    actions: readonly HandAction[],
    players: ReadonlyMap<number, string>,
    net?: readonly number[],
  ): void {
    for (const [seat, playerId] of players) {
      const mine = actions.filter((a) => a.seat === seat);
      const pre = mine.filter((a) => a.street === "preflop");
      const post = mine.filter((a) => a.street !== "preflop");
      const aggressive = (t: HandAction["type"]) => t === "bet" || t === "raise" || t === "allin";
      // A check or a bet means nothing was due; an all-in is ambiguous and is left out.
      const answered = post.filter(
        (a) => a.type === "fold" || a.type === "call" || a.type === "raise",
      );
      const hand: Tally = {
        hands: 1,
        vpip: pre.some((a) => a.type === "call" || aggressive(a.type)) ? 1 : 0,
        pfr: pre.some((a) => aggressive(a.type)) ? 1 : 0,
        postflopActions: post.length,
        postflopAggressive: post.filter((a) => aggressive(a.type)).length,
        facedBet: answered.length,
        foldedToBet: answered.filter((a) => a.type === "fold").length,
        netBB: net?.[seat] ?? 0,
      };
      this.seen.set(playerId, (this.seen.get(playerId) ?? 0) + 1);
      const t = this.tallies.get(playerId) ?? emptyTally();
      addTally(t, hand, 1);
      if (this.windowHands !== undefined) {
        const queue = this.recent.get(playerId) ?? [];
        queue.push(hand);
        while (queue.length > this.windowHands) addTally(t, queue.shift() as Tally, -1);
        this.recent.set(playerId, queue);
      }
      this.tallies.set(playerId, t);
    }
  }

  playerIds(): string[] {
    return [...this.tallies.keys()];
  }

  /** Hands of this player recorded since the start, whatever the window still remembers. */
  handsSeen(playerId: string): number {
    return this.seen.get(playerId) ?? 0;
  }

  /** `null` until a few hands have been seen: a percentage over three hands is noise. */
  statsFor(playerId: string, minHands = MIN_HANDS_FOR_TYPE): OpponentStats | null {
    const t = this.tallies.get(playerId);
    if (t === undefined || t.hands < minHands) return null;
    return {
      hands: t.hands,
      vpipPct: Math.round((100 * t.vpip) / t.hands),
      pfrPct: Math.round((100 * t.pfr) / t.hands),
      postflopAggressionPct:
        t.postflopActions === 0 ? 0 : Math.round((100 * t.postflopAggressive) / t.postflopActions),
      ...(t.facedBet === 0 ? {} : { foldToBetPct: Math.round((100 * t.foldedToBet) / t.facedBet) }),
    };
  }

  /** The player's result so far in bb/100, or `null` before `minHands`. */
  resultBB100(playerId: string, minHands = 1): number | null {
    const t = this.tallies.get(playerId);
    if (t === undefined || t.hands < minHands) return null;
    return (100 * t.netBB) / t.hands;
  }

  /** True once the player has lost enough, for long enough, to be worth adjusting to. */
  isLosing(playerId: string): boolean {
    const result = this.resultBB100(playerId, LOSING_PLAYER.minHands);
    return result !== null && result <= LOSING_PLAYER.maxBB100;
  }

  /** The player's type by fixed thresholds over the statistics so far. */
  typeFor(playerId: string): OpponentType | null {
    const stats = this.statsFor(playerId);
    return stats === null ? null : classifyByThresholds(stats);
  }
}

/** How many more hands of a player must be seen before Jev is asked about that player again. */
const RELABEL_EVERY = 25;

/**
 * Player types as judged by Jev from the tracker's statistics. A decision reads the latest
 * label synchronously; `refresh` is called between hands and asks again only for players whose
 * sample has grown by `RELABEL_EVERY` hands, so the extra calls stay a small share of the run.
 */
export class JevTypeLabeler {
  private readonly labels = new Map<string, { type: OpponentType | null; hands: number }>();
  private readonly pending = new Set<string>();
  private readonly given = new Map<string, OpponentType[]>();
  /** Classification requests made so far (for the run's bookkeeping). */
  calls = 0;

  constructor(
    private readonly tracker: ProfileTracker,
    private readonly backend: JevBackend,
    private readonly model?: string,
  ) {}

  typeFor(playerId: string): OpponentType | null {
    return this.labels.get(playerId)?.type ?? null;
  }

  /** Every label given so far, in order, per player: shows whether Jev's judgement was stable. */
  history(): Record<string, OpponentType[]> {
    return Object.fromEntries([...this.given].map(([id, types]) => [id, [...types]]));
  }

  async refresh(): Promise<void> {
    const due = this.tracker.playerIds().filter((id) => {
      if (this.pending.has(id)) return false;
      const stats = this.tracker.statsFor(id);
      if (stats === null) return false;
      const known = this.labels.get(id);
      return known === undefined || this.tracker.handsSeen(id) - known.hands >= RELABEL_EVERY;
    });
    await Promise.all(
      due.map(async (id) => {
        const stats = this.tracker.statsFor(id);
        if (stats === null) return;
        this.pending.add(id);
        // The label describes the sample as it was when Jev was asked, not when it answered.
        const seenWhenAsked = this.tracker.handsSeen(id);
        try {
          this.calls += 1;
          const type = await classifyWithJev(
            this.backend,
            stats,
            this.model === undefined ? {} : { model: this.model },
          );
          // A failed request keeps the previous label; it is asked again only after another
          // `RELABEL_EVERY` hands, so a broken backend is not hammered once per hand.
          const previous = this.labels.get(id)?.type ?? null;
          this.labels.set(id, { type: type ?? previous, hands: seenWhenAsked });
          if (type !== null) this.given.set(id, [...(this.given.get(id) ?? []), type]);
        } finally {
          this.pending.delete(id);
        }
      }),
    );
  }
}
