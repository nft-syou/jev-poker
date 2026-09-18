import { CallerAgent } from './caller.js';
import { RandomAgent } from './random.js';
import type { Agent, BaselineId } from './types.js';

export type { Agent, BaselineId } from './types.js';
export { RandomAgent } from './random.js';
export { CallerAgent } from './caller.js';

export function createAgent(id: BaselineId, seed: number): Agent {
  switch (id) {
    case 'random':
      return new RandomAgent(seed);
    case 'caller':
      return new CallerAgent();
    case 'rules':
      throw new Error('rules agent not implemented');
  }
}
