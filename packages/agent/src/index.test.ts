import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// The public surface is a promise to library users; anything new here needs a changeset.
const PUBLIC_VALUES = [
  "ACTION_LABELS",
  "CallerAgent",
  "DEFAULT_MODEL",
  "HeuristicAgent",
  "JevAgent",
  "PRESET_PERSONAS",
  "RandomAgent",
  "RulesAgent",
  "SIZING_RUBRIC",
  "buildFeatures",
  "buildQuestions",
  "chartPreflop",
  "clampVariance",
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
