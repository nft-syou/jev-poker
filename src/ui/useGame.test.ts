// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { AuthenticationError } from "@typesafe-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JevBackend } from "../jev/backend";
import { createMockBackend } from "../jev/mock-backend";
import { PRESET_PERSONAS } from "../jev/personas";
import type { PlayerStats } from "./stats";
import { DEFAULT_SETTINGS, type Settings, STATS_STORAGE_KEY } from "./storage";
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

/** Mock that counts every request that reaches it. */
function countingBackend(seen: { calls: number }): JevBackend {
  const inner = createMockBackend();
  return {
    kind: "mock",
    systemOne: (request, options) => {
      seen.calls++;
      return inner.systemOne(request, options);
    },
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

  it("accumulates session stats and merges them into the cumulative store", async () => {
    localStorage.clear();
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        seed: 7,
      }),
    );
    await waitFor(
      () => {
        expect(result.current.state.handsPlayed).toBeGreaterThanOrEqual(2);
        const seats = Object.values(result.current.state.stats);
        expect(seats).toHaveLength(3);
        for (const stats of seats) {
          expect(stats.handsPlayed).toBeGreaterThanOrEqual(2);
          // Every seat is a CPU here, so every seat asked Jev at least once.
          expect(stats.jevDecisions).toBeGreaterThan(0);
        }
      },
      { timeout: 5000 },
    );

    // Stop the table so the session stats and the store cannot drift apart mid-assertion.
    act(() => result.current.togglePause());
    await new Promise((r) => setTimeout(r, 80));

    // Session stats are keyed by seat; the cumulative store by persona.
    expect(result.current.statsKeys).toEqual({
      0: "persona:tag",
      1: "persona:lag",
      2: "persona:rock",
    });
    const stored = JSON.parse(localStorage.getItem(STATS_STORAGE_KEY) ?? "{}") as Record<
      string,
      PlayerStats
    >;
    expect(Object.keys(stored).sort()).toEqual(["persona:lag", "persona:rock", "persona:tag"]);
    expect(stored["persona:tag"]?.handsPlayed).toBe(result.current.state.stats[0]?.handsPlayed);
    expect(result.current.cumulative).toEqual(stored);

    act(() => result.current.resetCumulative());
    expect(result.current.cumulative).toEqual({});
    expect(localStorage.getItem(STATS_STORAGE_KEY)).toBeNull();
    unmount();
  });

  it("remembers the last decision and the biggest pot for the showcase", async () => {
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
    const last = result.current.state.lastDecision;
    expect(last).not.toBeNull();
    expect(result.current.state.seats.some((s) => s.id === last?.seat)).toBe(true);
    expect(last?.record.seat).toBe(last?.seat);
    // The features travel with the decision, so the panel can describe the hand it saw.
    expect(last?.features.hand.holeCards).toHaveLength(2);
    expect(last?.features.table.potBB).toBeGreaterThanOrEqual(0);
    expect(last?.at).toBeGreaterThan(0);
    // The log carries them too, next to the decision it belongs to.
    const decided = result.current.state.log.filter((e) => e.decision !== undefined);
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every((e) => e.features !== undefined)).toBe(true);
    // Every awarded pot is at least the blinds, so the biggest one is never zero.
    expect(result.current.state.maxPot).toBeGreaterThan(0);
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
    // The live request plus whatever was being speculated on behind it.
    expect(seen.aborts).toBeGreaterThanOrEqual(1);
    // Well past the backend's 40ms: the aborted decision must not reach `table.act`.
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current.state.log.length).toBe(before);
    unmount();
  });

  it("speculates ahead and serves CPU turns from the prefetch cache", async () => {
    const seen = { calls: 0 };
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: countingBackend(seen),
        onAuthFailed: () => {},
        seed: 3,
      }),
    );
    await waitFor(() => expect(result.current.state.handsPlayed).toBeGreaterThanOrEqual(3), {
      timeout: 10000,
    });
    const { started, hits, misses } = result.current.state.prefetch;
    expect(started).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    // Nothing can be taken twice, and no entry survives its hand to be hit later.
    expect(hits).toBeLessThanOrEqual(started);
    const decided = result.current.state.log.filter((e) => e.decision !== undefined);
    expect(hits + misses).toBeGreaterThanOrEqual(decided.length);
    expect(seen.calls).toBeGreaterThan(decided.length);
    expect(result.current.state.log.some((e) => e.decision?.prefetched === true)).toBe(true);
    expect(result.current.state.log.some((e) => e.decision?.prefetched === false)).toBe(true);
    unmount();
  });

  it("drops the speculation when the table pauses", async () => {
    const { result, unmount } = renderHook(() =>
      useGame({
        settings: cpuOnly,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        seed: 9,
      }),
    );
    await waitFor(() => expect(result.current.state.prefetch.started).toBeGreaterThan(0), {
      timeout: 10000,
    });
    act(() => result.current.togglePause());
    await new Promise((r) => setTimeout(r, 80));
    const frozen = result.current.state.prefetch;
    await new Promise((r) => setTimeout(r, 120));
    expect(result.current.state.prefetch).toEqual(frozen);
    expect(frozen.hits).toBeLessThanOrEqual(frozen.started);
    unmount();
  });

  it("has the CPU's answer ready by the time the human has acted", async () => {
    const settings: Settings = {
      ...cpuOnly,
      seats: [
        { name: "Me", kind: "human", personaId: "tag" },
        { name: "B", kind: "cpu", personaId: "lag" },
        { name: "C", kind: "cpu", personaId: "rock" },
      ],
    };
    const { result, unmount } = renderHook(() =>
      useGame({
        settings,
        personas: [...PRESET_PERSONAS],
        backend: createMockBackend(),
        onAuthFailed: () => {},
        // Seed 7 puts the button on the human, who therefore opens the first hand.
        seed: 7,
      }),
    );
    await waitFor(() => expect(result.current.legalForHuman).not.toBeNull(), { timeout: 5000 });
    expect(result.current.state.snapshot?.actingSeat).toBe(0);
    expect(result.current.legalForHuman?.callAmount).toBe(DEFAULT_SETTINGS.bigBlind);
    // The human is still thinking, so their answers are already being prefetched.
    await waitFor(() => expect(result.current.state.prefetch.started).toBeGreaterThan(0), {
      timeout: 5000,
    });
    const before = result.current.state.prefetch.hits;

    act(() => result.current.humanAct({ type: "call" }));
    await waitFor(() => expect(result.current.state.prefetch.hits).toBeGreaterThan(before), {
      timeout: 5000,
    });
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
