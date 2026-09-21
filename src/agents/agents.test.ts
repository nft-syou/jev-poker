import { describe, expect, it } from "vitest";
import { fixedBlinds } from "../engine/blinds";
import { createRng } from "../engine/rng";
import { Table } from "../engine/table";
import { type ActionTakenEvent, playerView } from "../engine/view";
import { type Agent, createAgent, HeuristicAgent } from "./index";
import { isLegal, randomView } from "./testutil";

describe.each(["random", "caller", "rules"] as const)("%s agent", (id) => {
  it("always returns a legal action", async () => {
    const rng = createRng(11);
    const agent = createAgent(id, 5);
    for (let i = 0; i < 500; i++) {
      const { view, legal } = randomView(rng);
      const a = await agent.decide(view, legal);
      expect(isLegal(a, legal, view), JSON.stringify({ a, legal, view })).toBe(true);
    }
  });
  it("is deterministic for a seed", async () => {
    const mk = () => {
      const rng = createRng(3);
      const agent = createAgent(id, 8);
      return Promise.all(
        Array.from({ length: 50 }, () => {
          const { view, legal } = randomView(rng);
          return agent.decide(view, legal);
        }),
      );
    };
    expect(await mk()).toEqual(await mk());
  });
});

describe("caller", () => {
  it("never folds or raises", async () => {
    const rng = createRng(1);
    const agent = createAgent("caller", 0);
    for (let i = 0; i < 200; i++) {
      const { view, legal } = randomView(rng);
      const a = await agent.decide(view, legal);
      expect(["check", "call"]).toContain(a.type);
    }
  });
});

describe("createAgent", () => {
  it("builds each baseline under its own id", () => {
    for (const id of ["random", "caller", "rules"] as const) expect(createAgent(id, 1).id).toBe(id);
    expect(new HeuristicAgent().id).toBe("heuristic");
  });
});

describe("randomView (test helper)", () => {
  it("generates views and legal actions that agree with each other", () => {
    const rng = createRng(17);
    let bigBlindOptions = 0;
    let cappedCalls = 0;
    let noRaise = 0;
    for (let i = 0; i < 2000; i++) {
      const { view, legal } = randomView(rng);
      const me = view.stacks.find((s) => s.seat === view.seat);
      const stack = me?.stack ?? 0;
      const owed = view.currentBet - view.committedThisStreet;
      expect(me?.folded).toBe(false);
      expect(owed).toBeGreaterThanOrEqual(0);
      expect(view.toCall).toBe(Math.min(owed, stack));
      expect(legal.canCheck).toBe(owed === 0);
      expect(legal.canFold).toBe(!legal.canCheck);
      expect(legal.callAmount).toBe(legal.canCheck ? null : view.toCall);
      expect(legal.maxRaiseTo === null).toBe(legal.minRaiseTo === null);
      if (legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
        expect(legal.minRaiseTo).toBeGreaterThan(view.currentBet);
        expect(legal.minRaiseTo).toBeLessThanOrEqual(legal.maxRaiseTo);
        expect(legal.maxRaiseTo).toBe(view.committedThisStreet + stack);
      } else {
        expect(legal.canCheck).toBe(false);
        noRaise++;
      }
      if (view.street === "preflop") expect(view.currentBet).toBeGreaterThanOrEqual(view.bigBlind);
      expect(view.pot).toBeGreaterThanOrEqual(view.currentBet + view.committedThisStreet);
      expect(view.stacks.filter((s) => !s.folded).length).toBeGreaterThanOrEqual(2);
      if (legal.canCheck && view.currentBet > 0) bigBlindOptions++;
      if (owed > stack) cappedCalls++;
    }
    // The awkward spots are really generated.
    expect(bigBlindOptions).toBeGreaterThan(50);
    expect(cappedCalls).toBeGreaterThan(5);
    expect(noRaise).toBeGreaterThan(50);
  });
});

describe("isLegal (test helper)", () => {
  const { view, legal } = randomView(createRng(2));
  const open = { ...legal, canFold: true, canCheck: false, callAmount: 100 };
  const canRaise = { ...open, minRaiseTo: 200, maxRaiseTo: 1000 };
  const facing = { ...view, currentBet: 100, committedThisStreet: 0, toCall: 100 };
  const unopened = { ...view, currentBet: 0, committedThisStreet: 0, toCall: 0 };

  it("wants a wager named bet only when nobody has bet", () => {
    expect(isLegal({ type: "raise", amount: 300 }, canRaise, facing)).toBe(true);
    expect(isLegal({ type: "bet", amount: 300 }, canRaise, facing)).toBe(false);
    expect(isLegal({ type: "bet", amount: 300 }, canRaise, unopened)).toBe(true);
    expect(isLegal({ type: "raise", amount: 300 }, canRaise, unopened)).toBe(false);
  });

  it("checks the size of a wager", () => {
    expect(isLegal({ type: "raise", amount: 199 }, canRaise, facing)).toBe(false);
    expect(isLegal({ type: "raise", amount: 1001 }, canRaise, facing)).toBe(false);
    expect(isLegal({ type: "raise", amount: 250.5 }, canRaise, facing)).toBe(false);
    expect(isLegal({ type: "raise", amount: 300 }, { ...open, minRaiseTo: null }, facing)).toBe(
      false,
    );
  });

  it("accepts an all-in without the right to raise only as a call for less", () => {
    const noRaise = { ...open, minRaiseTo: null, maxRaiseTo: null };
    const stacks = (stack: number) =>
      view.stacks.map((s) => (s.seat === view.seat ? { ...s, stack } : s));
    expect(isLegal({ type: "allin" }, canRaise, facing)).toBe(true);
    expect(isLegal({ type: "allin" }, noRaise, { ...facing, stacks: stacks(60), toCall: 60 })).toBe(
      true,
    );
    expect(isLegal({ type: "allin" }, noRaise, { ...facing, stacks: stacks(5000) })).toBe(false);
  });
});

/**
 * Plays `hands` hands on the real table, every seat driven by its agent through `playerView` and
 * `table.legalActions`, the way the benchmark runner does. The engine throws on any illegal action.
 */
async function playTable(agents: readonly Agent[], seed: number, hands: number): Promise<number> {
  const table = new Table({
    format: "cash",
    blinds: fixedBlinds(50, 100),
    startingStack: 5000,
    seats: agents.map((agent, id) => ({ id, name: `${agent.id}-${id}`, kind: "cpu" as const })),
    seed,
  });
  let actions: ActionTakenEvent[] = [];
  let decisions = 0;
  table.on((event) => {
    if (event.type === "HandStarted") actions = [];
    if (event.type === "ActionTaken") actions.push(event);
  });

  for (let h = 0; h < hands; h++) {
    // A cash table rebuys busted seats between hands, so chips are counted within the hand.
    const before = table.seats.reduce((sum, s) => sum + s.stack, 0);
    let snapshot = table.startHand();
    while (!snapshot.complete) {
      const seat = snapshot.actingSeat;
      if (seat === null) throw new Error("nobody is acting in an unfinished hand");
      const legal = table.legalActions(seat);
      const view = playerView(snapshot, seat, actions);
      expect(view.toCall).toBe(legal.callAmount ?? 0);
      const action = await (agents[seat] as Agent).decide(view, legal);
      expect(isLegal(action, legal, view), JSON.stringify({ action, legal })).toBe(true);
      table.act(seat, action);
      decisions++;
      const next = table.snapshot();
      if (next === null) throw new Error("the table lost its hand");
      snapshot = next;
    }
    const after = (table.currentHand?.stacks() ?? []).reduce((sum, s) => sum + s.stack, 0);
    expect(after).toBe(before);
  }
  expect(table.handNumber).toBe(hands);
  return decisions;
}

const KINDS = ["random", "caller", "rules", "heuristic"] as const;

function agentOf(kind: (typeof KINDS)[number], seed: number): Agent {
  return kind === "heuristic" ? new HeuristicAgent() : createAgent(kind, seed);
}

describe("agents on the real table", () => {
  const pairs = KINDS.flatMap((a, i) => KINDS.slice(i).map((b) => [a, b] as const));

  it.each(pairs)(
    "%s vs %s play 200 heads-up hands legally and conserve chips",
    async (a, b) => {
      expect(await playTable([agentOf(a, 1), agentOf(b, 2)], 31, 200)).toBeGreaterThanOrEqual(200);
    },
    120_000,
  );

  it("all of them play 200 six-handed hands legally and conserve chips", async () => {
    const lineup = ["random", "caller", "rules", "heuristic", "random", "rules"] as const;
    const agents = lineup.map((kind, i) => agentOf(kind, i + 1));
    expect(await playTable(agents, 47, 200)).toBeGreaterThan(200 * 3);
  }, 120_000);

  it("plays the same hands again for the same seeds", async () => {
    const run = () =>
      playTable([createAgent("random", 4), new HeuristicAgent(), createAgent("rules", 6)], 5, 40);
    expect(await run()).toBe(await run());
  }, 120_000);
});
