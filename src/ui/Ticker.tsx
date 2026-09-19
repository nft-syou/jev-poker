import { useTranslation } from "react-i18next";
import type { SeatId } from "../engine/types";
import { type PlayerStats, ratePct } from "./stats";
import type { PrefetchStats } from "./useGame";

interface Props {
  stats: Record<SeatId, PlayerStats>;
  prefetch: PrefetchStats;
  handsPlayed: number;
  maxPot: number;
}

function sum(stats: Record<SeatId, PlayerStats>, field: keyof PlayerStats): number {
  return Object.values(stats).reduce((total, seat) => total + (seat[field] ?? 0), 0);
}

/**
 * The bottom bar of the recording layout: what this sitting has asked of Jev, added up
 * across the seats. Every counter is null-safe — nothing here divides by an empty table.
 */
export function Ticker({ stats, prefetch, handsPlayed, maxPot }: Props) {
  const { t } = useTranslation();
  const none = t("stats.none");
  const decisions = sum(stats, "jevDecisions");
  const answered = decisions - sum(stats, "jevFallbacks");
  const takes = prefetch.hits + prefetch.misses;
  const pct = (numerator: number, denominator: number) => {
    const rate = ratePct(numerator, denominator);
    return rate === null ? none : `${rate}%`;
  };

  const counters: [string, string][] = [
    [t("showcase.ticker_calls"), String(decisions)],
    [
      t("showcase.ticker_latency"),
      decisions === 0
        ? none
        : t("showcase.latency", { ms: Math.round(sum(stats, "jevLatencyMs") / decisions) }),
    ],
    [t("showcase.ticker_hitRate"), pct(prefetch.hits, takes)],
    [t("showcase.ticker_raiseRate"), pct(sum(stats, "jevRaises"), decisions)],
    [t("showcase.ticker_bluff"), pct(sum(stats, "jevBluffSum"), answered)],
    [t("showcase.ticker_hands"), String(handsPlayed)],
    [t("showcase.ticker_maxPot"), String(maxPot)],
  ];

  return (
    <div className="ticker">
      {counters.map(([label, value]) => (
        <div key={label} className="ticker-item">
          {/* Keying on the value restarts the pop animation whenever the number moves. */}
          <span key={value} className="ticker-value">
            {value}
          </span>
          <span className="ticker-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
