import { type ActionLabel, type DecisionFeatures, SIZING_RUBRIC } from "@jev-poker/agent";
import type { Action } from "@jev-poker/engine";
import type { TFunction } from "i18next";
import type { DecisionInfo } from "./useGame";

/** Order of the probability bars; the same three, always, so they never jump about. */
export const SHOWCASE_LABELS: readonly ActionLabel[] = ["fold", "check_or_call", "bet_or_raise"];

/** Chips as big blinds, with at most one decimal and no trailing zero. */
export function toBB(chips: number, bigBlind: number): number {
  if (bigBlind <= 0) return chips;
  return Math.round((chips / bigBlind) * 10) / 10;
}

/** A number the way the overlays print it: no trailing ".0", no thousands separator. */
export function showNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * The action in recording-mode shorthand: "RAISE to 12 BB", "CALL 3 BB", "CHECK", "FOLD".
 * Calls carry no amount of their own, so the features say what the seat was facing.
 */
export function actionText(
  t: TFunction,
  action: Action,
  bigBlind: number,
  features: DecisionFeatures | null,
): string {
  switch (action.type) {
    case "fold":
      return t("showcase.action_fold");
    case "check":
      return t("showcase.action_check");
    case "call":
      return t("showcase.action_call", { bb: showNumber(features?.table.toCallBB ?? 0) });
    case "bet":
      return t("showcase.action_bet", { bb: showNumber(toBB(action.amount, bigBlind)) });
    case "raise":
      return t("showcase.action_raise", { bb: showNumber(toBB(action.amount, bigBlind)) });
    case "allin":
      return t("showcase.action_allin");
  }
}

/** The rubric level a sizing score landed on, as the index of `SIZING_RUBRIC`. */
/**
 * Whether a seat's bubble must stay short. A bubble grows upwards from its seat, and a seat
 * in the top third of the felt (its inward vector points mostly down) has no room above it
 * on a 16:9 recording: the full bubble with bars was cut off by the viewport edge.
 */
export function compactBubble(inward: { x: number; y: number }): boolean {
  return inward.y > 0.5;
}

export function sizingLevel(score: number): number {
  const rounded = Math.round(score);
  return Math.min(SIZING_RUBRIC.length - 1, Math.max(0, rounded));
}

/** Either the latency or, for an answer that was already waiting, the prefetched badge. */
export function DecisionCost({ record, t }: { record: DecisionInfo; t: TFunction }) {
  if (record.prefetched) return <span className="prefetched">{t("history.prefetched")}</span>;
  return (
    <span className="showcase-latency">{t("showcase.latency", { ms: record.latencyMs })}</span>
  );
}

/**
 * One bar per action label, width driven by Jev's probability. The widths are set inline so
 * a CSS transition can animate them from whatever the previous decision showed.
 */
export function ProbabilityBars({ record, t }: { record: DecisionInfo; t: TFunction }) {
  const jev = record.jev;
  return (
    <div className="showcase-bars">
      {SHOWCASE_LABELS.map((label) => {
        const p = jev?.probabilities[label] ?? 0;
        const pct = Math.round(p * 100);
        return (
          <div key={label} className={`showcase-bar ${jev?.chosen === label ? "chosen" : ""}`}>
            <span className="showcase-bar-label">{t(`labels.${label}`)}</span>
            <span className="showcase-bar-track">
              <span className="showcase-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="showcase-bar-value">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
