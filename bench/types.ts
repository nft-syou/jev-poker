import type { AgentDecision } from "../src/agents";
import type { Action, SeatId, Street } from "../src/engine";

/** One kind of bot in every other seat, or a table of different players (six-handed only). */
export type Opponent = "random" | "caller" | "rules" | "mixed" | "mixed-jev";
/** How the opponents' session tendencies reach the Jev agent. */
export type ProfileMode = "numbers" | "label" | "jev-label";
export type Format = "hu" | "6max";

export interface HandRecord {
  seedIndex: number;
  rotation: number;
  jevSeat: SeatId;
  /** Player id per seat (`hero` for the measured seat). Absent in older result files. */
  players?: string[];
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
  decisions: AgentDecision[];
  /** Every seat's actions in order (amounts in bb). Absent in older result files. */
  actions?: HandAction[];
}

export interface HandAction {
  street: Street;
  seat: SeatId;
  type: Action["type"];
  /** Raise-to / bet total in bb, for bets and raises. */
  amountBB?: number;
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
  backend: "typesafe" | "mock";
  /** How Jev was reached; absent = TypeSafe's own API. */
  route?: "typesafe" | "lolipop";
  model: string | null;
  baseSeed: number;
  concurrency: number;
  sdkVersion: string;
  gitCommit: string | null;
  /** Absent in results written before the split-format experiment (= `unified`). */
  promptStyle?: "unified" | "split";
  /** Opponent session tendencies were fed to the Jev agent; `true` in older files means `numbers`. */
  profile?: boolean | ProfileMode;
  /** Opponents' hands remembered by the session memory; absent = the whole matchup. */
  profileWindow?: number;
  /** Player types were given only while the player was losing (`LOSING_PLAYER`). */
  profileLosingOnly?: boolean;
  /** Requests spent on asking Jev for player types (`jev-label` only). */
  profileLabelCalls?: number;
  /** Player types the hero was given: the final one for `label`, every one in order for `jev-label`. */
  profilePlayerTypes?: Record<string, string[]>;
  /** The opt-in range-aware equity feature was on. */
  rangeEquity?: boolean;
  /** `chart`: the Jev agent takes its preflop decisions from the chart in code. */
  preflop?: "jev" | "chart";
  /** Who sits in the measured seat: the Jev agent (default) or the fixed heuristic over the same features. */
  hero?: "jev" | "heuristic";
  /** Persona variance override (`--variance`); absent = the persona's own value. */
  variance?: number;
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
