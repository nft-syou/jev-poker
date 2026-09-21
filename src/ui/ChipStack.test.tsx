// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChipStack } from "./ChipStack";
import { MAX_STACK_CHIPS } from "./chips";

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const discs = (container: HTMLElement) => [...container.querySelectorAll(".chip")];

describe("ChipStack", () => {
  it("draws one disc per chip, coloured by denomination", () => {
    // 263 at a blind of 2 is one chip of every tier.
    const { container } = render(<ChipStack amount={263} bigBlind={2} />);
    expect(discs(container).map((chip) => chip.className)).toEqual([
      "chip chip-purple",
      "chip chip-black",
      "chip chip-green",
      "chip chip-red",
      "chip chip-white",
    ]);
  });

  it("prints the amount next to the discs", () => {
    render(<ChipStack amount={48} bigBlind={2} />);
    expect(screen.getByText("48")).toBeInTheDocument();
  });

  it("prefers a caller's label over the raw amount", () => {
    render(<ChipStack amount={48} bigBlind={2} label="Pot: 48" />);
    expect(screen.getByText("Pot: 48")).toBeInTheDocument();
    expect(screen.queryByText("48")).not.toBeInTheDocument();
  });

  it("never draws more discs than a stack can carry", () => {
    const { container } = render(<ChipStack amount={20000} bigBlind={2} />);
    expect(discs(container)).toHaveLength(MAX_STACK_CHIPS);
  });

  it("renders nothing when there is nothing in front of the seat", () => {
    const { container } = render(<ChipStack amount={0} bigBlind={2} />);
    expect(container.firstChild).toBeNull();
  });

  it("stacks the discs with a growing lift and hides them from the reader", () => {
    const { container } = render(<ChipStack amount={6} bigBlind={2} />);
    const chips = discs(container);
    expect(chips).toHaveLength(3);
    expect(chips.map((chip) => (chip as HTMLElement).style.getPropertyValue("--lift"))).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(container.querySelector(".chip-stack-discs")).toHaveAttribute("aria-hidden", "true");
  });

  it("takes a positioning class from the caller", () => {
    const { container } = render(<ChipStack amount={4} bigBlind={2} className="bet-stack" />);
    expect(container.querySelector(".chip-stack.bet-stack")).not.toBeNull();
  });
});
