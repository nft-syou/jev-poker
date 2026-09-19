// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HandSnapshot, LegalActions } from "../engine/types";
import { initI18n } from "../i18n";
import { TableView } from "./TableView";
import type { GameController, GameSeat } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SEATS: GameSeat[] = [
  { id: 0, name: "You", kind: "human", stack: 200 },
  { id: 1, name: "Rocky", kind: "cpu", stack: 200 },
];

const SNAPSHOT: HandSnapshot = {
  handNumber: 0,
  button: 1,
  street: "preflop",
  board: [],
  players: [
    {
      seat: 0,
      stack: 198,
      holeCards: [
        { rank: 14, suit: "s" },
        { rank: 13, suit: "s" },
      ],
      contributed: 2,
      streetBet: 2,
      folded: false,
      allIn: false,
    },
    {
      seat: 1,
      stack: 199,
      holeCards: [
        { rank: 7, suit: "d" },
        { rank: 2, suit: "c" },
      ],
      contributed: 1,
      streetBet: 1,
      folded: false,
      allIn: false,
    },
  ],
  actingSeat: 0,
  toAct: [0, 1],
  currentBet: 2,
  minRaise: 2,
  bigBlind: 2,
  pot: 3,
  complete: false,
};

const LEGAL: LegalActions = {
  canFold: true,
  canCheck: true,
  callAmount: null,
  minRaiseTo: 4,
  maxRaiseTo: 198,
};

function controller(): GameController {
  return {
    state: {
      snapshot: SNAPSHOT,
      seats: SEATS,
      log: [],
      thinkingSeat: null,
      paused: false,
      handsPlayed: 0,
      gameOver: false,
      error: null,
      stats: {},
      prefetch: { started: 0, hits: 0, misses: 0 },
      lastDecision: null,
      maxPot: 0,
    },
    humanSeats: [0],
    spectator: false,
    legalForHuman: LEGAL,
    humanAct: () => {},
    togglePause: () => {},
    cumulative: {},
    statsKeys: { 0: "human:You", 1: "persona:rock" },
    resetCumulative: () => {},
  };
}

/** jsdom ships no `matchMedia`; stub one that reports the width we want to test. */
function stubViewport(phone: boolean): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: phone,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderTable() {
  return render(
    <TableView
      game={controller()}
      speed="normal"
      startingStack={200}
      language="en"
      onSpeedChange={() => {}}
      onLeave={() => {}}
    />,
  );
}

describe("TableView", () => {
  it("shows one panel at a time behind a tab bar on a phone", () => {
    stubViewport(true);
    const { container } = renderTable();

    expect(container.querySelector(".tab-bar")).not.toBeNull();
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Hand history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Statistics" })).not.toBeInTheDocument();
    // The action bar sits above the tabs and does not belong to any one panel.
    expect(screen.getByText("Your turn")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getByRole("heading", { name: "Statistics" })).toBeInTheDocument();
    expect(container.querySelector(".felt")).toBeNull();
    expect(screen.getByText("Your turn")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByRole("heading", { name: "Hand history" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Statistics" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(container.querySelector(".felt")).not.toBeNull();
  });

  it("keeps the felt and one side panel on a wide screen", () => {
    stubViewport(false);
    const { container } = renderTable();

    expect(container.querySelector(".tab-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Table" })).not.toBeInTheDocument();
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Hand history" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Statistics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hand history" })).not.toBeInTheDocument();
  });
});
