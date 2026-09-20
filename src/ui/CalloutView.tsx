import type { TFunction } from "i18next";
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

interface Props {
  kind: CalloutKind;
  amount: number;
  bigBlind: number;
}

/** The big coloured label that flashes at a seat the moment it acts. */
export function CalloutView({ kind, amount, bigBlind }: Props) {
  const { t } = useTranslation();
  return <div className={`callout callout-${kind}`}>{calloutText(t, kind, amount, bigBlind)}</div>;
}
