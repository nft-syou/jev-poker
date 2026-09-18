import { createAgent } from '../src/agents/index.js';
import type { Agent } from '../src/agents/types.js';
import { hashSeed } from '../src/engine/rng.js';
import { Table } from '../src/engine/table.js';
import { fixedBlinds, type GameConfig, type SeatId, type TableEvent } from '../src/engine/types.js';
import { JevAgent, type DecisionRecord } from '../src/jev/agent.js';
import type { JevBackend } from '../src/jev/backend.js';
import type { Persona } from '../src/jev/personas.js';
import { rotations, seatCount } from './matchups.js';
import type { Format, HandRecord, Opponent } from './types.js';

const SMALL_BLIND = 50;
const BIG_BLIND = 100;
const STARTING_STACK = 10_000;

/** Seed offset for the Jev seat, keeping its stream distinct from any baseline seat. */
const JEV_SEED_TAG = 99;

export interface RunOptions {
  opponent: Opponent;
  format: Format;
  seeds: number;
  baseSeed: number;
  concurrency: number;
  persona: Persona;
  backend: JevBackend;
  signal?: AbortSignal;
  onHand?: (done: number, total: number) => void;
}

export interface PlayHandArgs {
  seedIndex: number;
  rotation: number;
  opponent: Opponent;
  format: Format;
  baseSeed: number;
  persona: Persona;
  backend: JevBackend;
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
        ? new JevAgent({
            persona,
            backend,
            seed: hashSeed(baseSeed, seedIndex, rotation, JEV_SEED_TAG),
            onDecision: (record) => decisions.push(record),
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
  const potWinners = new Set<SeatId>();
  const unsubscribe = table.on((e: TableEvent) => {
    if (e.type === 'ActionTaken' && e.street === 'preflop') {
      const t = e.action.type;
      // Blind posts are not `ActionTaken`, so any call/bet/raise/allin here is voluntary.
      if (t === 'call' || t === 'bet' || t === 'raise' || t === 'allin') vpip.add(e.seat);
      if (t === 'bet' || t === 'raise' || t === 'allin') pfr.add(e.seat);
    } else if (e.type === 'PotAwarded') {
      potWinners.add(e.seat);
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

    const oppSeats = net.map((_, seat) => seat).filter((seat) => seat !== jevSeat);
    const fraction = (set: Set<SeatId>): number =>
      oppSeats.length === 0 ? 0 : oppSeats.filter((seat) => set.has(seat)).length / oppSeats.length;

    return {
      seedIndex,
      rotation,
      jevSeat,
      net,
      wentToShowdown: hand.wentToShowdown,
      jevWonShowdown: hand.wentToShowdown ? potWinners.has(jevSeat) : null,
      jevVpip: vpip.has(jevSeat),
      jevPfr: pfr.has(jevSeat),
      oppVpip: fraction(vpip),
      oppPfr: fraction(pfr),
      decisions,
    };
  } finally {
    unsubscribe();
  }
}

/**
 * Play `seeds × rotations(format)` independent hands with at most
 * `concurrency` in flight. Aborting stops new hands from starting; the ones
 * already running are awaited and the result is flagged `partial`.
 */
export async function runMatch(opts: RunOptions): Promise<{ hands: HandRecord[]; partial: boolean }> {
  const { opponent, format, seeds, baseSeed, persona, backend, signal, onHand } = opts;
  const rotationCount = rotations(format);

  const jobs: { seedIndex: number; rotation: number }[] = [];
  for (let seedIndex = 0; seedIndex < seeds; seedIndex++) {
    for (let rotation = 0; rotation < rotationCount; rotation++) jobs.push({ seedIndex, rotation });
  }

  const total = jobs.length;
  const hands: HandRecord[] = [];
  let nextJob = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted === true) return;
      const index = nextJob++;
      const job = jobs[index];
      if (job === undefined) return;
      const record = await playHand({
        seedIndex: job.seedIndex,
        rotation: job.rotation,
        opponent,
        format,
        baseSeed,
        persona,
        backend,
      });
      hands.push(record);
      done += 1;
      onHand?.(done, total);
    }
  };

  const workerCount = Math.max(1, Math.min(Math.trunc(opts.concurrency) || 1, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  hands.sort((a, b) => a.seedIndex - b.seedIndex || a.rotation - b.rotation);
  return { hands, partial: (signal?.aborted ?? false) && hands.length < total };
}
