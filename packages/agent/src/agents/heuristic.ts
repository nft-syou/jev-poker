import { type Action, betOrRaiseTo, type LegalActions, type PlayerView } from "@jev-poker/engine";
import { type DecisionFeatures, featuresFromView } from "../features.js";
import type { Agent } from "./types.js";

/** The rules never read the persona; the features just need one to be built. */
const NO_PERSONA = { name: "heuristic", description: "" };

/**
 * A fixed rule set that reads exactly the features Jev is given (`featuresFromView`) and nothing
 * else. It exists as a yardstick: whatever the Jev agent wins beyond this agent is what the
 * classifier adds on top of the hand-computed features and the guidance they encode.
 *
 * Deterministic; no backend, no randomness.
 */
export class HeuristicAgent implements Agent {
  readonly id = "heuristic";

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    const state = featuresFromView(view, NO_PERSONA);
    return view.street === "preflop"
      ? chartPreflop(state, view, legal)
      : postflop(state, view, legal);
  }
}

function checkOrFold(legal: LegalActions): Action {
  return legal.canCheck ? { type: "check" } : { type: "fold" };
}

function checkOrCall(legal: LegalActions): Action {
  return legal.canCheck ? { type: "check" } : { type: "call" };
}

/** Raise to `target` chips (a street total), clamped to the legal range; all-in at the top. */
function raiseTo(target: number, view: PlayerView, legal: LegalActions): Action {
  if (legal.minRaiseTo === null || legal.maxRaiseTo === null) return checkOrCall(legal);
  const amount = Math.round(Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo));
  if (amount >= legal.maxRaiseTo) return { type: "allin" };
  return betOrRaiseTo(view, amount);
}

/** A pot-fraction bet or raise: the bet being matched plus a fraction of the pot after calling. */
function potRaise(fraction: number, view: PlayerView, legal: LegalActions): Action {
  return raiseTo(view.currentBet + fraction * (view.pot + view.toCall), view, legal);
}

const OPEN_TIERS: Record<string, readonly string[]> = {
  BTN: ["premium", "strong", "medium", "weak"],
  SB: ["premium", "strong", "medium", "weak"],
  CO: ["premium", "strong", "medium", "weak"],
  MP: ["premium", "strong", "medium"],
  UTG: ["premium", "strong"],
  BB: ["premium", "strong"],
};

/** Position-based preflop chart over `preflopStrength`: open, isolate, 3-bet and continue ranges. Also used by `JevAgent` with `preflop: 'chart'`. */
export function chartPreflop(
  state: DecisionFeatures,
  view: PlayerView,
  legal: LegalActions,
): Action {
  const tier = state.hand.preflopStrength;
  const { position, raisesThisStreet, myBetWasRaisedThisStreet, unopenedPot, toCallBB } =
    state.table;
  const bb = view.bigBlind;

  if (myBetWasRaisedThisStreet) {
    // Our raise was re-raised: only the top of the range continues, and it continues by calling.
    return tier === "premium" ? checkOrCall(legal) : checkOrFold(legal);
  }

  if (unopenedPot === true) {
    // Heads-up the button steals with everything but trash.
    const headsUp = view.stacks.length === 2;
    const opens =
      headsUp && position === "BTN"
        ? ["premium", "strong", "medium", "weak"]
        : (OPEN_TIERS[position] ?? []);
    if (opens.includes(tier)) return raiseTo(2.5 * bb, view, legal);
    return checkOrFold(legal);
  }

  if (raisesThisStreet === 0) {
    // Limped pot: isolate with good hands, otherwise take the free or cheap flop.
    if (tier === "premium" || tier === "strong" || tier === "medium")
      return raiseTo(4 * bb, view, legal);
    if (legal.canCheck) return { type: "check" };
    return tier === "weak" && toCallBB <= 1 ? { type: "call" } : { type: "fold" };
  }

  // Facing a raise.
  if (tier === "premium")
    return raisesThisStreet === 1 ? raiseTo(3 * view.currentBet, view, legal) : checkOrCall(legal);
  if (raisesThisStreet >= 2) return checkOrFold(legal);
  if (tier === "strong") return checkOrCall(legal);
  if (tier === "medium" && toCallBB <= 4) return checkOrCall(legal);
  return checkOrFold(legal);
}

function postflop(state: DecisionFeatures, view: PlayerView, legal: LegalActions): Action {
  const strength = state.hand.beatsPctOfHands ?? 0;
  const draws = state.hand.draws ?? [];
  const { potOddsPct, raisesThisStreet, myBetWasRaisedThisStreet } = state.table;

  if (strength >= 95) return potRaise(1, view, legal);

  if (strength >= 85) {
    if (myBetWasRaisedThisStreet || raisesThisStreet >= 2) return checkOrCall(legal);
    return potRaise(2 / 3, view, legal);
  }

  if (strength >= 60) {
    if (legal.canCheck)
      return view.street === "flop" ? potRaise(1 / 2, view, legal) : { type: "check" };
    return potOddsPct <= 33 && raisesThisStreet <= 1 ? { type: "call" } : { type: "fold" };
  }

  if (draws.length > 0) {
    if (legal.canCheck) return { type: "check" };
    return potOddsPct <= 25 ? { type: "call" } : { type: "fold" };
  }

  return checkOrFold(legal);
}
