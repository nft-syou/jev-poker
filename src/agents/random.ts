import {
  type Action,
  betOrRaiseTo,
  createRng,
  type LegalActions,
  type PlayerView,
  type Rng,
  randomInt,
} from "@jev-poker/engine";
import type { Agent } from "./types";

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, items.length)] as T;
}

export class RandomAgent implements Agent {
  readonly id = "random";
  private rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    const kinds: ("fold" | "checkcall" | "raise")[] = ["checkcall"];
    if (legal.canFold) kinds.push("fold");
    if (legal.minRaiseTo !== null) kinds.push("raise");

    const kind = pick(this.rng, kinds);

    if (kind === "fold") return { type: "fold" };
    if (kind === "checkcall") return legal.canCheck ? { type: "check" } : { type: "call" };

    // raise
    const min = legal.minRaiseTo ?? 0;
    const max = legal.maxRaiseTo ?? min;
    const pot = view.pot;
    const candidates = [min, min + Math.floor(pot / 2), min + pot, max];
    const raw = pick(this.rng, candidates);
    const amount = Math.round(Math.min(Math.max(raw, min), max));

    if (amount === max) return { type: "allin" };
    return betOrRaiseTo(view, amount);
  }
}
