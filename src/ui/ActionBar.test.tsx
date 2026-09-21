// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { ActionBar } from "./ActionBar";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

describe("ActionBar", () => {
  it("offers fold, call and raise with a clamped amount", () => {
    const onAct = vi.fn();
    render(
      <ActionBar
        legal={{ canFold: true, canCheck: false, callAmount: 10, minRaiseTo: 20, maxRaiseTo: 100 }}
        currentBet={10}
        onAct={onAct}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Call 10" }));
    expect(onAct).toHaveBeenCalledWith({ type: "call" });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "500" } });
    // 500 is clamped to the maximum (100); raising to the maximum is sent as an all-in.
    fireEvent.click(screen.getByRole("button", { name: /Raise to/ }));
    expect(onAct).toHaveBeenLastCalledWith({ type: "allin" });
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    expect(onAct).toHaveBeenLastCalledWith({ type: "fold" });
  });

  it("offers check and bet when nobody has bet", () => {
    const onAct = vi.fn();
    render(
      <ActionBar
        legal={{ canFold: false, canCheck: true, callAmount: null, minRaiseTo: 10, maxRaiseTo: 90 }}
        currentBet={0}
        onAct={onAct}
      />,
    );
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(onAct).toHaveBeenCalledWith({ type: "check" });
    fireEvent.click(screen.getByRole("button", { name: "Bet 10" }));
    expect(onAct).toHaveBeenLastCalledWith({ type: "bet", amount: 10 });
    fireEvent.click(screen.getByRole("button", { name: "All in (90)" }));
    expect(onAct).toHaveBeenLastCalledWith({ type: "allin" });
  });
});
