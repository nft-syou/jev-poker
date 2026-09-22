import type { DecisionFeatures } from "@jev-poker/agent";
import type { SeatId } from "@jev-poker/engine";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { actionText, DecisionCost, ProbabilityBars } from "./showcase";
import type { Speed } from "./storage";
import { presentationTimings } from "./timings";
import type { DecisionInfo } from "./useGame";

interface Props {
  seat: SeatId;
  personaName: string;
  thinking: boolean;
  decision: DecisionInfo | null;
  features: DecisionFeatures | null;
  bigBlind: number;
  /** `Date.now()` after which the decision stops showing; null keeps the default window. */
  visibleUntil: number | null;
  /** Table speed, which sets how long the bubble holds each state. Defaults to `normal`. */
  speed?: Speed;
}

/** A prefetched answer needs no thinking time; it flashes instead. */
const FLASH_MS = 300;

/**
 * The overlay above one seat: what Jev is doing, then what it decided. Positioned by the
 * seat it is rendered into, and responsible for its own fading — the table renders it for
 * as long as the seat matters and lets the bubble decide when it has been seen.
 */
export function DecisionBubble({
  seat,
  personaName,
  thinking,
  decision,
  features,
  bigBlind,
  visibleUntil,
  speed = "normal",
}: Props) {
  const { t } = useTranslation();
  const prefetched = decision?.prefetched === true;
  const { thinkingHoldMs, decisionHoldMs } = presentationTimings(speed);

  // Jev can answer faster than the eye follows, so hold the thinking line open a moment.
  // The hold is released on the falling edge, for whatever is left of it: a timer started
  // while the seat was still thinking would be cancelled by this effect's own cleanup.
  const thinkingStartRef = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (thinking) {
      thinkingStartRef.current = Date.now();
      setHolding(true);
      return;
    }
    const start = thinkingStartRef.current;
    const remaining = start === null ? 0 : thinkingHoldMs - (Date.now() - start);
    if (remaining <= 0) {
      setHolding(false);
      return;
    }
    const timer = setTimeout(() => setHolding(false), remaining);
    return () => clearTimeout(timer);
  }, [thinking, thinkingHoldMs]);

  // A prefetched answer was already in hand: flash the bolt rather than fake a pause.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!holding || !prefetched) return;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [holding, prefetched]);

  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (decision === null) {
      setExpired(false);
      return;
    }
    const ms = visibleUntil === null ? decisionHoldMs : visibleUntil - Date.now();
    if (ms <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(timer);
  }, [decision, visibleUntil, decisionHoldMs]);

  if (thinking || (holding && !prefetched)) {
    return (
      <div className="showcase-bubble thinking" data-seat={seat}>
        <span className="showcase-persona">{personaName}</span>
        <span className="showcase-thinking">{t("showcase.thinking")}</span>
      </div>
    );
  }
  if (flashing) {
    return (
      <div className="showcase-bubble flash" data-seat={seat}>
        <span className="showcase-bolt">⚡</span>
      </div>
    );
  }
  if (decision === null || expired) return null;

  return (
    <div className="showcase-bubble decided" data-seat={seat}>
      <span className="showcase-persona">{personaName}</span>
      <strong className="showcase-action">
        {actionText(t, decision.action, bigBlind, features)}
      </strong>
      {decision.jev === null ? (
        <span className="showcase-unavailable">{t("showcase.unavailable")}</span>
      ) : (
        <>
          <ProbabilityBars record={decision} t={t} />
          <div className="showcase-meta">
            <span>
              {t("showcase.bluff")} <b>{Math.round(decision.jev.bluffIntent * 100)}%</b>
            </span>
            <DecisionCost record={decision} t={t} />
          </div>
        </>
      )}
    </div>
  );
}
