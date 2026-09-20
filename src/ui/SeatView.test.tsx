// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HandPlayerSnapshot } from "../engine/types";
import { initI18n } from "../i18n";
import type { Callout, CalloutKind } from "./fx";
import { SeatView } from "./SeatView";
import type { GameSeat } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const SEAT: GameSeat = { id: 1, name: "Lars", kind: "cpu", stack: 200 };

const PLAYER: HandPlayerSnapshot = {
  seat: 1,
  stack: 188,
  holeCards: [
    { rank: 14, suit: "s" },
    { rank: 13, suit: "s" },
  ],
  contributed: 12,
  streetBet: 12,
  folded: false,
  allIn: false,
};

function callout(kind: CalloutKind, amount = 0): Callout {
  return { id: 7, seat: 1, kind, amount, at: 1000 };
}

function renderSeat(props: Partial<Parameters<typeof SeatView>[0]> = {}) {
  return render(
    <SeatView
      seat={SEAT}
      player={PLAYER}
      isButton={false}
      isActing={false}
      isThinking={false}
      revealCards={true}
      style={{}}
      bigBlind={2}
      {...props}
    />,
  );
}

describe("SeatView callouts", () => {
  it("shouts each kind of action in its own colour", () => {
    const cases: [CalloutKind, number, string][] = [
      ["fold", 0, "FOLD"],
      ["check", 0, "CHECK"],
      ["call", 6, "CALL 3 BB"],
      ["bet", 12, "BET 6 BB"],
      ["raise", 25, "RAISE 12.5 BB"],
      ["allin", 188, "ALL IN"],
    ];
    for (const [kind, amount, text] of cases) {
      const { container, unmount } = renderSeat({ callout: callout(kind, amount) });
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(container.querySelector(`.callout-${kind}`)).not.toBeNull();
      // The seat itself flashes in the same colour as the label.
      expect(container.querySelector(`.seat-flash.flash-${kind}`)).not.toBeNull();
      unmount();
    }
  });

  it("rounds a big-blind amount to a single decimal", () => {
    renderSeat({ callout: callout("raise", 7) });
    expect(screen.getByText("RAISE 3.5 BB")).toBeInTheDocument();
  });

  it("says nothing when the seat has not acted", () => {
    const { container } = renderSeat();
    expect(container.querySelector(".callout")).toBeNull();
    expect(container.querySelector(".seat-flash")).toBeNull();
  });

  it("glows only for a seat that has just won a pot", () => {
    const { container, rerender } = renderSeat();
    expect(container.querySelector(".winner-glow")).toBeNull();

    rerender(
      <SeatView
        seat={SEAT}
        player={PLAYER}
        isButton={false}
        isActing={false}
        isThinking={false}
        revealCards={true}
        style={{}}
        bigBlind={2}
        winnerAt={1234}
      />,
    );
    expect(container.querySelector(".winner-glow")).not.toBeNull();
  });

  it("marks the cards as flipped once a showdown has revealed them", () => {
    const { container, rerender } = renderSeat();
    expect(container.querySelector(".seat-cards.flipping")).toBeNull();

    rerender(
      <SeatView
        seat={SEAT}
        player={PLAYER}
        isButton={false}
        isActing={false}
        isThinking={false}
        revealCards={true}
        style={{}}
        bigBlind={2}
        flipAt={999}
      />,
    );
    expect(container.querySelector(".seat-cards.flipping")).not.toBeNull();
  });

  it("no longer pins a bare number above the seat", () => {
    // The bet lives on the felt now, as chips between the seat and the middle.
    const { container } = renderSeat();
    expect(container.querySelector(".seat-bet")).toBeNull();
  });
});
