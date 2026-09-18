import { Rng } from '../engine/rng.js';
import type { Action, LegalActions, PlayerView } from '../engine/types.js';
import type { Agent } from './types.js';

export class RandomAgent implements Agent {
  readonly id = 'random';
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    const kinds: ('fold' | 'checkcall' | 'raise')[] = ['checkcall'];
    if (legal.canFold) kinds.push('fold');
    if (legal.minRaiseTo !== null) kinds.push('raise');

    const kind = this.rng.pick(kinds);

    if (kind === 'fold') return { type: 'fold' };
    if (kind === 'checkcall') return legal.canCheck ? { type: 'check' } : { type: 'call' };

    // raise
    const min = legal.minRaiseTo!;
    const max = legal.maxRaiseTo!;
    const pot = view.pot;
    const candidates = [min, min + Math.floor(pot / 2), min + pot, max];
    const raw = this.rng.pick(candidates);
    const amount = Math.round(Math.min(Math.max(raw, min), max));

    if (amount === max) return { type: 'allin' };
    return { type: legal.canCheck ? 'bet' : 'raise', amount };
  }
}
