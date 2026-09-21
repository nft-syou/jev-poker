// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatId } from "../engine/types";
import { initI18n } from "../i18n";
import { StatsPanel } from "./StatsPanel";
import { EMPTY_STATS, type PlayerStats, type StatsKey } from "./stats";
import type { GameSeat } from "./useGame";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const SEATS: GameSeat[] = [
  { id: 0, name: "You", kind: "human", stack: 120 },
  { id: 1, name: "Rocky", kind: "cpu", stack: 300 },
  { id: 2, name: "Lars", kind: "cpu", stack: 80 },
];

const KEYS: Record<SeatId, StatsKey> = {
  0: "human:You",
  1: "persona:rock",
  2: "persona:lag",
};

const SESSION: Record<SeatId, PlayerStats> = {
  0: {
    ...EMPTY_STATS,
    handsPlayed: 10,
    handsWon: 3,
    vpipHands: 4,
    pfrHands: 2,
    showdowns: 2,
    showdownsWon: 1,
    allIns: 1,
    netChips: -80,
  },
  1: {
    ...EMPTY_STATS,
    handsPlayed: 10,
    handsWon: 5,
    vpipHands: 3,
    pfrHands: 3,
    showdowns: 4,
    showdownsWon: 3,
    allIns: 2,
    rebuys: 1,
    netChips: 100,
    jevDecisions: 20,
    jevFallbacks: 2,
    jevLatencyMs: 4000,
    jevBluffSum: 5.4,
  },
  2: { ...EMPTY_STATS },
};

const CUMULATIVE: Record<StatsKey, PlayerStats> = {
  "persona:rock": { ...EMPTY_STATS, handsPlayed: 50, handsWon: 20, netChips: 640 },
};

function renderPanel(onResetCumulative = () => {}) {
  return render(
    <StatsPanel
      seats={SEATS}
      session={SESSION}
      cumulative={CUMULATIVE}
      keys={KEYS}
      startingStack={200}
      onResetCumulative={onResetCumulative}
      language="en"
    />,
  );
}

function tableAt(index: number): HTMLElement {
  const tables = screen.getAllByRole("table");
  const table = tables[index];
  if (table === undefined) throw new Error(`no table at index ${index}`);
  return table;
}

function bodyRows(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole("row").slice(1);
}

function cells(row: HTMLElement): (string | null)[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

function statsRow(name: string): HTMLElement {
  const row = bodyRows(tableAt(1)).find((r) => cells(r)[0] === name);
  if (row === undefined) throw new Error(`no stats row for ${name}`);
  return row;
}

describe("StatsPanel", () => {
  it("lists the standings by stack, with a signed session net", () => {
    renderPanel();
    const rows = bodyRows(tableAt(0));
    expect(rows.map((row) => cells(row)[1])).toEqual(["Rocky", "You", "Lars"]);
    expect(rows.map((row) => cells(row)[0])).toEqual(["1", "2", "3"]);
    expect(cells(rows[0] as HTMLElement)).toEqual(["1", "Rocky", "300", "+100", "1"]);
    expect(cells(rows[1] as HTMLElement)).toEqual(["2", "You", "120", "-80", "0"]);
    expect((rows[0] as HTMLElement).querySelector(".pos")).not.toBeNull();
    expect((rows[1] as HTMLElement).querySelector(".neg")).not.toBeNull();
  });

  it("shows the session rates and hides the Jev columns from humans", () => {
    renderPanel();
    // player, hands, win %, VPIP %, PFR %, SD won, all-ins, net, Jev ms, fallbacks, bluff %
    expect(cells(statsRow("Rocky"))).toEqual([
      "Rocky",
      "10",
      "50%",
      "30%",
      "30%",
      "3/4",
      "2",
      "+100",
      "200",
      "2",
      "30%",
    ]);
    expect(cells(statsRow("You")).slice(8)).toEqual(["–", "–", "–"]);
    // A seat that has not finished a hand has no rates to show.
    expect(cells(statsRow("Lars")).slice(1, 5)).toEqual(["0", "–", "–", "–"]);
    expect(screen.queryByRole("button", { name: "Reset all-time stats" })).not.toBeInTheDocument();
  });

  it("toggles to the cumulative view and resets it", () => {
    const onReset = vi.fn();
    renderPanel(onReset);
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(cells(statsRow("Rocky")).slice(0, 3)).toEqual(["Rocky", "50", "40%"]);
    // A persona with nothing stored yet falls back to zeroes rather than the session row.
    expect(cells(statsRow("You")).slice(1, 3)).toEqual(["0", "–"]);
    // The standings keep reporting the current session.
    expect(cells(bodyRows(tableAt(0))[0] as HTMLElement)[3]).toBe("+100");

    fireEvent.click(screen.getByRole("button", { name: "Reset all-time stats" }));
    expect(onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "This session" }));
    expect(cells(statsRow("Rocky")).slice(0, 3)).toEqual(["Rocky", "10", "50%"]);
  });
});
