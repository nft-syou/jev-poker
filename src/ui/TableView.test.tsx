// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HandSnapshot, LegalActions } from "../engine/types";
import { initI18n } from "../i18n";
import { EMPTY_FX, type TableFx } from "./fx";
import { TableView } from "./TableView";
import type { GameController, GameSeat } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.classList.remove("showcase");
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

/** An effects slice with something in the feed, so the strip has a reason to be up. */
const FEED_FX: TableFx = {
  ...EMPTY_FX,
  feed: [
    { id: 1, type: "street", street: "flop", at: 10 },
    { id: 2, type: "action", seat: 1, kind: "raise", amount: 12, at: 11 },
  ],
};

const LEGAL: LegalActions = {
  canFold: true,
  canCheck: true,
  callAmount: null,
  minRaiseTo: 4,
  maxRaiseTo: 198,
};

function controller(overrides: Partial<GameController["state"]> = {}): GameController {
  return {
    state: {
      snapshot: SNAPSHOT,
      seats: SEATS,
      log: [],
      thinkingSeat: null,
      paused: false,
      pauseReason: null,
      handsPlayed: 0,
      gameOver: false,
      error: null,
      stats: {},
      prefetch: { started: 0, hits: 0, misses: 0 },
      lastDecision: null,
      maxPot: 0,
      fx: EMPTY_FX,
      ...overrides,
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

function renderTable(
  overrides: Partial<GameController["state"]> = {},
  extraProps: Partial<{ prefetch: boolean; onPrefetchChange: (prefetch: boolean) => void }> = {},
) {
  return render(
    <TableView
      game={controller(overrides)}
      speed="normal"
      startingStack={200}
      language="en"
      onSpeedChange={() => {}}
      onLeave={() => {}}
      {...extraProps}
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

  it("swaps the side column for the recording layout and leaves it on Escape", () => {
    stubViewport(false);
    const { container } = renderTable();
    expect(document.body.classList.contains("showcase")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Recording mode" }));
    // The body class is what hides the app chrome around the table.
    expect(document.body.classList.contains("showcase")).toBe(true);
    expect(container.querySelector(".showcase-panel")).not.toBeNull();
    expect(container.querySelector(".ticker")).not.toBeNull();
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(screen.getByText("Powered by TypeSafe Jev")).toBeInTheDocument();
    // Everything that is not the table itself steps aside.
    expect(screen.queryByRole("heading", { name: "Hand history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave table" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stats" })).not.toBeInTheDocument();
    // The speed and pause controls survive, because a recording still needs steering.
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.classList.contains("showcase")).toBe(false);
    expect(container.querySelector(".showcase-panel")).toBeNull();
    expect(screen.getByRole("button", { name: "Leave table" })).toBeInTheDocument();
  });

  it("bubbles the thinking seat only while recording", () => {
    stubViewport(false);
    const { container } = renderTable({ thinkingSeat: 1 });
    expect(container.querySelector(".showcase-bubble")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Recording mode" }));
    const bubble = container.querySelector(".showcase-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.getAttribute("data-seat")).toBe("1");
    expect(screen.getByText("Jev thinking…")).toBeInTheDocument();
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

  it("shows the prefetch-on toggle and flips the setting off when clicked", () => {
    stubViewport(false);
    const onPrefetchChange = vi.fn();
    renderTable({}, { prefetch: true, onPrefetchChange });

    const button = screen.getByRole("button", { name: "⚡ Prefetch on" });
    fireEvent.click(button);
    expect(onPrefetchChange).toHaveBeenCalledWith(false);
  });

  it("shows the prefetch-off toggle and flips the setting on when clicked", () => {
    stubViewport(false);
    const onPrefetchChange = vi.fn();
    renderTable({}, { prefetch: false, onPrefetchChange });

    const button = screen.getByRole("button", { name: "Prefetch off" });
    fireEvent.click(button);
    expect(onPrefetchChange).toHaveBeenCalledWith(true);
  });

  it("hides the prefetch toggle when no onPrefetchChange is supplied", () => {
    stubViewport(false);
    renderTable();
    expect(screen.queryByRole("button", { name: "⚡ Prefetch on" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prefetch off" })).not.toBeInTheDocument();
  });

  it("draws each seat's bet as chips out on the felt", () => {
    stubViewport(false);
    const { container } = renderTable();
    // One stack per seat with chips in front of it, plus the pot's own stack.
    expect(container.querySelectorAll(".bet-stack")).toHaveLength(2);
    expect(container.querySelector(".chip-stack.pot")).not.toBeNull();
    expect(screen.getByText("Pot: 3")).toBeInTheDocument();
    // The old number pill is gone.
    expect(container.querySelector(".seat-bet")).toBeNull();
  });

  it("flies the chips of whatever the effects layer recorded", () => {
    stubViewport(false);
    const { container } = renderTable({
      fx: {
        ...EMPTY_FX,
        chipMoves: [{ id: 1, seat: 1, kind: "toBet", amount: 6, at: 10 }],
        callouts: [{ id: 2, seat: 1, kind: "raise", amount: 12, at: 10 }],
        winners: [0],
        winnersAt: 11,
      },
    });
    expect(container.querySelectorAll(".chip-fly")).toHaveLength(1);
    expect(screen.getByText("RAISE 6 BB")).toBeInTheDocument();
    expect(container.querySelector(".winner-glow")).not.toBeNull();
  });

  it("keeps every flight inside the felt's clipping layer", () => {
    // A flight is a felt-sized box translated by tens of percent. Left loose on the felt it
    // reached past the page, grew the scrollable area and made the layout jump sideways on
    // every bet, so each one must sit inside the single `.fx-layer` that clips them.
    stubViewport(false);
    const { container } = renderTable({
      fx: {
        ...EMPTY_FX,
        chipMoves: [
          { id: 1, seat: 1, kind: "toBet", amount: 6, at: 10 },
          { id: 2, seat: 0, kind: "toSeat", amount: 40, at: 11 },
        ],
      },
    });
    const layers = container.querySelectorAll(".felt > .fx-layer");
    expect(layers).toHaveLength(1);
    const flights = container.querySelectorAll(".chip-fly");
    expect(flights).toHaveLength(2);
    for (const flight of flights) {
      expect(flight.parentElement).toBe(layers[0]);
    }
    expect(container.querySelectorAll(".felt > .chip-fly")).toHaveLength(0);
  });

  it("puts the action feed under the felt on a wide screen", () => {
    stubViewport(false);
    const { container } = renderTable({ fx: FEED_FX });
    const feed = container.querySelector(".action-feed");
    expect(feed).not.toBeNull();
    expect(screen.getByText("Flop")).toBeInTheDocument();
    // Decoration next to the hand history, which is the readable record.
    expect(feed).toHaveAttribute("aria-hidden", "true");
  });

  it("throws every callout inwards, whichever rail its seat is on", () => {
    stubViewport(false);
    // The human seat anchors the bottom of the table and the other seat faces it.
    const { container } = renderTable({
      fx: {
        ...EMPTY_FX,
        callouts: [
          { id: 1, seat: 0, kind: "check", amount: 0, at: 10 },
          { id: 2, seat: 1, kind: "bet", amount: 12, at: 11 },
        ],
      },
    });
    const spots = [...container.querySelectorAll(".callout-spot")] as HTMLElement[];
    expect(spots).toHaveLength(2);
    const inY = spots.map((spot) => Number(spot.style.getPropertyValue("--in-y")));
    // Opposite rails point opposite ways, and neither points nowhere.
    expect(inY[0]).toBeLessThan(0);
    expect(inY[1]).toBeGreaterThan(0);
    // Nothing places itself below its seat any more: every label sits in a placed wrapper.
    expect(container.querySelectorAll(".callout")).toHaveLength(2);
    for (const callout of container.querySelectorAll(".callout")) {
      expect(callout.parentElement?.classList.contains("callout-spot")).toBe(true);
    }
  });

  it("empties the middle as soon as the pot has been paid out", () => {
    stubViewport(false);
    const { container } = renderTable({
      fx: { ...EMPTY_FX, potPaid: true, winners: [0], winnersAt: 12 },
    });
    // The snapshot still says 3 — the engine keeps `contributed` until the next hand — but
    // the chips have flown to the winner, so the felt shows an empty middle counting down.
    expect(screen.getByText("Pot: 0")).toBeInTheDocument();
    expect(screen.queryByText("Pot: 3")).not.toBeInTheDocument();
    expect(container.querySelector(".chip-stack.pot")).toBeNull();
    // And nothing is left in front of the seats either.
    expect(container.querySelectorAll(".bet-stack")).toHaveLength(0);
  });

  it("follows the snapshot's pot again once the next hand has started", () => {
    stubViewport(false);
    const { container } = renderTable({ fx: { ...EMPTY_FX, potPaid: false } });
    expect(screen.getByText("Pot: 3")).toBeInTheDocument();
    expect(container.querySelector(".chip-stack.pot")).not.toBeNull();
    expect(container.querySelectorAll(".bet-stack")).toHaveLength(2);
  });

  it("keeps the feed off a phone until the table is being recorded", () => {
    stubViewport(true);
    const { container } = renderTable({ fx: FEED_FX });
    expect(container.querySelector(".action-feed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Recording mode" }));
    expect(container.querySelector(".action-feed")).not.toBeNull();
  });

  it("shows the billing pause notice only while paused for billing", () => {
    stubViewport(false);
    renderTable({ paused: true, pauseReason: "billing" });
    expect(screen.getByText("Paused: TypeSafe credit exhausted")).toBeInTheDocument();
  });

  it("hides the billing pause notice when there is no pause reason", () => {
    stubViewport(false);
    renderTable({ paused: false, pauseReason: null });
    expect(screen.queryByText("Paused: TypeSafe credit exhausted")).not.toBeInTheDocument();
  });

  it("hides the prefetch toggle and the billing notice in recording mode", () => {
    stubViewport(false);
    const onPrefetchChange = vi.fn();
    renderTable({ paused: true, pauseReason: "billing" }, { prefetch: true, onPrefetchChange });

    // Both controls are present in the normal header...
    expect(screen.getByRole("button", { name: "⚡ Prefetch on" })).toBeInTheDocument();
    expect(screen.getByText("Paused: TypeSafe credit exhausted")).toBeInTheDocument();

    // ...but recording mode's header only keeps the speed select, the pause/resume button and
    // the exit control; the prefetch toggle and the billing badge step aside with everything
    // else that isn't the table itself.
    fireEvent.click(screen.getByRole("button", { name: "Recording mode" }));
    expect(screen.queryByRole("button", { name: "⚡ Prefetch on" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prefetch off" })).not.toBeInTheDocument();
    expect(screen.queryByText("Paused: TypeSafe credit exhausted")).not.toBeInTheDocument();
    // The pause/resume control itself survives recording mode, same as before.
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});
