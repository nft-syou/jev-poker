import { createAgent } from '../src/agents/index.js';
import type { Agent } from '../src/agents/types.js';
import { hashSeed } from '../src/engine/rng.js';
import { Table } from '../src/engine/table.js';
import { fixedBlinds, type GameConfig, type SeatId, type TableEvent } from '../src/engine/types.js';
import { JevAgent, type DecisionRecord } from '../src/jev/agent.js';
import { HeuristicAgent } from '../src/jev/heuristic-agent.js';
import type { JevBackend } from '../src/jev/backend.js';
import type { Persona } from '../src/jev/personas.js';
import type { PromptStyle } from '../src/jev/questions.js';
import { rotations, seatCount } from './matchups.js';
import type { Format, HandAction, HandRecord, Opponent } from './types.js';

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
  /** Passed to every `JevAgent`; default `unified`. */
  promptStyle?: PromptStyle;
  /** Opt-in range-aware equity feature for the Jev agent. */
  rangeEquity?: boolean;
  /** `chart`: the Jev agent uses the preflop chart in code and asks Jev only after the flop. */
  preflop?: 'jev' | 'chart';
  /** `heuristic` seats the fixed rule set over Jev's own features instead of the Jev agent. */
  hero?: 'jev' | 'heuristic';
  signal?: AbortSignal;
  onHand?: (done: number, total: number) => void;
  /** Called once per Jev decision, as the hand that produced it finishes. */
  onDecision?: (record: DecisionRecord) => void;
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
  promptStyle?: PromptStyle;
  hero?: 'jev' | 'heuristic';
  preflop?: 'jev' | 'chart';
  rangeEquity?: boolean;
  /** Test seam: observes the table's events for this hand. Production callers leave this unset. */
  onEvent?: (event: TableEvent) => void;
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

  const decisions: DecisionRecord[] = [];
  const agents: Agent[] = [];
  for (let seat = 0; seat < n; seat++) {
    agents.push(
      seat === jevSeat
        ? args.hero === 'heuristic'
          ? new HeuristicAgent()
          : new JevAgent({
            persona,
            backend,
            seed: hashSeed(baseSeed, seedIndex, rotation, JEV_SEED_TAG),
            onDecision: (record) => decisions.push(record),
            ...(args.promptStyle !== undefined ? { promptStyle: args.promptStyle } : {}),
            ...(args.preflop !== undefined ? { preflop: args.preflop } : {}),
            ...(args.rangeEquity !== undefined ? { rangeEquity: args.rangeEquity } : {}),
          })
        : createAgent(opponent, hashSeed(baseSeed, seedIndex, seat)),
    );
  }

  const config: GameConfig = {
    format: 'cash',
    blinds: fixedBlinds({ small: SMALL_BLIND, big: BIG_BLIND, ante: 0 }),
    startingStack: STARTING_STACK,
    seats: Array.from({ length: n }, (_, id) => ({
      id,
      name: `seat${id}`,
      kind: 'cpu' as const,
      agentId: agents[id]?.id ?? opponent,
    })),
    seed: hashSeed(baseSeed, seedIndex),
  };

  const table = new Table(config);
  const vpip = new Set<SeatId>();
  const pfr = new Set<SeatId>();
  const folded = new Set<SeatId>();
  const actions: HandAction[] = [];
  const unsubscribe = table.on((e: TableEvent) => {
    args.onEvent?.(e);
    if (e.type === 'ActionTaken' && e.street === 'preflop') {
      const t = e.action.type;
      // Blind posts are not `ActionTaken`, so any call/bet/raise/allin here is voluntary.
      if (t === 'call' || t === 'bet' || t === 'raise' || t === 'allin') vpip.add(e.seat);
      if (t === 'bet' || t === 'raise' || t === 'allin') pfr.add(e.seat);
    }
    if (e.type === 'ActionTaken' && e.action.type === 'fold') folded.add(e.seat);
    if (e.type === 'ActionTaken') {
      const a = e.action;
      actions.push({
        street: e.street,
        seat: e.seat,
        type: a.type,
        ...(a.type === 'bet' || a.type === 'raise' ? { amountBB: a.amount / BIG_BLIND } : {}),
      });
    }
  });

  try {
    const hand = table.startHand();
    while (!hand.isOver) {
      const s = hand.toAct;
      if (s === null) throw new Error('hand is not over but no seat is to act');
      const agent = agents[s];
      if (agent === undefined) throw new Error(`no agent for seat ${s}`);
      const action = await agent.decide(table.view(s), hand.legalActions(s));
      hand.act(s, action);
    }

    const net = new Array<number>(n).fill(0);
    for (const { seat, stack } of hand.finalStacks()) {
      net[seat] = (stack - STARTING_STACK) / BIG_BLIND;
    }

    const jevAtShowdown = hand.wentToShowdown && !folded.has(jevSeat);
    const oppSeats = net.map((_, seat) => seat).filter((seat) => seat !== jevSeat);
    const fraction = (set: Set<SeatId>): number =>
      oppSeats.length === 0 ? 0 : oppSeats.filter((seat) => set.has(seat)).length / oppSeats.length;

    return {
      seedIndex,
      rotation,
      jevSeat,
      net,
      wentToShowdown: hand.wentToShowdown,
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
  } finally {
    unsubscribe();
  }
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
export async function runMatch(opts: RunOptions): Promise<{ hands: HandRecord[]; partial: boolean }> {
  const { opponent, format, seeds, baseSeed, persona, backend, signal, onHand, onDecision } = opts;
  const rotationCount = rotations(format);

  const jobs: { seedIndex: number; rotation: number }[] = [];
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    for (let rotation = 0; rotation < rotationCount; rotation++) jobs.push({ seedIndex, rotation });
  }

  const total = jobs.length;
  const hands: HandRecord[] = [];
  const play = opts.playHandImpl ?? playHand;
  let nextJob = 0;
  let done = 0;
  // Set by the first worker whose hand throws, so the others stop claiming jobs
  // instead of burning API calls for a match that has already rejected.
  let failed = false;
  // The first `FAIL_FAST_DECISIONS` decisions, in hand-completion order.
  const firstDecisions: DecisionRecord[] = [];
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
          ...(opts.promptStyle !== undefined ? { promptStyle: opts.promptStyle } : {}),
          ...(opts.hero !== undefined ? { hero: opts.hero } : {}),
          ...(opts.preflop !== undefined ? { preflop: opts.preflop } : {}),
          ...(opts.rangeEquity !== undefined ? { rangeEquity: opts.rangeEquity } : {}),
        });
      } catch (err) {
        failed = true;
        throw err;
      }
      hands.push(record);
      for (const decision of record.decisions) {
        onDecision?.(decision);
        if (!failFastChecked && firstDecisions.length < FAIL_FAST_DECISIONS) firstDecisions.push(decision);
      }
      if (!failFastChecked && firstDecisions.length >= FAIL_FAST_DECISIONS) {
        failFastChecked = true;
        if (firstDecisions.every((d) => d.error !== undefined)) {
          failed = true;
          throw new Error(
            `Jev backend failing on every decision (first ${FAIL_FAST_DECISIONS}): ${firstDecisions[0]?.error ?? ''}`,
          );
        }
      }
      done += 1;
      onHand?.(done, total);
    }
  };

  const workerCount = Math.max(1, Math.min(Math.trunc(opts.concurrency) || 1, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  hands.sort((a, b) => a.seedIndex - b.seedIndex || a.rotation - b.rotation);
  return { hands, partial: (signal?.aborted ?? false) && hands.length < total };
}
