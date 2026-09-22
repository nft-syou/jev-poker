import type { JevBackend, OpponentType } from "@jev-poker/agent";
import {
  type Agent,
  type AgentDecision,
  createAgent,
  HeuristicAgent,
  JevAgent,
  type Persona,
  type PromptStyle,
  playHand as playOneHand,
} from "@jev-poker/agent";
import {
  fixedBlinds,
  type GameConfig,
  type GameEvent,
  hashSeed,
  historyEntry,
  type SeatId,
  Table,
} from "@jev-poker/engine";
import { getPersona } from "./backend";
import { HERO_PLAYER, kindOf, playersAt, rotations, seatCount } from "./matchups";
import { JevTypeLabeler, ProfileTracker } from "./profile";
import type { Format, HandAction, HandRecord, Opponent, ProfileMode } from "./types";

const SMALL_BLIND = 50;
const BIG_BLIND = 100;
const STARTING_STACK = 10_000;

/** Seed offset for the Jev seat, keeping its stream distinct from any baseline seat. */
const JEV_SEED_TAG = 99;

/**
 * How many Jev decisions are inspected before deciding a backend is broken.
 * If every one of them failed open, the matchup is aborted: a whole run of
 * fallback actions measures the fallback, not Jev, and still costs API calls.
 */
const FAIL_FAST_DECISIONS = 10;

export interface RunOptions {
  opponent: Opponent;
  format: Format;
  seeds: number;
  baseSeed: number;
  concurrency: number;
  persona: Persona;
  backend: JevBackend;
  /** Model id sent with every request; the backend's default when omitted. */
  model?: string;
  /** Passed to every `JevAgent`; default `unified`. */
  promptStyle?: PromptStyle;
  /** Feed the Jev agent per-opponent session statistics accumulated over the matchup. */
  profile?: boolean | ProfileMode;
  /** Remember only each opponent's most recent hands (a realistic session length); unlimited when absent. */
  profileWindow?: number;
  /** Give the hero a player's type only while that player is losing (`LOSING_PLAYER`). */
  profileLosingOnly?: boolean;
  /** Reports how many requests the `jev-label` mode spent on player types. */
  onLabelCalls?: (calls: number) => void;
  /** Called once at the end with the player types the hero was given (`label` and `jev-label`). */
  onPlayerTypes?: (types: Record<string, string[]>) => void;
  /** Opt-in range-aware equity feature for the Jev agent. */
  rangeEquity?: boolean;
  /** `chart`: the Jev agent uses the preflop chart in code and asks Jev only after the flop. */
  preflop?: "jev" | "chart";
  /** `heuristic` seats the fixed rule set over Jev's own features instead of the Jev agent. */
  hero?: "jev" | "heuristic";
  signal?: AbortSignal;
  onHand?: (done: number, total: number) => void;
  /** Called once per Jev decision, as the hand that produced it finishes. */
  onDecision?: (record: AgentDecision) => void;
  /** Test seam: replaces `playHand` for a single hand. Production callers leave this unset. */
  playHandImpl?: (args: PlayHandArgs) => Promise<HandRecord>;
}

export interface PlayHandArgs {
  seedIndex: number;
  rotation: number;
  opponent: Opponent;
  format: Format;
  baseSeed: number;
  persona: Persona;
  backend: JevBackend;
  model?: string;
  promptStyle?: PromptStyle;
  hero?: "jev" | "heuristic";
  preflop?: "jev" | "chart";
  rangeEquity?: boolean;
  /** Shared session memory; when present the Jev agent sees opponent statistics and the hand is recorded into it. */
  tracker?: ProfileTracker;
  /** How the tracker's memory reaches the Jev agent; `numbers` when absent. */
  profileMode?: ProfileMode;
  /** Player types as judged by Jev (`jev-label`). */
  labeler?: JevTypeLabeler;
  /** Types are given only for players the tracker says are losing. */
  profileLosingOnly?: boolean;
  /** Test seam: observes the table's events for this hand. Production callers leave this unset. */
  onEvent?: (event: GameEvent) => void;
}

/** A player of a mixed table: a baseline bot, the heuristic, or a Jev CPU with its own persona. */
function opponentAgent(kind: string, seed: number, args: PlayHandArgs): Agent {
  if (kind === "heuristic") return new HeuristicAgent();
  if (kind.startsWith("jev:")) {
    return new JevAgent({
      persona: getPersona(kind.slice("jev:".length)),
      backend: args.backend,
      seed,
      ...(args.model !== undefined ? { model: args.model } : {}),
    });
  }
  if (kind === "random" || kind === "caller" || kind === "rules") return createAgent(kind, seed);
  throw new Error(`unknown player kind: ${kind}`);
}

/**
 * Play one independent hand: a fresh `Table` is built per hand, so the deck
 * depends only on `(baseSeed, seedIndex)` and every rotation of the same
 * `seedIndex` sees the identical deal with Jev in a different seat.
 */
export async function playHand(args: PlayHandArgs): Promise<HandRecord> {
  const { seedIndex, rotation, opponent, format, baseSeed, persona, backend } = args;
  const n = seatCount(format);
  const jevSeat: SeatId = rotation;
  const players = playersAt(opponent, format, jevSeat);
  const playerAt = (seat: number): string => players[seat] ?? HERO_PLAYER;
  const profileMode = args.profileMode ?? "numbers";
  // With the gate, a player who is not losing (or has not lost for long enough) gets no type.
  const gated = (seat: number, type: OpponentType | null): OpponentType | null =>
    args.profileLosingOnly === true && args.tracker?.isLosing(playerAt(seat)) !== true
      ? null
      : type;

  const decisions: AgentDecision[] = [];
  const agents: Agent[] = [];
  for (let seat = 0; seat < n; seat++) {
    agents.push(
      seat === jevSeat
        ? args.hero === "heuristic"
          ? new HeuristicAgent()
          : new JevAgent({
              persona,
              backend,
              seed: hashSeed(baseSeed, seedIndex, rotation, JEV_SEED_TAG),
              onDecision: (record) => decisions.push(record),
              ...(args.model !== undefined ? { model: args.model } : {}),
              ...(args.promptStyle !== undefined ? { promptStyle: args.promptStyle } : {}),
              ...(args.preflop !== undefined ? { preflop: args.preflop } : {}),
              ...(args.rangeEquity !== undefined ? { rangeEquity: args.rangeEquity } : {}),
              ...(args.tracker !== undefined && profileMode === "numbers"
                ? {
                    opponentStatsFor: (s: number) =>
                      s === jevSeat ? null : (args.tracker?.statsFor(playerAt(s)) ?? null),
                  }
                : {}),
              ...(args.tracker !== undefined && profileMode === "label"
                ? {
                    opponentTypeFor: (s: number) =>
                      s === jevSeat ? null : gated(s, args.tracker?.typeFor(playerAt(s)) ?? null),
                  }
                : {}),
              ...(args.labeler !== undefined && profileMode === "jev-label"
                ? {
                    opponentTypeFor: (s: number) =>
                      s === jevSeat ? null : gated(s, args.labeler?.typeFor(playerAt(s)) ?? null),
                  }
                : {}),
            })
        : opponentAgent(kindOf(playerAt(seat)), hashSeed(baseSeed, seedIndex, seat), args),
    );
  }

  const config: GameConfig = {
    format: "cash",
    blinds: fixedBlinds(SMALL_BLIND, BIG_BLIND),
    startingStack: STARTING_STACK,
    seats: Array.from({ length: n }, (_, id) => ({
      id,
      name: `seat${id}`,
      kind: "cpu" as const,
    })),
    seed: hashSeed(baseSeed, seedIndex),
  };

  const table = new Table(config);
  const vpip = new Set<SeatId>();
  const pfr = new Set<SeatId>();
  const folded = new Set<SeatId>();
  const actions: HandAction[] = [];
  let wentToShowdown = false;
  function onTableEvent(e: GameEvent): void {
    args.onEvent?.(e);
    if (e.type === "Showdown") wentToShowdown = true;
    if (e.type === "ActionTaken" && e.street === "preflop") {
      const t = e.action.type;
      // Blind posts are not `ActionTaken`, so any call/bet/raise here is voluntary.
      if (t === "call" || t === "bet" || t === "raise") vpip.add(e.seat);
      if (t === "bet" || t === "raise") pfr.add(e.seat);
    }
    if (e.type === "ActionTaken" && e.action.type === "fold") folded.add(e.seat);
    if (e.type === "ActionTaken") {
      // Logged the way the agents see it: a bet or raise that is all in reads `allin`.
      const a = historyEntry(e).action;
      actions.push({
        street: e.street,
        seat: e.seat,
        type: a.type,
        ...(a.type === "bet" || a.type === "raise" ? { amountBB: a.amount / BIG_BLIND } : {}),
      });
    }
  }

  await playOneHand(table, agents, { onEvent: onTableEvent });

  // Read from the hand, not the table: a cash table rebuys busted seats as the hand ends.
  const net = new Array<number>(n).fill(0);
  for (const { id, stack } of table.currentHand?.stacks() ?? []) {
    net[id] = (stack - STARTING_STACK) / BIG_BLIND;
  }

  const jevAtShowdown = wentToShowdown && !folded.has(jevSeat);
  const oppSeats = net.map((_, seat) => seat).filter((seat) => seat !== jevSeat);
  const fraction = (set: Set<SeatId>): number =>
    oppSeats.length === 0 ? 0 : oppSeats.filter((seat) => set.has(seat)).length / oppSeats.length;

  return {
    seedIndex,
    rotation,
    jevSeat,
    players,
    net,
    wentToShowdown,
    // The table can show down after Jev folded; only Jev's own showdowns count for its win rate.
    jevAtShowdown,
    // "Won" means Jev finished the hand ahead: a chop or a lost side pot is not a win.
    jevWonShowdown: jevAtShowdown ? (net[jevSeat] ?? 0) > 0 : null,
    jevVpip: vpip.has(jevSeat),
    jevPfr: pfr.has(jevSeat),
    oppVpip: fraction(vpip),
    oppPfr: fraction(pfr),
    decisions,
    actions,
  };
  // (the tracker is updated by the caller once the record exists)
}

/**
 * Play `seeds × rotations(format)` independent hands with at most
 * `concurrency` in flight. Aborting stops new hands from starting; the ones
 * already running are awaited and the result is flagged `partial`.
 *
 * A hand that throws rejects the whole match with the original error, and stops
 * any further hands from being started. The same happens when the first
 * `FAIL_FAST_DECISIONS` Jev decisions all failed open: the backend is
 * systematically broken, so the match rejects instead of burning the budget.
 */
export async function runMatch(
  opts: RunOptions,
): Promise<{ hands: HandRecord[]; partial: boolean }> {
  const { opponent, format, seeds, baseSeed, persona, backend, signal, onHand, onDecision } = opts;
  const rotationCount = rotations(format);

  const jobs: { seedIndex: number; rotation: number }[] = [];
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    for (let rotation = 0; rotation < rotationCount; rotation++) jobs.push({ seedIndex, rotation });
  }

  const total = jobs.length;
  const hands: HandRecord[] = [];
  const play = opts.playHandImpl ?? playHand;
  const profileMode: ProfileMode | null =
    opts.profile === undefined || opts.profile === false
      ? null
      : opts.profile === true
        ? "numbers"
        : opts.profile;
  const tracker = profileMode === null ? undefined : new ProfileTracker(opts.profileWindow);
  const labeler =
    tracker !== undefined && profileMode === "jev-label"
      ? new JevTypeLabeler(tracker, backend, opts.model)
      : undefined;
  let nextJob = 0;
  let done = 0;
  // Set by the first worker whose hand throws, so the others stop claiming jobs
  // instead of burning API calls for a match that has already rejected.
  let failed = false;
  // The first `FAIL_FAST_DECISIONS` decisions, in hand-completion order.
  const firstDecisions: AgentDecision[] = [];
  let failFastChecked = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed || signal?.aborted === true) return;
      const index = nextJob++;
      const job = jobs[index];
      if (job === undefined) return;
      let record: HandRecord;
      try {
        record = await play({
          seedIndex: job.seedIndex,
          rotation: job.rotation,
          opponent,
          format,
          baseSeed,
          persona,
          backend,
          ...(opts.model !== undefined ? { model: opts.model } : {}),
          ...(opts.promptStyle !== undefined ? { promptStyle: opts.promptStyle } : {}),
          ...(opts.hero !== undefined ? { hero: opts.hero } : {}),
          ...(opts.preflop !== undefined ? { preflop: opts.preflop } : {}),
          ...(opts.rangeEquity !== undefined ? { rangeEquity: opts.rangeEquity } : {}),
          ...(tracker !== undefined ? { tracker } : {}),
          ...(profileMode !== null ? { profileMode } : {}),
          ...(labeler !== undefined ? { labeler } : {}),
          ...(opts.profileLosingOnly === true ? { profileLosingOnly: true } : {}),
        });
      } catch (err) {
        failed = true;
        throw err;
      }
      hands.push(record);
      if (tracker !== undefined && record.actions !== undefined) {
        const seats = new Map<number, string>();
        const players = record.players ?? playersAt(opponent, format, record.jevSeat);
        for (let s = 0; s < seatCount(format); s++)
          if (s !== record.jevSeat) seats.set(s, players[s] ?? opponent);
        tracker.record(record.actions, seats, record.net);
        if (labeler !== undefined) {
          await labeler.refresh();
          opts.onLabelCalls?.(labeler.calls);
        }
      }
      for (const decision of record.decisions) {
        onDecision?.(decision);
        if (!failFastChecked && firstDecisions.length < FAIL_FAST_DECISIONS)
          firstDecisions.push(decision);
      }
      if (!failFastChecked && firstDecisions.length >= FAIL_FAST_DECISIONS) {
        failFastChecked = true;
        if (firstDecisions.every((d) => d.error !== undefined)) {
          failed = true;
          throw new Error(
            `Jev backend failing on every decision (first ${FAIL_FAST_DECISIONS}): ${firstDecisions[0]?.error ?? ""}`,
          );
        }
      }
      done += 1;
      onHand?.(done, total);
    }
  };

  const workerCount = Math.max(1, Math.min(Math.trunc(opts.concurrency) || 1, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (tracker !== undefined && profileMode === "label") {
    opts.onPlayerTypes?.(
      Object.fromEntries(tracker.playerIds().map((id) => [id, [tracker.typeFor(id) ?? "unknown"]])),
    );
  }
  if (labeler !== undefined) opts.onPlayerTypes?.(labeler.history());

  hands.sort((a, b) => a.seedIndex - b.seedIndex || a.rotation - b.rotation);
  return { hands, partial: (signal?.aborted ?? false) && hands.length < total };
}
