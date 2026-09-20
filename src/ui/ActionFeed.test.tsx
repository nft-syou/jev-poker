// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../i18n";
import { ActionFeed, FEED_SIZE } from "./ActionFeed";
import type { CalloutKind, FeedEntry } from "./fx";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const NAMES: Record<number, string> = { 0: "Max", 1: "Lars" };
const nameOf = (seat: number) => NAMES[seat] ?? `#${seat}`;

let nextId = 1;
const acted = (seat: number, kind: CalloutKind, amount = 0): FeedEntry => ({
  id: nextId++,
  type: "action",
  seat,
  kind,
  amount,
  at: nextId,
});
const dealt = (street: "preflop" | "flop" | "turn" | "river"): FeedEntry => ({
  id: nextId++,
  type: "street",
  street,
  at: nextId,
});

function texts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".action-feed-entry")].map((entry) =>
    (entry.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("ActionFeed", () => {
  it("shows what happened, oldest first, with the seat's name", () => {
    const { container } = render(
      <ActionFeed
        entries={[dealt("preflop"), acted(0, "raise", 24), acted(1, "fold")]}
        nameOf={nameOf}
        bigBlind={2}
      />,
    );
    expect(texts(container)).toEqual(["Preflop", "Max RAISE 12 BB", "Lars FOLD"]);
  });

  it("separates the streets", () => {
    const { container } = render(
      <ActionFeed
        entries={[acted(0, "call", 4), dealt("flop"), acted(1, "check")]}
        nameOf={nameOf}
        bigBlind={2}
      />,
    );
    expect(texts(container)).toEqual(["Max CALL 2 BB", "Flop", "Lars CHECK"]);
    expect(container.querySelectorAll(".feed-street")).toHaveLength(1);
  });

  it("carries only the newest handful", () => {
    const many = Array.from({ length: FEED_SIZE * 3 }, (_, i) => acted(i % 2, "check"));
    const { container } = render(<ActionFeed entries={many} nameOf={nameOf} bigBlind={2} />);
    const rendered = texts(container);
    expect(rendered).toHaveLength(FEED_SIZE);
    // The tail of the stream, not its head.
    const last = many[many.length - 1];
    expect(container.querySelectorAll(".action-feed-entry")[FEED_SIZE - 1]?.textContent).toContain(
      nameOf(last?.type === "action" ? last.seat : 0),
    );
  });

  it("takes a shorter strip when asked for one", () => {
    const many = Array.from({ length: 10 }, (_, i) => acted(i % 2, "check"));
    const { container } = render(
      <ActionFeed entries={many} nameOf={nameOf} bigBlind={2} max={3} />,
    );
    expect(texts(container)).toHaveLength(3);
  });

  it("colours each entry by what it was", () => {
    const { container } = render(
      <ActionFeed
        entries={[acted(0, "allin", 200), acted(1, "bet", 12)]}
        nameOf={nameOf}
        bigBlind={2}
      />,
    );
    expect(container.querySelector(".feed-allin")).not.toBeNull();
    expect(container.querySelector(".feed-bet")).not.toBeNull();
    expect(texts(container)).toEqual(["Max ALL IN", "Lars BET 6 BB"]);
  });

  it("renders nothing before anything has happened", () => {
    const { container } = render(<ActionFeed entries={[]} nameOf={nameOf} bigBlind={2} />);
    expect(container.firstChild).toBeNull();
  });
});
