import type { Action, LegalActions, PlayerView } from '../engine/types.js';
import type { Agent } from './types.js';

export class CallerAgent implements Agent {
  readonly id = 'caller';

  async decide(_view: PlayerView, legal: LegalActions): Promise<Action> {
    return legal.canCheck ? { type: 'check' } : { type: 'call' };
  }
}
