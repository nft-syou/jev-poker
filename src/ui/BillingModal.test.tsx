// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { BillingModal } from "./BillingModal";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

describe("BillingModal", () => {
  it("renders nothing when closed", () => {
    render(<BillingModal open={false} onResume={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the billing texts and a link to top up", () => {
    render(<BillingModal open={true} onResume={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("TypeSafe credit exhausted")).toBeInTheDocument();
    expect(
      screen.getByText(
        "TypeSafe returned 402 Payment Required, so the CPUs cannot ask Jev. Top up your TypeSafe account, then press Resume.",
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Top up at typesafe.ai" });
    expect(link).toHaveAttribute("href", "https://typesafe.ai");
  });

  it("calls onResume and onClose from their buttons", () => {
    const onResume = vi.fn();
    const onClose = vi.fn();
    render(<BillingModal open={true} onResume={onResume} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
