import type { Action, LegalActions } from "../engine/types";
import type { PlayerView } from "../engine/view";
import type { Agent } from "./types";

export class CallerAgent implements Agent {
  readonly id = "caller";

  async decide(_view: PlayerView, legal: LegalActions): Promise<Action> {
    return legal.canCheck ? { type: "check" } : { type: "call" };
  }
}
