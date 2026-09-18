import { describe, expect, it } from 'vitest';
import { cardToString } from '../src/engine/cards.js';
import type { DecisionRecord } from '../src/jev/agent.js';
import { createMockBackend } from '../src/jev/backend.js';
import { getPersona } from '../src/jev/personas.js';
import { expandMatchups, rotations, seatCount } from './matchups.js';
import { playHand, runMatch } from './runner.js';

const persona = getPersona('tag');
describe('expandMatchups', () => {
  it('all × all = 6', () => expect(expandMatchups('all', 'all')).toHaveLength(6));
  it('single', () => expect(expandMatchups('rules', 'hu')).toEqual([{ opponent: 'rules', format: 'hu' }]));
  it('is opponent-major', () =>
    expect(expandMatchups('all', 'all')).toEqual([
      { opponent: 'random', format: 'hu' },
      { opponent: 'random', format: '6max' },
      { opponent: 'caller', format: 'hu' },
      { opponent: 'caller', format: '6max' },
      { opponent: 'rules', format: 'hu' },
      { opponent: 'rules', format: '6max' },
    ]));
  it('seat and rotation counts', () => {
    expect(seatCount('hu')).toBe(2);
    expect(seatCount('6max')).toBe(6);
    expect(rotations('hu')).toBe(2);
    expect(rotations('6max')).toBe(6);
  });
});
describe('playHand', () => {
  it('is zero-sum and deals the same deck across rotations', async () => {
    const dealt: string[][] = [];
    const run = async (rotation: number) => {
      const cards: string[] = [];
      const r = await playHand({
        seedIndex: 3, rotation, opponent: 'caller', format: 'hu', baseSeed: 1, persona, backend: createMockBackend(),
        onEvent: (e) => { if (e.type === 'HoleCardsDealt') cards.push(...e.cards.map(cardToString)); },
      });
      dealt.push(cards.sort());
      return r;
    };
    const a = await run(0);
    const b = await run(1);
    expect(a.net.reduce((x, y) => x + y, 0)).toBeCloseTo(0);
    expect(a.jevSeat).toBe(0); expect(b.jevSeat).toBe(1);
    expect(a.decisions.length).toBeGreaterThan(0);
    expect(b.net.reduce((x, y) => x + y, 0)).toBeCloseTo(0);
    // Same deal, Jev in the other seat: the four hole cards dealt are identical.
    expect(dealt[0]).toHaveLength(4);
    expect(dealt[1]).toEqual(dealt[0]);
  });
  it('6-max has 6 seats', async () => {
    const r = await playHand({ seedIndex: 0, rotation: 5, opponent: 'random', format: '6max', baseSeed: 1, persona, backend: createMockBackend() });
    expect(r.net).toHaveLength(6); expect(r.jevSeat).toBe(5);
    expect(r.net.reduce((x, y) => x + y, 0)).toBeCloseTo(0);
  });
  it('keeps chips zero-sum over a whole 6-max cycle', async () => {
    const m = await runMatch({ opponent: 'rules', format: '6max', seeds: 4, baseSeed: 5, concurrency: 4, persona, backend: createMockBackend() });
    for (const h of m.hands) expect(h.net.reduce((x, y) => x + y, 0)).toBeCloseTo(0);
  });
  it('is deterministic for the same arguments', async () => {
    const args = { seedIndex: 7, rotation: 1, opponent: 'rules' as const, format: 'hu' as const, baseSeed: 4, persona };
    const a = await playHand({ ...args, backend: createMockBackend() });
    const b = await playHand({ ...args, backend: createMockBackend() });
    expect(b.net).toEqual(a.net);
    expect(b.decisions.map((d) => d.action)).toEqual(a.decisions.map((d) => d.action));
  });
  it('reports showdown and preflop aggression fields', async () => {
    const r = await playHand({ seedIndex: 11, rotation: 0, opponent: 'caller', format: '6max', baseSeed: 9, persona, backend: createMockBackend() });
    expect(typeof r.wentToShowdown).toBe('boolean');
    // `jevWonShowdown` is "Jev finished the hand ahead", not "Jev was awarded a pot".
    expect(r.jevWonShowdown).toBe(r.wentToShowdown ? (r.net[r.jevSeat] ?? 0) > 0 : null);
    expect(typeof r.jevVpip).toBe('boolean');
    expect(typeof r.jevPfr).toBe('boolean');
    expect(r.oppVpip).toBeGreaterThanOrEqual(0);
    expect(r.oppVpip).toBeLessThanOrEqual(1);
    expect(r.oppPfr).toBeGreaterThanOrEqual(0);
    expect(r.oppPfr).toBeLessThanOrEqual(1);
  });
});
describe('runMatch', () => {
  const base = { opponent: 'rules' as const, seeds: 5, baseSeed: 2, concurrency: 3, persona, backend: createMockBackend() };
  it('runs seeds × rotations', async () => {
    const hu = await runMatch({ ...base, format: 'hu' }); expect(hu.hands).toHaveLength(10); expect(hu.partial).toBe(false);
    const six = await runMatch({ ...base, format: '6max' }); expect(six.hands).toHaveLength(30);
    expect(hu.hands.map((h) => [h.seedIndex, h.rotation])).toEqual([[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0],[4,1]]);
  });
  it('stops early when aborted', async () => {
    const ctrl = new AbortController();
    const r = await runMatch({ ...base, format: 'hu', seeds: 50, signal: ctrl.signal, onHand: (done) => { if (done >= 4) ctrl.abort(); } });
    expect(r.partial).toBe(true); expect(r.hands.length).toBeLessThan(100); expect(r.hands.length).toBeGreaterThanOrEqual(4);
  });
  it('stops scheduling hands once one fails, and rejects with that error', async () => {
    let started = 0;
    const boom = new Error('backend exploded');
    const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
    const r = runMatch({
      ...base,
      format: 'hu',
      seeds: 20,
      concurrency: 2,
      // Only ONE job fails, so a worker that ignored the failure would happily
      // grind through the other 38 while the match has already rejected.
      playHandImpl: async (args) => {
        started += 1;
        await tick();
        if (args.seedIndex === 1 && args.rotation === 0) throw boom;
        return playHand(args);
      },
    });
    await expect(r).rejects.toBe(boom);
    // Give any still-running worker ample time to claim more jobs.
    for (let i = 0; i < 50; i++) await tick();
    // 40 jobs were planned; only the handful in flight around the failure may start.
    expect(started).toBeLessThan(10);
  });
  const errored = (error: string | undefined): DecisionRecord => ({
    street: 'preflop',
    choice: 'check_or_call',
    action: { type: 'call' },
    probabilities: { fold: 0, check_or_call: 1, bet_or_raise: 0 },
    sizingScore: null,
    bluffIntent: null,
    latencyMs: 1,
    apiCall: true,
    ...(error === undefined ? {} : { error }),
  });
  const fake = (seedIndex: number, rotation: number, decisions: DecisionRecord[]) => ({
    seedIndex, rotation, jevSeat: rotation, net: [0, 0], wentToShowdown: false, jevWonShowdown: null,
    jevVpip: false, jevPfr: false, oppVpip: 0, oppPfr: 0, decisions,
  });

  it('aborts the match when the first 10 decisions all failed open', async () => {
    let started = 0;
    const r = runMatch({
      ...base,
      format: 'hu',
      seeds: 50,
      concurrency: 2,
      playHandImpl: async (args) => {
        started += 1;
        return fake(args.seedIndex, args.rotation, [errored('backend down'), errored('backend down')]);
      },
    });
    await expect(r).rejects.toThrow('Jev backend failing on every decision (first 10): backend down');
    const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
    for (let i = 0; i < 50; i++) await tick();
    expect(started).toBeLessThan(15); // of 100 planned hands
  });

  it('does not abort when only some decisions failed open', async () => {
    const r = await runMatch({
      ...base,
      format: 'hu',
      seeds: 10,
      playHandImpl: async (args) =>
        fake(args.seedIndex, args.rotation, [errored(args.rotation === 0 ? 'flaky' : undefined), errored(undefined)]),
    });
    expect(r.hands).toHaveLength(20);
  });

  it('reports every decision through onDecision', async () => {
    const seen: DecisionRecord[] = [];
    await runMatch({ ...base, format: 'hu', seeds: 2, onDecision: (d) => seen.push(d) });
    expect(seen.length).toBeGreaterThan(0);
  });

  it('reports progress up to the total', async () => {
    const seen: [number, number][] = [];
    const r = await runMatch({ ...base, format: 'hu', seeds: 3, onHand: (done, total) => seen.push([done, total]) });
    expect(r.hands).toHaveLength(6);
    expect(seen).toHaveLength(6);
    expect(seen.map((s) => s[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every((s) => s[1] === 6)).toBe(true);
  });
});
