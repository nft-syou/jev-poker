import { describe, expect, it } from "vitest";
import type { LegalActions } from "../engine/types";
import { buildQuestions, legalLabels, SIZING_RUBRIC } from "./questions";

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
      legalLabels({
        canFold: true,
        canCheck: false,
        callAmount: 30,
        minRaiseTo: null,
        maxRaiseTo: null,
      }),
    ).toEqual(["fold", "check_or_call"]);
  });
});
