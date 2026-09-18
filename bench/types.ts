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
  wentToShowdown: boolean;
  jevWonShowdown: boolean | null;
  jevVpip: boolean;
  jevPfr: boolean;
  oppVpip: number;
  oppPfr: number;
  decisions: DecisionRecord[];
}

export interface JevSummary {
  bb100: number;
  ci95: [number, number];
  n: number;
  hands: number;
  decisions: number;
  apiCalls: number;
  failOpen: number;
  latencyMs: { mean: number; p50: number; p95: number };
  vpip: number;
  pfr: number;
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
