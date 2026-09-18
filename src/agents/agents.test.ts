import { describe, expect, it } from 'vitest';
import { Rng } from '../engine/rng.js';
import { createAgent } from './index.js';
import { isLegal, randomView } from './testutil.js';

describe.each(['random', 'caller', 'rules'] as const)('%s agent', (id) => {
  it('always returns a legal action', async () => {
    const rng = new Rng(11); const agent = createAgent(id, 5);
    for (let i = 0; i < 500; i++) { const { view, legal } = randomView(rng); const a = await agent.decide(view, legal); expect(isLegal(a, legal), JSON.stringify({ a, legal })).toBe(true); }
  });
  it('is deterministic for a seed', async () => {
    const mk = () => { const rng = new Rng(3); const agent = createAgent(id, 8); return Promise.all(Array.from({ length: 50 }, () => { const { view, legal } = randomView(rng); return agent.decide(view, legal); })); };
    expect(await mk()).toEqual(await mk());
  });
});
describe('caller', () => {
  it('never folds or raises', async () => {
    const rng = new Rng(1); const agent = createAgent('caller', 0);
    for (let i = 0; i < 200; i++) { const { view, legal } = randomView(rng); const a = await agent.decide(view, legal); expect(['check', 'call']).toContain(a.type); }
  });
});
