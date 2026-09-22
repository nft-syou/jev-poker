// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { DecisionFeatures } from "@jev-poker/agent";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../i18n";
import { ShowcasePanel } from "./ShowcasePanel";
import type { LastDecision } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const FEATURES = {
  task: "decide",
  persona: { name: "LAG", description: "loose aggressive" },
  importantContext: [],
  hand: {
    street: "turn",
    holeCards: "Ah Kh",
    board: "Qh 7h 2c 3d",
    madeHand: "pair",
    draws: ["flush_draw", "gutshot"],
    preflopStrength: "premium",
    equityVsRandomPct: 55,
    beatsPctOfHands: 70,
    board_texture: { paired: false, flushPossible: false, straightPossible: false },
  },
  table: {
    position: "CO",
    playersInHand: 3,
    opponentsNotAllIn: 2,
    potBB: 18.5,
    toCallBB: 6,
    potOddsPct: 24,
    requiredEquityPct: 24,
    effectiveStackBB: 95,
    stackToPotRatio: 5.1,
    raisesThisStreet: 1,
    myBetWasRaisedThisStreet: false,
    stacksBB: [],
  },
  history: [],
} satisfies DecisionFeatures;

const LAST: LastDecision = {
  seat: 2,
  at: 1000,
  features: FEATURES,
  record: {
    seat: 2,
    action: { type: "raise", amount: 40 },
    jev: {
      chosen: "bet_or_raise",
      probabilities: { fold: 0.1, check_or_call: 0.3, bet_or_raise: 0.6 },
      sizingScore: 2.4,
      bluffIntent: 0.35,
      model: "jev-latest",
    },
    error: null,
    errorKind: null,
    fallback: false,
    latencyMs: 820,
    prefetched: false,
  },
};

import { compactBubble } from "./showcase";

describe("compactBubble", () => {
  it("shortens the bubble only for seats whose felt is below them", () => {
    // Straight down (a seat at 12 o'clock) and the two top seats of a five-handed table.
    expect(compactBubble({ x: 0, y: 1 })).toBe(true);
    expect(compactBubble({ x: 0.59, y: 0.81 })).toBe(true);
    // Side seats and the bottom seat have room above them.
    expect(compactBubble({ x: 1, y: 0 })).toBe(false);
    expect(compactBubble({ x: 0.95, y: 0.31 })).toBe(false);
    expect(compactBubble({ x: 0, y: -1 })).toBe(false);
  });
});

describe("ShowcasePanel", () => {
  it("describes the decision Jev just made", () => {
    const { container } = render(
      <ShowcasePanel last={LAST} personaName="LAG" bigBlind={2} model="jev-latest" />,
    );

    expect(screen.getByText("LAG")).toBeInTheDocument();
    expect(screen.getByText(/CO/)).toBeInTheDocument();
    expect(screen.getByText(/Turn/)).toBeInTheDocument();
    expect(screen.getByText("RAISE to 20 BB")).toBeInTheDocument();
    expect(screen.getByText(/Pair/)).toBeInTheDocument();
    expect(screen.getByText(/Flush draw/)).toBeInTheDocument();
    expect(screen.getByText(/Gutshot/)).toBeInTheDocument();
    expect(screen.getByText(/Premium hand/)).toBeInTheDocument();
    expect(screen.getByText("18.5 BB")).toBeInTheDocument();
    expect(screen.getByText("6 BB")).toBeInTheDocument();
    // A sizing score of 2.4 rounds to the "two thirds of the pot" rubric level.
    expect(screen.getByText("Two thirds of the pot")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByText("820 ms")).toBeInTheDocument();
    expect(container.querySelectorAll(".showcase-bar-fill")).toHaveLength(3);
    expect(screen.getByText("Powered by TypeSafe Jev · jev-latest")).toBeInTheDocument();
  });

  it("waits quietly until the first decision lands", () => {
    render(<ShowcasePanel last={null} personaName="" bigBlind={2} model="jev-latest" />);
    expect(screen.getByText("Waiting for the first decision…")).toBeInTheDocument();
    expect(screen.getByText("Powered by TypeSafe Jev · jev-latest")).toBeInTheDocument();
  });
});
