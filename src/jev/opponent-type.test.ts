import type {
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { JevBackend } from "./backend";
import {
  buildClassifyQuestions,
  classifyByThresholds,
  classifyWithJev,
  MIN_HANDS_FOR_TYPE,
  OPPONENT_TYPE_GUIDANCE,
  OPPONENT_TYPES,
  OPPONENT_TYPES_INTRO,
  type OpponentStats,
  type OpponentType,
} from "./opponent-type";

const ALL_TYPES: readonly OpponentType[] = ["calling_station", "nit", "maniac", "regular"];

const stats = (
  vpipPct: number,
  pfrPct: number,
  postflopAggressionPct: number,
  hands = 100,
): OpponentStats => ({ hands, vpipPct, pfrPct, postflopAggressionPct });

describe("opponent type tables", () => {
  it("describes exactly the four types, and has a guidance entry for each", () => {
    expect(Object.keys(OPPONENT_TYPES).sort()).toEqual([...ALL_TYPES].sort());
    expect(Object.keys(OPPONENT_TYPE_GUIDANCE).sort()).toEqual([...ALL_TYPES].sort());
    for (const type of ALL_TYPES) {
      expect(OPPONENT_TYPES[type].length).toBeGreaterThan(0);
      expect(type in OPPONENT_TYPE_GUIDANCE).toBe(true);
    }
  });

  it("gives advice for every type but `regular`, and each line names its own type", () => {
    expect(OPPONENT_TYPE_GUIDANCE.regular).toBeNull();
    for (const type of ALL_TYPES.filter((t) => t !== "regular")) {
      const line = OPPONENT_TYPE_GUIDANCE[type];
      expect(line).toBeTypeOf("string");
      expect(line).toContain(`Against a ${type}`);
      for (const other of ALL_TYPES.filter((t) => t !== type && t !== "regular")) {
        expect(line).not.toContain(`Against a ${other}`);
      }
    }
  });

  it("introduces the field by the name it has in the state", () => {
    expect(OPPONENT_TYPES_INTRO.startsWith("opponentTypes ")).toBe(true);
    expect(MIN_HANDS_FOR_TYPE).toBe(20);
  });
});

describe("classifyByThresholds", () => {
  it("names the obvious profiles", () => {
    expect(classifyByThresholds(stats(100, 0, 0))).toBe("calling_station"); // the `caller` bot
    expect(classifyByThresholds(stats(11, 8, 30))).toBe("nit");
    expect(classifyByThresholds(stats(45, 40, 30))).toBe("maniac");
    expect(classifyByThresholds(stats(60, 20, 55))).toBe("maniac");
    expect(classifyByThresholds(stats(22, 17, 35))).toBe("regular");
  });

  it("gives no type below 20 hands, whatever the numbers say", () => {
    for (const s of [stats(100, 0, 0), stats(11, 8, 30), stats(45, 40, 30), stats(22, 17, 35)]) {
      expect(classifyByThresholds({ ...s, hands: 19 })).toBeNull();
      expect(classifyByThresholds({ ...s, hands: 0 })).toBeNull();
      expect(classifyByThresholds({ ...s, hands: 20 })).not.toBeNull();
    }
  });

  it("is a maniac from a 35% preflop raise on", () => {
    expect(classifyByThresholds(stats(30, 35, 0))).toBe("maniac");
    expect(classifyByThresholds(stats(30, 34, 0))).toBe("regular");
  });

  it("is a maniac from 50% VPIP together with 50% postflop aggression on", () => {
    expect(classifyByThresholds(stats(50, 20, 50))).toBe("maniac");
    expect(classifyByThresholds(stats(49, 20, 50))).toBe("regular");
    expect(classifyByThresholds(stats(50, 20, 49))).toBe("regular");
    // Postflop aggression alone is not enough.
    expect(classifyByThresholds(stats(25, 20, 90))).toBe("regular");
  });

  it("is a calling station from 45% VPIP with at most a 15% preflop raise", () => {
    expect(classifyByThresholds(stats(45, 15, 20))).toBe("calling_station");
    expect(classifyByThresholds(stats(44, 15, 20))).toBe("regular");
    expect(classifyByThresholds(stats(45, 16, 20))).toBe("regular");
  });

  it("is a nit up to 18% VPIP", () => {
    expect(classifyByThresholds(stats(18, 10, 30))).toBe("nit");
    expect(classifyByThresholds(stats(19, 10, 30))).toBe("regular");
    expect(classifyByThresholds(stats(0, 0, 0))).toBe("nit");
  });

  it("checks the maniac rule first: a loose passive preflop player who fires postflop is a maniac", () => {
    expect(classifyByThresholds(stats(60, 10, 55))).toBe("maniac");
    expect(classifyByThresholds(stats(60, 10, 49))).toBe("calling_station");
  });

  it("does not look at foldToBetPct", () => {
    expect(classifyByThresholds({ ...stats(22, 17, 35), foldToBetPct: 0 })).toBe("regular");
    expect(classifyByThresholds({ ...stats(22, 17, 35), foldToBetPct: 100 })).toBe("regular");
  });
});

interface Seen {
  request: SystemOneRequest<Questions>;
  options: RequestOptions | undefined;
}

/** A backend that answers `opponent_type` with a fixed choice and remembers what it was sent. */
function answering(answer: string): JevBackend & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    kind: "mock",
    seen,
    async systemOne<const Q extends Questions>(
      request: SystemOneRequest<Q>,
      options?: RequestOptions,
    ) {
      seen.push({ request: request as unknown as SystemOneRequest<Questions>, options });
      return {
        model: "stub",
        answers: {
          opponent_type: { type: "choice", choice: answer, confidence: 1, probabilities: {} },
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

describe("buildClassifyQuestions", () => {
  it("is one choice question over exactly the four types", () => {
    const questions = buildClassifyQuestions();
    expect(Object.keys(questions)).toEqual(["opponent_type"]);
    expect(questions.opponent_type.type).toBe("choice");
    expect(questions.opponent_type.criteria).toEqual(OPPONENT_TYPES);
    expect(Object.keys(questions.opponent_type.criteria).sort()).toEqual([...ALL_TYPES].sort());
  });
});

describe("classifyWithJev", () => {
  const known: OpponentStats = { ...stats(62, 4, 12, 40), foldToBetPct: 9 };

  it("returns the type Jev chose, for each of the four", async () => {
    for (const type of ALL_TYPES) {
      expect(await classifyWithJev(answering(type), known)).toBe(type);
    }
  });

  it("sends the statistics as state.opponent with a choice question over the four types", async () => {
    const backend = answering("calling_station");
    await classifyWithJev(backend, known);
    expect(backend.seen).toHaveLength(1);
    const { request, options } = backend.seen[0] as Seen;
    const state = request.state as unknown as {
      task: string;
      importantContext: string[];
      opponent: OpponentStats;
    };
    expect(state.opponent).toEqual(known);
    expect(state.task.length).toBeGreaterThan(0);
    // Every number that is sent is explained.
    for (const field of ["vpipPct", "pfrPct", "postflopAggressionPct", "foldToBetPct"]) {
      expect(state.importantContext.some((l) => l.startsWith(`${field}:`))).toBe(true);
    }
    expect(Object.keys(request.questions)).toEqual(["opponent_type"]);
    const question = request.questions.opponent_type as {
      type: string;
      criteria: Record<string, string>;
    };
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria).sort()).toEqual([...ALL_TYPES].sort());
    // No model and no request options unless asked for.
    expect("model" in request).toBe(false);
    expect(options).toBeUndefined();
  });

  it("leaves foldToBetPct out of the state when the player never faced a bet", async () => {
    const backend = answering("nit");
    const bare = stats(10, 5, 20, 30);
    await classifyWithJev(backend, bare);
    const state = backend.seen[0]?.request.state as unknown as { opponent: OpponentStats };
    expect(state.opponent).toEqual(bare);
    expect("foldToBetPct" in state.opponent).toBe(false);
  });

  it("does not hand the caller's object to the backend", async () => {
    const backend = answering("nit");
    await classifyWithJev(backend, known);
    const state = backend.seen[0]?.request.state as unknown as { opponent: OpponentStats };
    expect(state.opponent).not.toBe(known);
  });

  it("forwards the model and the abort signal when given", async () => {
    const backend = answering("maniac");
    const controller = new AbortController();
    await classifyWithJev(backend, known, { model: "jev-x", signal: controller.signal });
    expect(backend.seen[0]?.request.model).toBe("jev-x");
    expect(backend.seen[0]?.options?.signal).toBe(controller.signal);
  });

  it("returns null below 20 hands without calling the backend", async () => {
    const backend = answering("maniac");
    expect(await classifyWithJev(backend, { ...known, hands: 19 })).toBeNull();
    expect(await classifyWithJev(backend, { ...known, hands: 0 })).toBeNull();
    expect(backend.seen).toHaveLength(0);
    expect(await classifyWithJev(backend, { ...known, hands: 20 })).toBe("maniac");
    expect(backend.seen).toHaveLength(1);
  });

  it("returns null on an answer that is not one of the types", async () => {
    expect(await classifyWithJev(answering("shark"), known)).toBeNull();
    expect(await classifyWithJev(answering(""), known)).toBeNull();
    expect(await classifyWithJev(answering("Maniac"), known)).toBeNull();
  });

  it("does not take an inherited object key for a type", async () => {
    expect(await classifyWithJev(answering("toString"), known)).toBeNull();
    expect(await classifyWithJev(answering("constructor"), known)).toBeNull();
  });

  it("returns null instead of throwing when the backend throws or answers nothing", async () => {
    let calls = 0;
    const throwing: JevBackend = {
      kind: "mock",
      async systemOne<const Q extends Questions>(): Promise<SystemOneResult<Q>> {
        calls += 1;
        throw new Error("backend down");
      },
    };
    await expect(classifyWithJev(throwing, known)).resolves.toBeNull();
    expect(calls).toBe(1);
    const synchronous: JevBackend = {
      kind: "mock",
      systemOne<const Q extends Questions>(): Promise<SystemOneResult<Q>> {
        throw new Error("backend down before the promise");
      },
    };
    await expect(classifyWithJev(synchronous, known)).resolves.toBeNull();
    const empty: JevBackend = {
      kind: "mock",
      async systemOne<const Q extends Questions>() {
        return { model: "stub", answers: {}, usage: {} } as unknown as SystemOneResult<Q>;
      },
    };
    await expect(classifyWithJev(empty, known)).resolves.toBeNull();
  });
});
