import type { TFunction } from "i18next";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CalloutKind } from "./fx";
import { showNumber, toBB } from "./showcase";

/**
 * What the table shouts: "FOLD", "CALL 3 BB", "RAISE 12 BB", "ALL IN". Amounts are in big
 * blinds, which is the only unit that means the same thing at every table.
 */
export function calloutText(
  t: TFunction,
  kind: CalloutKind,
  amount: number,
  bigBlind: number,
): string {
  switch (kind) {
    case "fold":
      return t("callout.fold");
    case "check":
      return t("callout.check");
    case "allin":
      return t("callout.allin");
    case "call":
      return t("callout.call", { bb: showNumber(toBB(amount, bigBlind)) });
    case "bet":
      return t("callout.bet", { bb: showNumber(toBB(amount, bigBlind)) });
    case "raise":
      return t("callout.raise", { bb: showNumber(toBB(amount, bigBlind)) });
  }
}

/** The unit direction from a seat towards the middle of the felt. */
export interface Inward {
  x: number;
  y: number;
}

/** Straight up, which is where a seat with no angle of its own points. */
export const INWARD_UP: Inward = { x: 0, y: -1 };

interface Props {
  kind: CalloutKind;
  amount: number;
  bigBlind: number;
  /** Which way the middle of the table is from this seat. */
  inward?: Inward;
}

/**
 * The big coloured label that flashes at a seat the moment it acts.
 *
 * It is placed *inwards*, along the seat's own line to the middle, rather than below the
 * seat: a seat on the bottom rail has nothing below it but the felt's edge, the action feed
 * and — for a human — their own buttons, and a label there would cover all three. Inwards
 * there is always table. The offset is short enough to stay nearer the seat than its chip
 * stack and clear of the recording-mode bubble, which grows the other way.
 *
 * Decoration only: the action is in the feed, the log and the seat's own state, so the label
 * is hidden from the accessibility tree rather than read out on every single action.
 */
export function CalloutView({ kind, amount, bigBlind, inward = INWARD_UP }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="callout-spot"
      aria-hidden="true"
      style={{ "--in-x": inward.x, "--in-y": inward.y } as CSSProperties}
    >
      <div className={`callout callout-${kind}`}>{calloutText(t, kind, amount, bigBlind)}</div>
    </div>
  );
}
