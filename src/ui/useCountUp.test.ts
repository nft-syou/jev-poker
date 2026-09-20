// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "./useCountUp";

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Vitest does not fake `requestAnimationFrame` by default, and this hook lives on it. */
function useFrameTimers(): void {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date", "setTimeout"],
  });
}

describe("useCountUp", () => {
  it("starts on the value it was given", () => {
    const { result } = renderHook(() => useCountUp(120, 200));
    expect(result.current).toBe(120);
  });

  it("rolls towards a new value and settles exactly on it", () => {
    useFrameTimers();
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, 200), {
      initialProps: { value: 0 },
    });

    rerender({ value: 100 });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);

    // Past the window the count must be the target itself, not merely close to it.
    act(() => void vi.advanceTimersByTime(140));
    expect(result.current).toBe(100);
  });

  it("counts down as willingly as up", () => {
    useFrameTimers();
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, 200), {
      initialProps: { value: 500 },
    });

    rerender({ value: 40 });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBeLessThan(500);
    expect(result.current).toBeGreaterThan(40);

    act(() => void vi.advanceTimersByTime(140));
    expect(result.current).toBe(40);
  });

  it("restarts from where it had got to when the target moves mid-roll", () => {
    useFrameTimers();
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, 200), {
      initialProps: { value: 0 },
    });

    rerender({ value: 100 });
    act(() => void vi.advanceTimersByTime(100));
    const midway = result.current;
    expect(midway).toBeGreaterThan(0);

    rerender({ value: 300 });
    // The count carries on from `midway`, so it never snaps back to zero.
    act(() => void vi.advanceTimersByTime(16));
    expect(result.current).toBeGreaterThanOrEqual(midway);

    act(() => void vi.advanceTimersByTime(240));
    expect(result.current).toBe(300);
  });

  it("sets the value at once when there is no time to roll", () => {
    useFrameTimers();
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, 0), {
      initialProps: { value: 0 },
    });
    rerender({ value: 750 });
    expect(result.current).toBe(750);
  });
});
