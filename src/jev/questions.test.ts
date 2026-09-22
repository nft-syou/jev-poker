import type { LegalActions } from "@jev-poker/engine";
import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  buildQuestions,
  legalLabels,
  PREFLOP_SIZING_RUBRIC,
  SIZING_RUBRIC,
  sizingRubricFor,
} from "./questions";

describe("questions", () => {
  it("offers fold/call/raise when facing a bet", () => {
    const legal: LegalActions = {
      canFold: true,
      canCheck: false,
      callAmount: 10,
      minRaiseTo: 20,
      maxRaiseTo: 100,
    };
    expect(legalLabels(legal)).toEqual(["fold", "check_or_call", "bet_or_raise"]);
    const questions = buildQuestions(legal);
    expect(Object.keys(questions.action.criteria)).toEqual([
      "fold",
      "check_or_call",
      "bet_or_raise",
    ]);
    expect(questions.action.type).toBe("choice");
    expect(questions.sizing.type).toBe("score");
    expect(questions.sizing.criteria).toEqual(SIZING_RUBRIC);
    expect(questions.bluff_intent.type).toBe("noul");
  });

  it("drops fold when checking is free and drops raise when it is impossible", () => {
    expect(
      legalLabels({
        canFold: false,
        canCheck: true,
        callAmount: null,
        minRaiseTo: 10,
        maxRaiseTo: 90,
      }),
    ).toEqual(["check_or_call", "bet_or_raise"]);
    expect(
      Object.keys(
        buildQuestions({
          canFold: false,
          canCheck: true,
          callAmount: null,
          minRaiseTo: 10,
          maxRaiseTo: 90,
        }).action.criteria,
      ),
    ).toEqual(["check_or_call", "bet_or_raise"]);
    expect(
      legalLabels({
        canFold: true,
        canCheck: false,
        callAmount: 30,
        minRaiseTo: null,
        maxRaiseTo: null,
      }),
    ).toEqual(["fold", "check_or_call"]);
    expect(
      Object.keys(
        buildQuestions({
          canFold: true,
          canCheck: false,
          callAmount: 30,
          minRaiseTo: null,
          maxRaiseTo: null,
        }).action.criteria,
      ),
    ).toEqual(["fold", "check_or_call"]);
  });

  it("offers only check_or_call when neither folding nor raising is possible", () => {
    const legal: LegalActions = {
      canFold: false,
      canCheck: true,
      callAmount: null,
      minRaiseTo: null,
      maxRaiseTo: null,
    };
    expect(legalLabels(legal)).toEqual(["check_or_call"]);
    expect(buildQuestions(legal).action.criteria).toEqual({
      check_or_call: ACTION_LABELS.check_or_call,
    });
  });

  it("offers nothing when nothing is legal", () => {
    expect(
      legalLabels({
        canFold: false,
        canCheck: false,
        callAmount: null,
        minRaiseTo: null,
        maxRaiseTo: null,
      }),
    ).toEqual([]);
  });

  it("describes every offered label with its ACTION_LABELS text", () => {
    const questions = buildQuestions({
      canFold: true,
      canCheck: false,
      callAmount: 50,
      minRaiseTo: 200,
      maxRaiseTo: 1000,
    });
    expect(questions.action.criteria).toEqual(ACTION_LABELS);
  });

  it("sizing has 6 labels and bluff is a noul", () => {
    const q = buildQuestions({
      canFold: true,
      canCheck: false,
      callAmount: 50,
      minRaiseTo: 200,
      maxRaiseTo: 1000,
    });
    expect(q.sizing.criteria).toHaveLength(6);
    expect(q.bluff_intent.type).toBe("noul");
  });
});

describe("questions split format", () => {
  const legal: LegalActions = {
    canFold: true,
    canCheck: false,
    callAmount: 50,
    minRaiseTo: 200,
    maxRaiseTo: 1000,
  };

  it("uses a big-blind rubric preflop and the pot rubric postflop, six labels each", () => {
    const pre = buildQuestions(legal, { street: "preflop", style: "split" });
    const post = buildQuestions(legal, { street: "flop", style: "split" });
    const unified = buildQuestions(legal, { street: "preflop", style: "unified" });
    expect(pre.sizing.criteria).toHaveLength(6);
    expect(pre.sizing.criteria).toEqual(PREFLOP_SIZING_RUBRIC);
    expect(pre.sizing.criteria[1]).toContain("2.5 big blinds");
    expect(post.sizing.criteria).toEqual(SIZING_RUBRIC);
    expect(unified.sizing.criteria).toEqual(SIZING_RUBRIC);
    // The street alone changes nothing: without a style the format is unified.
    expect(buildQuestions(legal, { street: "preflop" }).sizing.criteria).toEqual(SIZING_RUBRIC);
    // The action and bluff questions do not depend on the format.
    expect(pre.action).toEqual(unified.action);
    expect(pre.bluff_intent).toEqual(unified.bluff_intent);
  });

  it("has six levels in every rubric, from the minimum to all in", () => {
    for (const rubric of [SIZING_RUBRIC, PREFLOP_SIZING_RUBRIC]) {
      expect(rubric).toHaveLength(6);
      expect(new Set(rubric).size).toBe(6);
      expect(rubric[0]).toContain("minimum");
      expect(rubric[5]).toBe("all in");
    }
  });

  it("picks the preflop rubric only for a split preflop decision", () => {
    expect(sizingRubricFor("preflop", "split")).toBe(PREFLOP_SIZING_RUBRIC);
    for (const street of ["flop", "turn", "river", undefined] as const) {
      expect(sizingRubricFor(street, "split")).toBe(SIZING_RUBRIC);
    }
    expect(sizingRubricFor("preflop", "unified")).toBe(SIZING_RUBRIC);
  });
});
