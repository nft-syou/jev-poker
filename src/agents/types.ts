import type { Action, LegalActions } from "../engine/types";
import type { PlayerView } from "../engine/view";

/** Anything that can play a seat: a baseline bot, a heuristic, or the Jev CPU. */
export interface Agent {
  readonly id: string;
  decide(view: PlayerView, legal: LegalActions): Promise<Action>;
}

export type BaselineId = "random" | "caller" | "rules";
