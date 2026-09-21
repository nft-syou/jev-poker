// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SeatId } from "../engine/types";
import { initI18n } from "../i18n";
import { EMPTY_STATS, type PlayerStats } from "./stats";
import { Ticker } from "./Ticker";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const STATS: Record<SeatId, PlayerStats> = {
  0: {
    ...EMPTY_STATS,
    jevDecisions: 6,
    jevLatencyMs: 3000,
    jevWaitMs: 1800,
    jevRaises: 3,
    jevBluffSum: 1.2,
  },
  1: {
    ...EMPTY_STATS,
    jevDecisions: 4,
    jevFallbacks: 2,
    jevLatencyMs: 1000,
    jevWaitMs: 200,
    jevRaises: 1,
    jevBluffSum: 0.4,
  },
};

/** The label's sibling holds the value, so each counter can be read by its caption. */
function valueFor(label: string): string {
  const caption = screen.getByText(label);
  const value = caption.parentElement?.querySelector(".ticker-value");
  return value?.textContent ?? "";
}

describe("Ticker", () => {
  it("adds the seats up into session-wide counters", () => {
    render(
      <Ticker
        stats={STATS}
        prefetch={{ started: 20, hits: 6, misses: 2 }}
        handsPlayed={7}
        maxPot={412}
      />,
    );

    expect(valueFor("Jev calls")).toBe("10");
    // How long Jev took to answer: 4000 ms over 10 decisions, prefetched ones included.
    expect(valueFor("Avg Jev answer")).toBe("400 ms");
    // What the table actually waited: a prefetched answer cost it nothing, so 2000 / 10.
    expect(valueFor("Perceived wait")).toBe("200 ms");
    // 6 hits out of 8 takes.
    expect(valueFor("Prefetch hit rate")).toBe("75%");
    // 4 raises out of 10 decisions.
    expect(valueFor("Raise rate")).toBe("40%");
    // 1.6 of bluff intent over the 8 decisions Jev actually answered.
    expect(valueFor("Avg bluff")).toBe("20%");
    expect(valueFor("Hands")).toBe("7");
    expect(valueFor("Biggest pot")).toBe("412");
  });

  it("shows a dash rather than a division by zero", () => {
    render(
      <Ticker
        stats={{}}
        prefetch={{ started: 0, hits: 0, misses: 0 }}
        handsPlayed={0}
        maxPot={0}
      />,
    );
    expect(valueFor("Jev calls")).toBe("0");
    expect(valueFor("Avg Jev answer")).toBe("–");
    expect(valueFor("Perceived wait")).toBe("–");
    expect(valueFor("Prefetch hit rate")).toBe("–");
    expect(valueFor("Raise rate")).toBe("–");
    expect(valueFor("Avg bluff")).toBe("–");
    expect(valueFor("Biggest pot")).toBe("0");
  });
});
