import type { Action, LegalActions, PlayerView } from "@jev-poker/engine";

/** Anything that can play a seat: a baseline bot, a heuristic, or the Jev CPU. */
export interface Agent {
  readonly id: string;
  decide(view: PlayerView, legal: LegalActions): Promise<Action>;
}

export type BaselineId = "random" | "caller" | "rules";
