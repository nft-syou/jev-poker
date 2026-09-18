import { useTranslation } from "react-i18next";
import type { Card } from "../engine/cards";
import { cardText, isRedSuit } from "./format";

interface Props {
  card: Card | null;
  hidden?: boolean;
}

export function CardView({ card, hidden = false }: Props) {
  const { t } = useTranslation();
  if (card === null) return <span className="card empty" />;
  // `role="img"` so the label is announced; a bare <span> does not support aria-label.
  if (hidden) return <span className="card back" role="img" aria-label={t("table.hiddenCard")} />;
  return <span className={`card ${isRedSuit(card.suit) ? "red" : "black"}`}>{cardText(card)}</span>;
}
