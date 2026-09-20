import { describe, expect, it } from "vitest";
import { SPEEDS, type Speed } from "./storage";
import { type PresentationTimings, presentationTimings } from "./timings";

const FIELDS: (keyof PresentationTimings)[] = [
  "thinkingHoldMs",
  "decisionHoldMs",
  "calloutMs",
  "chipMoveMs",
  "potCountMs",
  "winnerGlowMs",
  "cardFlipMs",
];

describe("presentationTimings", () => {
  it("keeps today's feel at slow and normal", () => {
    expect(presentationTimings("normal")).toEqual({
      thinkingHoldMs: 600,
      decisionHoldMs: 2500,
      calloutMs: 900,
      chipMoveMs: 450,
      potCountMs: 600,
      winnerGlowMs: 1200,
      cardFlipMs: 400,
    });
    expect(presentationTimings("slow")).toEqual(presentationTimings("normal"));
  });

  it("gives every speed a positive window for every overlay", () => {
    for (const speed of SPEEDS) {
      const timings = presentationTimings(speed);
      for (const field of FIELDS) {
        expect(timings[field], `${speed}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("shortens every window monotonically as the table speeds up", () => {
    const order: Speed[] = ["normal", "fast", "max"];
    for (const field of FIELDS) {
      const values = order.map((speed) => presentationTimings(speed)[field]);
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${field} at ${order[i]}`).toBeLessThan(values[i - 1] ?? 0);
      }
    }
  });

  it("fits a whole decision inside a max-speed turn", () => {
    const max = presentationTimings("max");
    // At max the engine has no delay of its own, so the whole presentation of one decision
    // has to fit in well under a second or the overlays pile up on the next one.
    expect(max.thinkingHoldMs + max.decisionHoldMs).toBeLessThan(1000);
    // The chips land before the label that announces them has faded.
    expect(max.chipMoveMs).toBeLessThan(max.calloutMs);
    expect(max.potCountMs).toBeLessThanOrEqual(max.calloutMs);
  });

  it("falls back to the normal table for an unknown speed", () => {
    expect(presentationTimings("nonsense" as Speed)).toEqual(presentationTimings("normal"));
  });
});
