// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../i18n";
import type { DecisionFeatures } from "../jev/features";
import { DecisionBubble } from "./DecisionBubble";
import type { DecisionInfo } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const FEATURES = {
  task: "decide",
  persona: { name: "LAG", description: "loose aggressive" },
  importantContext: [],
  hand: {
    street: "flop",
    holeCards: ["Ah", "Kh"],
    board: ["Qh", "7h", "2c"],
    madeHand: "high_card",
    draws: ["flush_draw"],
    preflopStrength: "premium",
  },
  table: {
    position: "BTN",
    playersInHand: 2,
    playersToAct: 1,
    potBB: 9,
    toCallBB: 3,
    potOddsPct: 25,
    effectiveStackBB: 100,
    stacksBB: [],
  },
  history: [],
} satisfies DecisionFeatures;

function decision(overrides: Partial<DecisionInfo> = {}): DecisionInfo {
  return {
    seat: 1,
    action: { type: "raise", amount: 24 },
    jev: {
      chosen: "bet_or_raise",
      probabilities: { fold: 0.2, check_or_call: 0.5, bet_or_raise: 0.3 },
      sizingScore: 3,
      bluffIntent: 0.42,
      model: "jev-latest",
    },
    error: null,
    errorKind: null,
    fallback: false,
    latencyMs: 640,
    prefetched: false,
    ...overrides,
  };
}

function renderBubble(props: Partial<Parameters<typeof DecisionBubble>[0]> = {}) {
  return render(
    <DecisionBubble
      seat={1}
      personaName="LAG"
      thinking={false}
      decision={null}
      features={FEATURES}
      bigBlind={2}
      visibleUntil={null}
      {...props}
    />,
  );
}

describe("DecisionBubble", () => {
  it("announces the persona while Jev is thinking", () => {
    renderBubble({ thinking: true });
    expect(screen.getByText("LAG")).toBeInTheDocument();
    expect(screen.getByText("Jev thinking…")).toBeInTheDocument();
  });

  it("shows the action and one bar per label, sized by probability", () => {
    const { container } = renderBubble({ decision: decision() });

    // 24 chips at a big blind of 2 is a raise to 12 BB.
    expect(screen.getByText("RAISE to 12 BB")).toBeInTheDocument();
    const bars = container.querySelectorAll(".showcase-bar-fill");
    expect(bars).toHaveLength(3);
    expect([...bars].map((bar) => (bar as HTMLElement).style.width)).toEqual(["20%", "50%", "30%"]);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("640 ms")).toBeInTheDocument();
    expect(screen.queryByText("⚡ prefetched")).not.toBeInTheDocument();
  });

  it("badges a prefetched answer instead of its latency", () => {
    renderBubble({ decision: decision({ prefetched: true }) });
    expect(screen.getByText("⚡ prefetched")).toBeInTheDocument();
    expect(screen.queryByText("640 ms")).not.toBeInTheDocument();
  });

  it("says so when Jev could not answer", () => {
    renderBubble({
      decision: decision({ jev: null, fallback: true, action: { type: "check" } }),
    });
    expect(screen.getByText("CHECK")).toBeInTheDocument();
    expect(screen.getByText("Jev was unavailable")).toBeInTheDocument();
  });

  it("renders nothing without a decision or a thinking seat", () => {
    const { container } = renderBubble();
    expect(container.firstChild).toBeNull();
  });
});
