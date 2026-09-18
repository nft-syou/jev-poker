import { useTranslation } from "react-i18next";
import type { Card } from "../engine/cards";
import type { GameEvent, SeatId } from "../engine/types";
import type { DecisionRecord } from "../jev/decide";
import type { ActionLabel } from "../jev/questions";
import { cardText } from "./format";
import type { LogEntry } from "./useGame";

interface Props {
  log: readonly LogEntry[];
  names: ReadonlyMap<SeatId, string>;
}

const LABELS: readonly ActionLabel[] = ["fold", "check_or_call", "bet_or_raise"];

export function HistoryPanel({ log, names }: Props) {
  const { t } = useTranslation();
  const name = (seat: SeatId) => names.get(seat) ?? `#${seat}`;
  const cards = (list: readonly Card[]) => list.map(cardText).join(" ");

  const line = (event: GameEvent): string | null => {
    switch (event.type) {
      case "HandStarted":
        return t("history.handStarted", {
          number: event.handNumber + 1,
          name: name(event.button),
          small: event.blinds.small,
          big: event.blinds.big,
        });
      case "BlindsPosted":
        return event.posts
          .map((p) => t(`history.blind_${p.kind}`, { name: name(p.seat), amount: p.amount }))
          .join("; ");
      case "HoleCardsDealt":
        return null;
      case "ActionTaken": {
        const a = event.action;
        const suffix = event.allIn ? t("history.allInSuffix") : "";
        const amount = a.type === "bet" || a.type === "raise" ? a.amount : event.amount;
        return `${t(`history.${a.type === "allin" ? "call" : a.type}`, { name: name(event.seat), amount })}${suffix}`;
      }
      case "StreetDealt":
        return t("history.street", {
          street: t(`streets.${event.street}`),
          board: cards(event.board),
        });
      case "Showdown":
        return event.hands
          .map((h) =>
            t("history.showdown", {
              name: name(h.seat),
              cards: cards(h.cards),
              hand: t(`hands.${h.value.category}`),
            }),
          )
          .join("; ");
      case "PotAwarded":
        return event.awards
          .map((a) => t("history.award", { name: name(a.seat), amount: a.amount }))
          .join("; ");
      case "SeatRebought":
        return t("history.rebuy", { name: name(event.seat), amount: event.amount });
      case "HandEnded":
        return t("history.handEnded", { number: event.handNumber + 1 });
    }
  };

  const entries = log.filter((e) => e.event.type !== "HoleCardsDealt");
  return (
    <aside className="history">
      <h3>{t("history.title")}</h3>
      {entries.length === 0 && <p className="muted">{t("history.empty")}</p>}
      <ol>
        {entries.slice(-150).map((entry) => (
          <li key={entry.id} className={entry.event.type === "HandStarted" ? "hand-start" : ""}>
            {line(entry.event)}
            {entry.decision !== undefined && <Decision record={entry.decision} />}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Decision({ record }: { record: DecisionRecord }) {
  const { t } = useTranslation();
  return (
    <details className="decision">
      <summary>
        {t("history.jev")}
        {record.fallback && ` — ${t("history.fallback")}`}
      </summary>
      {record.jev !== null && (
        <div className="probabilities">
          {LABELS.map((label) => {
            const p = record.jev?.probabilities[label];
            if (p === undefined) return null;
            return (
              <div key={label} className="prob-row">
                <span className={label === record.jev?.chosen ? "chosen" : ""}>
                  {t(`labels.${label}`)}
                </span>
                <span className="bar" style={{ width: `${Math.round(p * 100)}%` }} />
                <span>{Math.round(p * 100)}%</span>
              </div>
            );
          })}
          <div className="muted">
            {t("history.sizing")}: {record.jev.sizingScore.toFixed(1)} · {t("history.bluff")}:{" "}
            {Math.round(record.jev.bluffIntent * 100)}% · {t("history.model")}: {record.jev.model} ·{" "}
            {t("history.latency", { ms: record.latencyMs })}
          </div>
        </div>
      )}
      {record.error !== null && <div className="error">{record.error}</div>}
    </details>
  );
}
