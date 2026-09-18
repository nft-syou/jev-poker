// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import {
  API_KEY_STORAGE_KEY,
  DEFAULT_SETTINGS,
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
  it("goes from setup to a spectated table with Jev decisions and back", async () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, "sk-test");
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
      timeout: 5000,
    });
    // The decisions came from the proxied backend, not from the fail-open fallback.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/jev/v1/systemone");
    expect(screen.queryByText("Fallback: Jev was unavailable")).not.toBeInTheDocument();

    // Spectator speed control: the table header changes the persisted setting live.
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "slow" } });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as Settings;
      expect(stored.speed).toBe("slow");
    });

    fireEvent.click(screen.getByRole("button", { name: "Leave table" }));
    expect(screen.getByRole("heading", { name: "New table" })).toBeInTheDocument();
  });
});
