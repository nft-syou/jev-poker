import { CallerAgent } from "./caller.js";
import { RandomAgent } from "./random.js";
import { RulesAgent } from "./rules.js";
import type { Agent, BaselineId } from "./types.js";

export { CallerAgent } from "./caller.js";
export { RandomAgent } from "./random.js";
export { RulesAgent } from "./rules.js";
export type { Agent, BaselineId } from "./types.js";

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
export { chartPreflop, HeuristicAgent } from "./heuristic.js";
export { type AgentDecision, JevAgent, type JevAgentOptions } from "./jev.js";
