// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import type { DecisionFeatures } from "../jev/features";
import { DecisionBubble } from "./DecisionBubble";
import type { DecisionInfo } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FEATURES = {
  task: "decide",
  persona: { name: "LAG", description: "loose aggressive" },
  importantContext: [],
  hand: {
    street: "flop",
    holeCards: "Ah Kh",
    board: "Qh 7h 2c",
    madeHand: "high_card",
    draws: ["flush_draw"],
    preflopStrength: "premium",
    equityVsRandomPct: 62,
    beatsPctOfHands: 58,
    board_texture: { paired: false, flushPossible: false, straightPossible: false },
  },
  table: {
    position: "BTN",
    playersInHand: 2,
    opponentsNotAllIn: 1,
    potBB: 9,
    toCallBB: 3,
    potOddsPct: 25,
    requiredEquityPct: 25,
    effectiveStackBB: 100,
    stackToPotRatio: 11.1,
    raisesThisStreet: 1,
    myBetWasRaisedThisStreet: false,
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

  it("holds the thinking line for its full moment, then gives way to the decision", () => {
    vi.useFakeTimers();
    const { rerender } = renderBubble({ thinking: true });

    act(() => void vi.advanceTimersByTime(150));
    // Jev answered after 150 ms; the thinking line still owes the eye the rest of its hold.
    rerender(
      <DecisionBubble
        seat={1}
        personaName="LAG"
        thinking={false}
        decision={decision()}
        features={FEATURES}
        bigBlind={2}
        visibleUntil={null}
      />,
    );
    expect(screen.getByText("Jev thinking…")).toBeInTheDocument();
    expect(screen.queryByText("RAISE to 12 BB")).not.toBeInTheDocument();

    // Past the 600 ms hold the bubble must move on by itself, not wait to be unmounted.
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByText("Jev thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("RAISE to 12 BB")).toBeInTheDocument();
  });

  it("releases the hold inside 200 ms at max speed", () => {
    vi.useFakeTimers();
    const { rerender } = renderBubble({ thinking: true, speed: "max" });

    act(() => void vi.advanceTimersByTime(10));
    rerender(
      <DecisionBubble
        seat={1}
        personaName="LAG"
        thinking={false}
        decision={decision()}
        features={FEATURES}
        bigBlind={2}
        visibleUntil={null}
        speed="max"
      />,
    );
    // Max speed has no engine delay at all, so the hold must be short enough that the
    // decision is on screen before the next seat's answer lands.
    act(() => void vi.advanceTimersByTime(190));
    expect(screen.queryByText("Jev thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("RAISE to 12 BB")).toBeInTheDocument();

    // ...and short enough that it clears again well before a second has passed.
    act(() => void vi.advanceTimersByTime(600));
    expect(screen.queryByText("RAISE to 12 BB")).not.toBeInTheDocument();
  });

  it("flashes a prefetched answer through instead of holding it back", () => {
    vi.useFakeTimers();
    const { rerender } = renderBubble({ thinking: true });

    act(() => void vi.advanceTimersByTime(150));
    rerender(
      <DecisionBubble
        seat={1}
        personaName="LAG"
        thinking={false}
        decision={decision({ prefetched: true })}
        features={FEATURES}
        bigBlind={2}
        visibleUntil={null}
      />,
    );
    // No pretend thinking for an answer that was already in hand: the bolt flashes instead.
    expect(screen.queryByText("Jev thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("⚡")).toBeInTheDocument();

    // Just past the 300 ms flash.
    act(() => void vi.advanceTimersByTime(310));
    expect(screen.queryByText("⚡")).not.toBeInTheDocument();
    expect(screen.getByText("RAISE to 12 BB")).toBeInTheDocument();
    expect(screen.getByText("⚡ prefetched")).toBeInTheDocument();
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
