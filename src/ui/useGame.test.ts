// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { AuthenticationError } from "@typesafe-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JevBackend } from "../jev/backend";
import { createMockBackend } from "../jev/mock-backend";
import { PRESET_PERSONAS } from "../jev/personas";
import { DEFAULT_SETTINGS, type Settings } from "./storage";
import { useGame } from "./useGame";

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const cpuOnly: Settings = {
  ...DEFAULT_SETTINGS,
  speed: "max",
  seats: [
    { name: "A", kind: "cpu", personaId: "tag" },
    { name: "B", kind: "cpu", personaId: "lag" },
    { name: "C", kind: "cpu", personaId: "rock" },
  ],
};

/** Mock whose every call fails the way a rejected API key does. */
function authFailingBackend(): JevBackend {
  return {
    kind: "typesafe",
    systemOne: () =>
      Promise.reject(new AuthenticationError(401, { error: "bad key" }, new Headers(), "bad key")),
  };
}

/** Mock that answers after 40ms and rejects as soon as the caller aborts. */
function slowBackend(seen: { aborts: number }): JevBackend {
  const inner = createMockBackend();
  return {
    kind: "mock",
    systemOne: (request, options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          void inner.systemOne(request).then(resolve, reject);
        }, 40);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          seen.aborts++;
          reject(new Error("aborted"));
        });
      }),
  };
}

describe("useGame", () => {
  it("plays hands automatically with only CPUs", async () => {
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        seed: 3,
      }),
    );
    await waitFor(() => expect(result.current.state.handsPlayed).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    expect(result.current.spectator).toBe(true);
    expect(result.current.state.log.some((e) => e.event.type === "PotAwarded")).toBe(true);
    const decided = result.current.state.log.filter((e) => e.decision !== undefined);
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((e) => e.event.type === "ActionTaken")).toBe(true);
    const total = result.current.state.seats.reduce((sum, s) => sum + s.stack, 0);
    // Cash tables rebuy busted seats, which adds chips; account for every rebuy so far.
    const rebought = result.current.state.log
      .map((e) => e.event)
      .filter((e) => e.type === "SeatRebought")
      .reduce((sum, e) => sum + (e.type === "SeatRebought" ? e.amount : 0), 0);
    expect(total).toBe(3 * cpuOnly.startingStack + rebought);
    unmount();
  });

  it("waits for the human and continues after they act", async () => {
    const settings: Settings = {
      ...cpuOnly,
      seats: [
        { name: "Me", kind: "human", personaId: "tag" },
        { name: "B", kind: "cpu", personaId: "lag" },
      ],
    };
    const { result, unmount } = renderHook(() =>
      useGame({
        settings,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        seed: 4,
      }),
    );
    await waitFor(() => expect(result.current.legalForHuman).not.toBeNull(), { timeout: 5000 });
    const before = result.current.state.log.length;
    act(() => {
      const legal = result.current.legalForHuman;
      result.current.humanAct(legal?.canCheck ? { type: "check" } : { type: "fold" });
    });
    await waitFor(() => expect(result.current.state.log.length).toBeGreaterThan(before), {
      timeout: 5000,
    });
    unmount();
  });

  it("pauses and resumes", async () => {
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        seed: 5,
      }),
    );
    await waitFor(() => expect(result.current.state.handsPlayed).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });
    act(() => result.current.togglePause());
    expect(result.current.state.paused).toBe(true);
    // One in-flight decision may still land; after that nothing moves.
    await new Promise((r) => setTimeout(r, 50));
    const frozen = result.current.state.handsPlayed;
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.state.handsPlayed).toBe(frozen);
    act(() => result.current.togglePause());
    await waitFor(() => expect(result.current.state.handsPlayed).toBeGreaterThan(frozen), {
      timeout: 5000,
    });
    unmount();
  });
  it("aborts the in-flight Jev request on pause and never acts on it", async () => {
    const seen = { aborts: 0 };
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: slowBackend(seen),
        onAuthFailed: () => {},
        seed: 3,
      }),
    );
    await waitFor(() => expect(result.current.state.thinkingSeat).not.toBeNull(), {
      timeout: 5000,
    });
    const before = result.current.state.log.length;
    act(() => result.current.togglePause());
    expect(seen.aborts).toBe(1);
    // Well past the backend's 40ms: the aborted decision must not reach `table.act`.
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.state.log.length).toBe(before);
    unmount();
  });

  it("pauses on an auth failure, notifies, and resumes when a new backend arrives", async () => {
    const onAuthFailed = vi.fn();
    const personas = [...PRESET_PERSONAS];
    const { result, rerender, unmount } = renderHook(
      ({ backend }: { backend: JevBackend }) =>
        useGame({ settings: cpuOnly, personas, backend, onAuthFailed, seed: 11 }),
      { initialProps: { backend: authFailingBackend() } },
    );
    await waitFor(
      () => {
        expect(onAuthFailed).toHaveBeenCalledTimes(1);
        expect(result.current.state.paused).toBe(true);
      },
      { timeout: 5000 },
    );
    // The auth path must stop before touching the table: blinds are posted, nothing is acted.
    expect(result.current.state.log.some((e) => e.event.type === "ActionTaken")).toBe(false);
    expect(result.current.state.handsPlayed).toBe(0);

    rerender({ backend: createMockBackend() });
    await waitFor(() => expect(result.current.state.paused).toBe(false), { timeout: 5000 });
    await waitFor(() => expect(result.current.state.handsPlayed).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });
    expect(onAuthFailed).toHaveBeenCalledTimes(1);
    unmount();
  });
});
