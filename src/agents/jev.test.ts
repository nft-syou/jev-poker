import { createRng, type LegalActions, type PlayerView, parseCards } from "@jev-poker/engine";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { JevBackend } from "../jev/backend";
import {
  type DecisionFeatures,
  type OpponentStats,
  POSTFLOP_TASK,
  PREFLOP_TASK,
  TASK,
} from "../jev/features";
import { createMockBackend } from "../jev/mock-backend";
import { type Persona, PRESET_PERSONAS } from "../jev/personas";
import { PREFLOP_SIZING_RUBRIC, SIZING_RUBRIC } from "../jev/questions";
import { type AgentDecision, JevAgent } from "./jev";
import { isLegal, randomView } from "./testutil";

function getPersona(id: string): Persona {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`no preset persona ${id}`);
  return persona;
}

const legal: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 100,
  minRaiseTo: 300,
  maxRaiseTo: 10000,
};
const free: LegalActions = { ...legal, canFold: false, canCheck: true, callAmount: null };
const view: PlayerView = {
  seat: 0,
  street: "flop",
  holeCards: parseCards("Ah Kh"),
  board: parseCards("Qh Jh 2c"),
  stacks: [],
  pot: 600,
  toCall: 100,
  currentBet: 100,
  committedThisStreet: 0,
  bigBlind: 100,
  position: "BTN",
  history: [],
};
const twoSeats = [
  { seat: 0, stack: 10000, isAllIn: false, folded: false },
  { seat: 1, stack: 10000, isAllIn: false, folded: false },
];
const preflopView: PlayerView = {
  ...view,
  street: "preflop",
  board: [],
  pot: 150,
  toCall: 100,
  currentBet: 100,
  stacks: twoSeats,
};
const open: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 100,
  minRaiseTo: 200,
  maxRaiseTo: 10000,
};

/** A backend that answers with fixed probabilities and a fixed sizing score. */
function fixedBackend(probabilities: Record<string, number>, score = 3): JevBackend {
  return {
    kind: "mock",
    async systemOne(request) {
      return {
        model: "fixed",
        answers: {
          action: { type: "choice", choice: "fold", confidence: 1, probabilities },
          sizing: { type: "score", score, confidence: 1, legend: {}, probabilities: {} },
          bluff_intent: { type: "noul", noul: 0.2 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as SystemOneResult<typeof request.questions>;
    },
  };
}

/** The mock backend, remembering every request it was sent. */
function spyBackend(): { backend: JevBackend; requests: SystemOneRequest<Questions>[] } {
  const inner = createMockBackend();
  const requests: SystemOneRequest<Questions>[] = [];
  return {
    requests,
    backend: {
      kind: "mock",
      systemOne(request, options) {
        requests.push(request as SystemOneRequest<Questions>);
        return inner.systemOne(request, options);
      },
    },
  };
}

const stateOf = (request: SystemOneRequest<Questions> | undefined) =>
  request?.state as unknown as DecisionFeatures;
const sizingCriteriaOf = (request: SystemOneRequest<Questions> | undefined) =>
  (request?.questions.sizing as { criteria: readonly string[] } | undefined)?.criteria;

describe("JevAgent", () => {
  it("returns legal actions with the mock backend and records decisions", {
    timeout: 30_000,
  }, async () => {
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: createMockBackend(),
      seed: 1,
      onDecision: (r) => records.push(r),
    });
    const rng = createRng(4);
    for (let i = 0; i < 200; i++) {
      const { view: v, legal: l } = randomView(rng);
      const action = await agent.decide(v, l);
      expect(isLegal(action, l, v), JSON.stringify({ action, l })).toBe(true);
      expect(records[i]?.action).toEqual(action);
      expect(records[i]?.street).toBe(v.street);
    }
    expect(records).toHaveLength(200);
  });

  it("fails open on backend error", async () => {
    const backend: JevBackend = {
      kind: "mock",
      systemOne: async () => {
        throw new Error("boom");
      },
    };
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      onDecision: (r) => records.push(r),
    });
    expect(await agent.decide(view, legal)).toEqual({ type: "fold" });
    expect(await agent.decide({ ...view, toCall: 0, currentBet: 0 }, free)).toEqual({
      type: "check",
    });
    // `decideAction` reports the error with its name.
    expect(records[0]?.error).toBe("Error: boom");
    expect(records.map((r) => r.choice)).toEqual(["fold", "check_or_call"]);
  });

  it("works without an onDecision listener", async () => {
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: createMockBackend(),
      seed: 1,
    });
    expect(isLegal(await agent.decide(view, legal), legal, view)).toBe(true);
  });

  it("is deterministic for a seed", { timeout: 30_000 }, async () => {
    const play = async (seed: number) => {
      const agent = new JevAgent({
        persona: getPersona("maniac"),
        backend: createMockBackend(),
        seed,
      });
      const rng = createRng(11);
      const actions = [];
      for (let i = 0; i < 40; i++) {
        const { view: v, legal: l } = randomView(rng);
        actions.push(await agent.decide(v, l));
      }
      return actions;
    };
    const first = await play(3);
    expect(await play(3)).toEqual(first);
    expect(await play(4)).not.toEqual(first);
  });
});

describe("JevAgent records", () => {
  it("names itself after the persona and reports mock calls as offline", async () => {
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("rock"),
      backend: createMockBackend(),
      seed: 7,
      onDecision: (r) => records.push(r),
    });
    expect(agent.id).toBe("jev:rock");
    const action = await agent.decide(view, legal);
    const record = records[0] as AgentDecision;
    expect(record.action).toEqual(action);
    expect(record.apiCall).toBe(false);
    expect(record.model).toBe("mock");
    // The mock answers from the made hand: high card is strength 0.1, bluff 1 - 0.1 - 0.2.
    expect(record.bluffIntent).toBeCloseTo(0.7);
    expect(record.street).toBe("flop");
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.error).toBeUndefined();
    const total = Object.values(record.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    expect(Object.keys(record.probabilities).sort()).toEqual([
      "bet_or_raise",
      "check_or_call",
      "fold",
    ]);
  });

  it("copies the diagnostics of the features into the record", async () => {
    const records: AgentDecision[] = [];
    const { backend, requests } = spyBackend();
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      onDecision: (r) => records.push(r),
    });
    const history: PlayerView["history"] = [
      { street: "flop", seat: 0, action: { type: "bet", amount: 50 } },
      { street: "flop", seat: 1, action: { type: "raise", amount: 100 } },
    ];
    await agent.decide(
      { ...view, board: parseCards("Ad 7s 2c"), stacks: twoSeats, history },
      legal,
    );
    const state = stateOf(requests[0]);
    expect(records[0]).toMatchObject({
      equityVsRandomPct: state.hand.equityVsRandomPct,
      beatsPctOfHands: state.hand.beatsPctOfHands,
      madeHand: "pair",
      pairKind: "top_pair",
      myBetWasRaised: true,
    });
    expect("equityVsRangePct" in (records[0] as AgentDecision)).toBe(false);
  });

  it("reports a sizing score only for a bet or raise", async () => {
    const records: AgentDecision[] = [];
    const decideWith = async (probabilities: Record<string, number>, l: LegalActions) => {
      const agent = new JevAgent({
        persona: getPersona("tag"),
        backend: fixedBackend(probabilities, 3),
        seed: 1,
        onDecision: (r) => records.push(r),
      });
      return agent.decide(view, l);
    };
    // Raising is impossible, so the most likely label left is check_or_call.
    expect(
      await decideWith(
        { fold: 0.1, check_or_call: 0.9, bet_or_raise: 1 },
        { ...legal, minRaiseTo: null, maxRaiseTo: null },
      ),
    ).toEqual({ type: "call" });
    expect(records[0]).toMatchObject({
      choice: "check_or_call",
      sizingScore: null,
      bluffIntent: 0.2,
      probabilities: { fold: 0.1, check_or_call: 0.9, bet_or_raise: 0 },
    });
    expect(await decideWith({ bet_or_raise: 1 }, legal)).toEqual({ type: "raise", amount: 800 });
    expect(records[1]).toMatchObject({ choice: "bet_or_raise", sizingScore: 3, model: "fixed" });
  });

  it("raises to the maximum at the top sizing level", async () => {
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: fixedBackend({ bet_or_raise: 1 }, 5),
      seed: 1,
    });
    // The product reports an all-in as a raise to everything, never as `allin`.
    expect(await agent.decide(view, legal)).toEqual({ type: "raise", amount: 10000 });
    expect(await agent.decide({ ...view, toCall: 0, currentBet: 0 }, free)).toEqual({
      type: "bet",
      amount: 10000,
    });
  });

  it("sizes a re-raise from the chips already committed on the street", async () => {
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: fixedBackend({ bet_or_raise: 1 }, 3),
      seed: 1,
    });
    // Bet 300, raised to 700: pot 1200, 400 to call. Pot-sized re-raise: 700 + 1600 = 2300.
    const v = { ...view, pot: 1200, toCall: 400, currentBet: 700, committedThisStreet: 300 };
    const l = { ...legal, callAmount: 400, minRaiseTo: 1100 };
    expect(await agent.decide(v, l)).toEqual({ type: "raise", amount: 2300 });
  });

  it("fails open when building the state throws", async () => {
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: createMockBackend(),
      seed: 1,
      onDecision: (r) => records.push(r),
    });
    // No hole cards: `preflopStrength` throws inside `featuresFromView`, before any backend call.
    expect(await agent.decide({ ...view, holeCards: [] }, legal)).toEqual({ type: "fold" });
    expect(await agent.decide({ ...view, holeCards: [], toCall: 0, currentBet: 0 }, free)).toEqual({
      type: "check",
    });
    expect(records).toHaveLength(2);
    expect(records[0]?.error).toBeDefined();
    expect(records[0]).toMatchObject({
      apiCall: false,
      choice: "fold",
      sizingScore: null,
      bluffIntent: null,
    });
    expect(records[1]?.error).toBeDefined();
    expect(records[1]?.choice).toBe("check_or_call");
  });

  it("counts a failed typesafe request as an api call", async () => {
    const records: AgentDecision[] = [];
    const backend: JevBackend = {
      kind: "typesafe",
      systemOne: () => Promise.reject(new Error("offline")),
    };
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      onDecision: (r) => records.push(r),
    });
    expect(await agent.decide(view, legal)).toEqual({ type: "fold" });
    expect(records[0]).toMatchObject({
      apiCall: true,
      error: "Error: offline",
      choice: "fold",
      sizingScore: null,
      bluffIntent: null,
      probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0 },
    });
    // A decision that fell back carries no model and no diagnostics.
    expect("model" in (records[0] as AgentDecision)).toBe(false);
    expect("equityVsRandomPct" in (records[0] as AgentDecision)).toBe(false);
  });
});

describe("JevAgent with the preflop chart", () => {
  it("never calls the backend preflop and still asks Jev after the flop", async () => {
    const { backend, requests } = spyBackend();
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      preflop: "chart",
      onDecision: (r) => records.push(r),
    });
    // AKs on the button: chart open
    expect(await agent.decide(preflopView, open)).toEqual({ type: "raise", amount: 250 });
    expect(requests).toHaveLength(0);
    expect(records[0]).toMatchObject({
      street: "preflop",
      model: "chart",
      choice: "bet_or_raise",
      action: { type: "raise", amount: 250 },
      probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 1 },
      sizingScore: null,
      bluffIntent: null,
      apiCall: false,
      myBetWasRaised: false,
    });
    expect(records[0]?.equityVsRandomPct).toBeGreaterThan(50);
    await agent.decide({ ...view, stacks: twoSeats }, legal);
    expect(requests).toHaveLength(1);
    expect(records[1]?.model).toBe("mock");
  });

  it("folds trash from the chart and labels the record accordingly", async () => {
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend: createMockBackend(),
      seed: 1,
      preflop: "chart",
      onDecision: (r) => records.push(r),
    });
    const trash = { ...preflopView, holeCards: parseCards("7h 2d") };
    expect(await agent.decide(trash, open)).toEqual({ type: "fold" });
    expect(records[0]).toMatchObject({ choice: "fold", probabilities: { fold: 1 } });
  });

  it("asks Jev preflop by default", async () => {
    const { backend, requests } = spyBackend();
    const agent = new JevAgent({ persona: getPersona("tag"), backend, seed: 1, preflop: "jev" });
    await agent.decide(preflopView, open);
    expect(requests).toHaveLength(1);
  });
});

describe("JevAgent options", () => {
  it("sends the persona, the unified format and no model by default", async () => {
    const { backend, requests } = spyBackend();
    const agent = new JevAgent({ persona: getPersona("lag"), backend, seed: 1 });
    await agent.decide(preflopView, open);
    const state = stateOf(requests[0]);
    expect(state.task).toBe(TASK);
    expect(state.persona).toEqual({
      name: getPersona("lag").name.en,
      description: getPersona("lag").description.en,
    });
    expect(sizingCriteriaOf(requests[0])).toEqual(SIZING_RUBRIC);
    expect(requests[0]?.model).toBeUndefined();
    expect("equityVsRangePct" in state.hand).toBe(false);
    expect("opponentStats" in state.table).toBe(false);
  });

  it("promptStyle split changes both the state and the questions", async () => {
    const { backend, requests } = spyBackend();
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      promptStyle: "split",
    });
    await agent.decide(preflopView, open);
    await agent.decide({ ...view, stacks: twoSeats }, legal);
    expect(stateOf(requests[0]).task).toBe(PREFLOP_TASK);
    expect(sizingCriteriaOf(requests[0])).toEqual(PREFLOP_SIZING_RUBRIC);
    expect(stateOf(requests[1]).task).toBe(POSTFLOP_TASK);
    expect(sizingCriteriaOf(requests[1])).toEqual(SIZING_RUBRIC);
  });

  it("rangeEquity adds the feature to the state and to the record", async () => {
    const { backend, requests } = spyBackend();
    const records: AgentDecision[] = [];
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      rangeEquity: true,
      onDecision: (r) => records.push(r),
    });
    await agent.decide(preflopView, open);
    const state = stateOf(requests[0]);
    expect(state.hand.equityVsRangePct).toBeTypeOf("number");
    expect(state.importantContext.some((l) => l.includes("equityVsRangePct"))).toBe(true);
    expect(records[0]?.equityVsRangePct).toBe(state.hand.equityVsRangePct);
  });

  it("opponentStatsFor adds the session statistics of live opponents", async () => {
    const { backend, requests } = spyBackend();
    const stats: OpponentStats = { hands: 30, vpipPct: 45, pfrPct: 5, postflopAggressionPct: 20 };
    const agent = new JevAgent({
      persona: getPersona("tag"),
      backend,
      seed: 1,
      opponentStatsFor: (seat) => (seat === 1 ? stats : null),
    });
    await agent.decide(preflopView, open);
    expect(stateOf(requests[0]).table.opponentStats).toEqual([{ seat: 1, ...stats }]);
  });

  it("forwards the model", async () => {
    const { backend, requests } = spyBackend();
    const agent = new JevAgent({ persona: getPersona("tag"), backend, seed: 1, model: "jev-x" });
    await agent.decide(preflopView, open);
    expect(requests[0]?.model).toBe("jev-x");
  });
});
