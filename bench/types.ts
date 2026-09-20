import type { DecisionRecord } from '../src/jev/agent.js';
import type { SeatId } from '../src/engine/types.js';

export type Opponent = 'random' | 'caller' | 'rules';
export type Format = 'hu' | '6max';

export interface HandRecord {
  seedIndex: number;
  rotation: number;
  jevSeat: SeatId;
  /** net result in bb, indexed by seat */
  net: number[];
  /** The table reached a showdown — possibly after Jev had folded. */
  wentToShowdown: boolean;
  /** Jev itself was still in the hand at the showdown. Absent in older result files. */
  jevAtShowdown?: boolean;
  jevWonShowdown: boolean | null;
  jevVpip: boolean;
  jevPfr: boolean;
  oppVpip: number;
  oppPfr: number;
  decisions: DecisionRecord[];
}

export interface JevSummary {
  bb100: number;
  /** `null` when fewer than two complete seed groups exist (no spread to estimate). */
  ci95: [number, number] | null;
  /** Complete seed groups (Jev played every rotation); only these enter bb/100 and the CI. */
  n: number;
  /** Seed groups left unfinished by a partial run; excluded from the estimate. */
  incompleteGroups: number;
  hands: number;
  decisions: number;
  apiCalls: number;
  failOpen: number;
  latencyMs: { mean: number; p50: number; p95: number };
  vpip: number;
  pfr: number;
  /** Hands in which Jev itself reached the showdown (it had not folded). */
  showdowns: number;
  /** Share of those hands Jev finished ahead in (net > 0); `null` when there were none. */
  showdownWinRate: number | null;
}

export interface OpponentSummary {
  bb100PerSeat: number;
  vpip: number;
  pfr: number;
}

export interface BenchConfig {
  opponent: Opponent;
  format: Format;
  seeds: number;
  persona: string;
  backend: 'typesafe' | 'mock';
  model: string | null;
  baseSeed: number;
  concurrency: number;
  sdkVersion: string;
  gitCommit: string | null;
  /** Absent in results written before the split-format experiment (= `unified`). */
  promptStyle?: 'unified' | 'split';
}

export interface BenchResult {
  version: 1;
  startedAt: string;
  finishedAt: string;
  partial: boolean;
  config: BenchConfig;
  summary: { jev: JevSummary; opponent: OpponentSummary };
  hands: HandRecord[];
}
