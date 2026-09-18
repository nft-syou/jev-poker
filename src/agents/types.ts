import type { Action, LegalActions, PlayerView } from '../engine/types.js';

export interface Agent {
  readonly id: string;
  decide(view: PlayerView, legal: LegalActions): Promise<Action>;
}

export type BaselineId = 'random' | 'caller' | 'rules';
