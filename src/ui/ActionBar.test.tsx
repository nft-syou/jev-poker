// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegalActions } from "../engine/types";
import { initI18n } from "../i18n";
import { ActionBar } from "./ActionBar";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

/** Flop, 60 in the pot, a bet of 30 to call: raise window 60-500. */
const FACING_BET: LegalActions = {
  canFold: true,
  canCheck: false,
  callAmount: 30,
  minRaiseTo: 60,
  maxRaiseTo: 500,
};

/** Flop, 60 in the pot, nobody has bet. */
const UNBET: LegalActions = {
  canFold: false,
  canCheck: true,
  callAmount: null,
  minRaiseTo: 2,
  maxRaiseTo: 500,
};

function renderBar(
  legal: LegalActions,
  spot: { currentBet: number; pot: number; preflop?: boolean; bigBlind?: number },
) {
  const onAct = vi.fn();
  render(
    <ActionBar
      legal={legal}
      currentBet={spot.currentBet}
      pot={spot.pot}
      bigBlind={spot.bigBlind ?? 2}
      preflop={spot.preflop ?? false}
      onAct={onAct}
    />,
  );
  return onAct;
}

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("ActionBar", () => {
  it("offers fold, call and raise with a clamped amount", () => {
    const onAct = renderBar(FACING_BET, { currentBet: 30, pot: 90 });
    press("Call 30");
    expect(onAct).toHaveBeenCalledWith({ type: "call" });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5000" } });
    // 5000 is clamped to the maximum (500), and the commit button says what that is.
    press("All in (500)");
    expect(onAct).toHaveBeenLastCalledWith({ type: "allin" });
    press("Fold");
    expect(onAct).toHaveBeenLastCalledWith({ type: "fold" });
  });

  it("offers check and bet when nobody has bet", () => {
    const onAct = renderBar(UNBET, { currentBet: 0, pot: 60 });
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
    press("Check");
    expect(onAct).toHaveBeenCalledWith({ type: "check" });
    press("Bet 2");
    expect(onAct).toHaveBeenLastCalledWith({ type: "bet", amount: 2 });
  });

  it("sets the size from a pot-fraction button without ending the turn", () => {
    const onAct = renderBar(UNBET, { currentBet: 0, pot: 60 });
    press("1/2");
    expect(onAct).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "1/2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("15 BB · 50% of the pot")).toBeInTheDocument();
    press("Bet 30");
    expect(onAct).toHaveBeenLastCalledWith({ type: "bet", amount: 30 });
  });

  it("sizes a raise as a call plus a share of the pot after the call", () => {
    const onAct = renderBar(FACING_BET, { currentBet: 30, pot: 90 });
    press("Pot");
    press("Raise to 150");
    expect(onAct).toHaveBeenLastCalledWith({ type: "raise", amount: 150 });
  });

  it("offers multiples of the bet before the flop", () => {
    const legal = { ...FACING_BET, callAmount: 2, minRaiseTo: 4, maxRaiseTo: 200 };
    const onAct = renderBar(legal, { currentBet: 2, pot: 3, preflop: true });
    expect(screen.queryByRole("button", { name: "1/2" })).toBeNull();
    press("3x");
    press("Raise to 6");
    expect(onAct).toHaveBeenLastCalledWith({ type: "raise", amount: 6 });
  });

  it("makes all-in a size to pick and then confirm, never a one-tap slip", () => {
    const onAct = renderBar(FACING_BET, { currentBet: 30, pot: 90 });
    // No all-in on the row that ends the turn until it has been chosen as the size.
    expect(screen.queryByRole("button", { name: /All in \(/ })).toBeNull();
    press("All in");
    expect(onAct).not.toHaveBeenCalled();
    press("All in (500)");
    expect(onAct).toHaveBeenLastCalledWith({ type: "allin" });
  });

  it("disables the sizes outside the legal window but keeps them in place", () => {
    renderBar({ ...UNBET, minRaiseTo: 10, maxRaiseTo: 35 }, { currentBet: 0, pot: 60 });
    expect(screen.getByRole("button", { name: "1/3" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2/3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pot" })).toBeDisabled();
  });

  it("steps by one big blind inside the window", () => {
    const onAct = renderBar(UNBET, { currentBet: 0, pot: 60 });
    expect(screen.getByRole("button", { name: "One big blind less" })).toBeDisabled();
    press("One big blind more");
    press("One big blind more");
    press("Bet 6");
    expect(onAct).toHaveBeenLastCalledWith({ type: "bet", amount: 6 });
  });

  it("shows no sizing row when the only raise left is a shove", () => {
    const onAct = renderBar(
      { ...FACING_BET, minRaiseTo: 45, maxRaiseTo: 45 },
      { currentBet: 30, pot: 90 },
    );
    expect(screen.queryByLabelText("Amount")).toBeNull();
    expect(screen.queryByRole("button", { name: "Min" })).toBeNull();
    press("All in (45)");
    expect(onAct).toHaveBeenLastCalledWith({ type: "allin" });
  });

  it("stacks the verb over the amount and keeps the sentence as the accessible name", () => {
    renderBar(FACING_BET, { currentBet: 30, pot: 90 });
    const call = screen.getByRole("button", { name: "Call 30" });
    expect(call.querySelector(".act-name")?.textContent).toBe("Call");
    expect(call.querySelector(".act-amount")?.textContent).toBe("30");
    press("All in");
    const shove = screen.getByRole("button", { name: "All in (500)" });
    expect(shove.querySelector(".act-name")?.textContent).toBe("All in");
    expect(shove.querySelector(".act-amount")?.textContent).toBe("500");
  });

  it("has nothing to size when raising is not allowed", () => {
    renderBar({ ...FACING_BET, minRaiseTo: null, maxRaiseTo: null }, { currentBet: 30, pot: 90 });
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Fold", "Call 30"]);
  });
});
