import { useTranslation } from "react-i18next";
import type { SeatId } from "../engine/types";
import { calloutText } from "./CalloutView";
import type { FeedEntry } from "./fx";

/** How many entries the strip carries. Past this the oldest slide off the left. */
export const FEED_SIZE = 8;

interface Props {
  entries: readonly FeedEntry[];
  /** How to name a seat — the persona in recording mode, the chair otherwise. */
  nameOf: (seat: SeatId) => string;
  bigBlind: number;
  /** Overridable so a caller can show a shorter strip; defaults to `FEED_SIZE`. */
  max?: number;
}

/**
 * The last few things that happened, oldest on the left. It is built from the event stream
 * rather than from the log, which is trimmed and carries whole events the strip has no use
 * for. At max speed this is what makes a hand readable after it has already gone by.
 */
export function ActionFeed({ entries, nameOf, bigBlind, max = FEED_SIZE }: Props) {
  const { t } = useTranslation();
  const shown = entries.length > max ? entries.slice(entries.length - max) : entries;
  if (shown.length === 0) return null;

  return (
    <div className="action-feed">
      {shown.map((entry) =>
        entry.type === "street" ? (
          <span key={entry.id} className="action-feed-entry feed-street">
            {t(`streets.${entry.street}`)}
          </span>
        ) : (
          <span key={entry.id} className={`action-feed-entry feed-${entry.kind}`}>
            <b className="feed-name">{nameOf(entry.seat)}</b>{" "}
            {calloutText(t, entry.kind, entry.amount, bigBlind)}
          </span>
        ),
      )}
    </div>
  );
}
