// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { ROUTE_HEADER } from "../jev/connection";
import {
  CONNECTION_STORAGE_KEY,
  DEFAULT_SETTINGS,
  LEGACY_API_KEY_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from "./storage";

// `App.tsx` picks its language at import time; pin English before that happens so the
// queries below can use the English strings.
initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const CPU_ONLY: Settings = {
  ...DEFAULT_SETTINGS,
  speed: "max",
  seats: [
    { name: "A", kind: "cpu", personaId: "tag" },
    { name: "B", kind: "cpu", personaId: "lag" },
    { name: "C", kind: "cpu", personaId: "rock" },
  ],
};

/**
 * A TypeSafe `systemOne` payload that is legal whatever the table offers: `decideAction`
 * keeps only the probabilities whose label was offered, and `check_or_call` always is.
 */
const SYSTEM_ONE_RESULT = {
  model: "jev-latest",
  answers: {
    action: {
      type: "choice",
      choice: "check_or_call",
      confidence: 0.9,
      probabilities: { fold: 0.05, check_or_call: 0.9, bet_or_raise: 0.05 },
    },
    sizing: { type: "score", score: 1, confidence: 0.8, legend: {}, probabilities: {} },
    bluff_intent: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
};

function stubJevFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    async () =>
      new Response(JSON.stringify(SYSTEM_ONE_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("App", () => {
  // The features of every decision (and of every speculated one) now include a Monte Carlo
  // equity and an exact hand-strength enumeration, 15-30 ms each: alongside the other test
  // files this no longer fits the default 5 s.
  it("goes from setup to a spectated table with Jev decisions and back", {
    timeout: 20_000,
  }, async () => {
    // A key saved before the gateway routes existed still gets you to the table.
    localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, "sk-test");
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(CPU_ONLY));
    const fetchMock = stubJevFetch();

    const { App } = await import("./App");
    render(<App />);

    expect(screen.getByRole("heading", { name: "New table" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch the CPUs play" }));

    expect(screen.getByText("Spectator mode")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hand history" })).toBeInTheDocument();

    // Every CPU action carries the Jev decision the history panel expands.
    await waitFor(() => expect(screen.getAllByText("Jev").length).toBeGreaterThan(0), {
      timeout: 15_000,
    });
    // The decisions came from the proxied backend, not from the fail-open fallback.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/jev/v1/systemone");
    expect(screen.queryByText("Fallback: Jev was unavailable")).not.toBeInTheDocument();

    // The wide layout keeps the felt up and swaps the side column between the two panels.
    // jsdom has no `matchMedia`, so `TableView` treats it as a wide screen.
    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getByRole("heading", { name: "Standings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hand history" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "This session" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByRole("heading", { name: "Hand history" })).toBeInTheDocument();

    // Spectator speed control: the table header changes the persisted setting live.
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "slow" } });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as Settings;
      expect(stored.speed).toBe("slow");
    });

    fireEvent.click(screen.getByRole("button", { name: "Leave table" }));
    expect(screen.getByRole("heading", { name: "New table" })).toBeInTheDocument();
  });

  it("asks the Vercel AI Gateway for typesafe-ai/jev through the same proxy path", async () => {
    localStorage.setItem(
      CONNECTION_STORAGE_KEY,
      JSON.stringify({ route: "vercel", apiKey: "vck_1" }),
    );
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(CPU_ONLY));
    const fetchMock = stubJevFetch();

    const { App } = await import("./App");
    render(<App />);
    expect(screen.getByRole("button", { name: "Vercel AI Gateway" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch the CPUs play" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0), { timeout: 5000 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/jev/v1/systemone");
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get(ROUTE_HEADER)).toBe("vercel");
    expect(headers.get("X-TypeSafe-Key")).toBe("vck_1");
    expect(JSON.parse(String((init as RequestInit | undefined)?.body)).model).toBe(
      "typesafe-ai/jev",
    );
  });
});
