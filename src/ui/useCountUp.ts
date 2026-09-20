import { useEffect, useRef, useState } from "react";

/**
 * Rolls a number towards `value` over `ms`, one animation frame at a time, and lands exactly
 * on the target. This is the one place in the table that updates React state per frame: the
 * pot is a single number in a single node, and counting it is what makes a pot feel won.
 *
 * A value that changes mid-roll restarts from wherever the count had got to, so a fast table
 * never snaps backwards. `ms <= 0` (a reduced-motion viewer) sets the number immediately.
 */
export function useCountUp(value: number, ms: number): number {
  const [shown, setShown] = useState(value);
  /** What is on screen right now; the effect needs it without depending on it. */
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value || ms <= 0 || typeof requestAnimationFrame !== "function") {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = Date.now();
    let frame = requestAnimationFrame(function step() {
      const progress = Math.min(1, (Date.now() - start) / ms);
      const next = progress >= 1 ? value : Math.round(from + (value - from) * progress);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);

  return shown;
}
