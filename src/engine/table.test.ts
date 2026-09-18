import { describe, expect, it } from 'vitest';
import { Table, positionOf } from './table.js';
import { fixedBlinds } from './types.js';

const cfg = (n: number, seed = 1) => ({
  format: 'cash' as const, blinds: fixedBlinds({ small: 50, big: 100, ante: 0 }), startingStack: 10000,
  seats: Array.from({ length: n }, (_, id) => ({ id, name: `s${id}`, kind: 'cpu' as const })), seed,
});

describe('positionOf', () => {
  it('heads-up', () => { expect(positionOf(0, 0, [0, 1])).toBe('BTN'); expect(positionOf(1, 0, [0, 1])).toBe('BB'); });
  it('6-max', () => expect([0,1,2,3,4,5].map((s) => positionOf(s, 0, [0,1,2,3,4,5]))).toEqual(['BTN','SB','BB','UTG','MP','CO']));
  it('5-handed labels CO before button', () => expect([0,1,2,3,4].map((s) => positionOf(s, 0, [0,1,2,3,4]))).toEqual(['BTN','SB','BB','UTG','CO']));
});
describe('Table', () => {
  it('starts hands, rotates button, emits events', () => {
    const t = new Table(cfg(3)); const types: string[] = []; t.on((e) => types.push(e.type));
    const h = t.startHand(); expect(t.button).toBe(0);
    while (!h.isOver) h.act(h.toAct!, { type: 'fold' });
    expect(types[0]).toBe('HandStarted'); expect(types).toContain('HandEnded');
    t.startHand(); expect(t.button).toBe(1);
  });
  it('view includes position and hides other hole cards', () => {
    const t = new Table(cfg(2)); t.startHand();
    const v = t.view(0);
    expect(v.position).toBe('BTN'); expect(v.holeCards).toHaveLength(2); expect(v.bigBlind).toBe(100); expect(v.toCall).toBe(50);
  });
  it('cash game rebuys a busted seat', () => {
    const t = new Table({ ...cfg(2), startingStack: 100 });
    const types: string[] = []; t.on((e) => types.push(e.type));
    const h = t.startHand();
    while (!h.isOver) {
      const s = h.toAct!;
      const la = h.legalActions(s);
      h.act(s, la.canCheck ? { type: 'check' } : { type: 'call' });
    }
    t.startHand();
    expect(t.stacks().every((s) => s.stack > 0)).toBe(true);
    expect(types).toContain('SeatRebought');
  });
});
