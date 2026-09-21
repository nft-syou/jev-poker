import { describe, expect, it } from "vitest";
import { fixedBlinds } from "./blinds";

describe("fixedBlinds", () => {
  it("returns the same blinds for every hand", () => {
    const schedule = fixedBlinds(5, 10);
    expect(schedule.blindsFor(0, 0)).toEqual({ small: 5, big: 10, ante: 0 });
    expect(schedule.blindsFor(99, 3_600_000)).toEqual({ small: 5, big: 10, ante: 0 });
  });

  it("accepts an ante", () => {
    expect(fixedBlinds(1, 2, 1).blindsFor(0, 0)).toEqual({ small: 1, big: 2, ante: 1 });
  });

  it("rejects nonsense", () => {
    expect(() => fixedBlinds(10, 5)).toThrow(/small blind/);
    expect(() => fixedBlinds(0, 0)).toThrow(/big blind/);
  });
});
