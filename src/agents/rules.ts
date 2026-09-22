import {
  type Action,
  betOrRaiseTo,
  detectDraws,
  HAND_CATEGORIES,
  type LegalActions,
  madeHand,
  type PlayerView,
  preflopStrength,
} from "@jev-poker/engine";
import type { Agent } from "./types";

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

function raiseTo(target: number, view: PlayerView, legal: LegalActions): Action {
  if (legal.minRaiseTo === null) {
    return legal.canCheck ? { type: "check" } : { type: "call" };
  }
  const amount = clamp(Math.round(target), legal.minRaiseTo, legal.maxRaiseTo ?? legal.minRaiseTo);
  if (amount === legal.maxRaiseTo) return { type: "allin" };
  return betOrRaiseTo(view, amount);
}

const TWO_PAIR_IDX = HAND_CATEGORIES.indexOf("two_pair");

export class RulesAgent implements Agent {
  readonly id = "rules";

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    return view.street === "preflop" ? this.preflop(view, legal) : this.postflop(view, legal);
  }

  private preflop(view: PlayerView, legal: LegalActions): Action {
    const strength = preflopStrength(view.holeCards);
    const raisedPreflop = view.history.some(
      (h) =>
        h.street === "preflop" &&
        (h.action.type === "raise" || h.action.type === "bet" || h.action.type === "allin"),
    );
    const raiseAmounts = view.history
      .filter(
        (h) => h.street === "preflop" && (h.action.type === "raise" || h.action.type === "bet"),
      )
      .map((h) => (h.action as { type: "raise" | "bet"; amount: number }).amount);
    const lastRaiseTo = raiseAmounts.length > 0 ? Math.max(...raiseAmounts) : view.bigBlind;

    if (strength === "premium" || strength === "strong") {
      if (legal.minRaiseTo === null) return legal.canCheck ? { type: "check" } : { type: "call" };
      if (!raisedPreflop) return raiseTo(3 * view.bigBlind, view, legal);
      return raiseTo(3 * lastRaiseTo, view, legal);
    }
    if (strength === "medium") {
      if (legal.canCheck) return { type: "check" };
      if (!raisedPreflop) return { type: "call" };
      return { type: "fold" };
    }
    // weak / trash
    return legal.canCheck ? { type: "check" } : { type: "fold" };
  }

  private postflop(view: PlayerView, legal: LegalActions): Action {
    const cat = madeHand(view.holeCards, view.board);
    const idx = HAND_CATEGORIES.indexOf(cat);
    const pot = view.pot;
    const toCall = view.toCall;
    const potAfterCall = pot + toCall;

    if (idx >= TWO_PAIR_IDX) {
      if (legal.minRaiseTo === null) return legal.canCheck ? { type: "check" } : { type: "call" };
      if (legal.canCheck) return raiseTo(Math.round((2 / 3) * pot), view, legal);
      // Raise-to total: the bet being matched plus two thirds of the pot after calling. Using
      // `toCall` here instead of `currentBet` under-sized re-raises once chips were already in.
      return raiseTo(view.currentBet + Math.round((2 / 3) * potAfterCall), view, legal);
    }

    if (cat === "pair") {
      if (legal.canCheck) return { type: "check" };
      if (toCall <= pot / 3) return { type: "call" };
      return { type: "fold" };
    }

    if (detectDraws(view.holeCards, view.board).length > 0) {
      if (legal.canCheck) return { type: "check" };
      if (toCall <= pot / 4) return { type: "call" };
      return { type: "fold" };
    }

    return legal.canCheck ? { type: "check" } : { type: "fold" };
  }
}
