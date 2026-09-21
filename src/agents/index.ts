import { CallerAgent } from "./caller";
import { RandomAgent } from "./random";
import { RulesAgent } from "./rules";
import type { Agent, BaselineId } from "./types";

export { CallerAgent } from "./caller";
export { RandomAgent } from "./random";
export { RulesAgent } from "./rules";
export type { Agent, BaselineId } from "./types";

export function createAgent(id: BaselineId, seed: number): Agent {
  switch (id) {
    case "random":
      return new RandomAgent(seed);
    case "caller":
      return new CallerAgent();
    case "rules":
      // Deterministic: the rules agent draws no random numbers, so it takes no seed.
      return new RulesAgent();
  }
}
export { chartPreflop, HeuristicAgent } from "./heuristic";
export { type AgentDecision, JevAgent, type JevAgentOptions } from "./jev";
