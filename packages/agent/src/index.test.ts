import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// The public surface is a promise to library users; anything new here needs a changeset.
const PUBLIC_VALUES = [
  "ACTION_LABELS",
  "CallerAgent",
  "DEFAULT_MODEL",
  "HeuristicAgent",
  "JevAgent",
  "MIN_HANDS_FOR_TYPE",
  "OPPONENT_TYPES",
  "OPPONENT_TYPES_INTRO",
  "OPPONENT_TYPE_GUIDANCE",
  "PRESET_PERSONAS",
  "RandomAgent",
  "RulesAgent",
  "SIZING_RUBRIC",
  "buildClassifyQuestions",
  "buildFeatures",
  "buildQuestions",
  "chartPreflop",
  "clampVariance",
  "classifyByThresholds",
  "classifyWithJev",
  "isLosingPlayer",
  "LOSING_PLAYER",
  "createAgent",
  "createMockBackend",
  "createTypeSafeBackend",
  "decideAction",
  "duplicatePersona",
  "fallbackAction",
  "featuresFromView",
  "legalLabels",
  "loadPersonas",
  "personaPrompt",
  "playHand",
  "saveCustomPersonas",
  "sizingToAmount",
].sort();

describe("@jev-poker/agent public surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(api).sort()).toEqual(PUBLIC_VALUES);
  });
});
