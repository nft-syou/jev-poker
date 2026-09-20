import { CATEGORY_ORDER } from '../engine/evaluate.js';
import { draws, madeHand, preflopStrength } from '../engine/strength.js';
import type { Action, LegalActions, PlayerView } from '../engine/types.js';
import type { Agent } from './types.js';

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

function raiseTo(target: number, legal: LegalActions): Action {
  if (legal.minRaiseTo === null) {
    return legal.canCheck ? { type: 'check' } : { type: 'call' };
  }
  const amount = clamp(Math.round(target), legal.minRaiseTo, legal.maxRaiseTo!);
  if (amount === legal.maxRaiseTo) return { type: 'allin' };
  return { type: legal.canCheck ? 'bet' : 'raise', amount };
}

const TWO_PAIR_IDX = CATEGORY_ORDER.indexOf('two_pair');

export class RulesAgent implements Agent {
  readonly id = 'rules';

  // seed is unused today; kept for interface symmetry.
  constructor(_seed: number) {}

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    return view.street === 'preflop' ? this.preflop(view, legal) : this.postflop(view, legal);
  }

  private preflop(view: PlayerView, legal: LegalActions): Action {
    const strength = preflopStrength(view.holeCards);
    const raisedPreflop = view.history.some(
      (h) => h.street === 'preflop' && (h.action.type === 'raise' || h.action.type === 'bet' || h.action.type === 'allin'),
    );
    const raiseAmounts = view.history
      .filter((h) => h.street === 'preflop' && (h.action.type === 'raise' || h.action.type === 'bet'))
      .map((h) => (h.action as { type: 'raise' | 'bet'; amount: number }).amount);
    const lastRaiseTo = raiseAmounts.length > 0 ? Math.max(...raiseAmounts) : view.bigBlind;

    if (strength === 'premium' || strength === 'strong') {
      if (legal.minRaiseTo === null) return legal.canCheck ? { type: 'check' } : { type: 'call' };
      if (!raisedPreflop) return raiseTo(3 * view.bigBlind, legal);
      return raiseTo(3 * lastRaiseTo, legal);
    }
    if (strength === 'medium') {
      if (legal.canCheck) return { type: 'check' };
      if (!raisedPreflop) return { type: 'call' };
      return { type: 'fold' };
    }
    // weak / trash
    return legal.canCheck ? { type: 'check' } : { type: 'fold' };
  }

  private postflop(view: PlayerView, legal: LegalActions): Action {
    const cat = madeHand(view.holeCards, view.board);
    const idx = CATEGORY_ORDER.indexOf(cat);
    const pot = view.pot;
    const toCall = view.toCall;
    const potAfterCall = pot + toCall;

    if (idx >= TWO_PAIR_IDX) {
      if (legal.minRaiseTo === null) return legal.canCheck ? { type: 'check' } : { type: 'call' };
      if (legal.canCheck) return raiseTo(Math.round((2 / 3) * pot), legal);
      // Raise-to total: the bet being matched plus two thirds of the pot after calling. Using
      // `toCall` here instead of `currentBet` under-sized re-raises once chips were already in.
      return raiseTo(view.currentBet + Math.round((2 / 3) * potAfterCall), legal);
    }

    if (cat === 'pair') {
      if (legal.canCheck) return { type: 'check' };
      if (toCall <= pot / 3) return { type: 'call' };
      return { type: 'fold' };
    }

    if (draws(view.holeCards, view.board).length > 0) {
      if (legal.canCheck) return { type: 'check' };
      if (toCall <= pot / 4) return { type: 'call' };
      return { type: 'fold' };
    }

    return legal.canCheck ? { type: 'check' } : { type: 'fold' };
  }
}
