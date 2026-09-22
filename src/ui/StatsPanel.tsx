import type { SeatId } from "@jev-poker/engine";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "../i18n";
import { EMPTY_STATS, type PlayerStats, ratePct, type StatsKey } from "./stats";
import type { GameSeat } from "./useGame";

interface Props {
  seats: readonly GameSeat[];
  /** Stats for this sitting, by seat. */
  session: Record<SeatId, PlayerStats>;
  /** Stats kept across sittings, by `StatsKey`. */
  cumulative: Record<StatsKey, PlayerStats>;
  keys: Record<SeatId, StatsKey>;
  startingStack: number;
  onResetCumulative: () => void;
  language: Language;
}

type View = "session" | "cumulative";

export function StatsPanel({
  seats,
  session,
  cumulative,
  keys,
  startingStack,
  onResetCumulative,
  language,
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("session");
  const numbers = useMemo(() => new Intl.NumberFormat(language), [language]);

  const none = t("stats.none");
  const pct = (numerator: number, denominator: number) => {
    const rate = ratePct(numerator, denominator);
    return rate === null ? none : `${rate}%`;
  };
  const signed = (chips: number) =>
    chips > 0 ? `+${numbers.format(chips)}` : numbers.format(chips);
  const sessionStats = (seat: GameSeat) => session[seat.id] ?? EMPTY_STATS;
  const shownStats = (seat: GameSeat): PlayerStats => {
    if (view === "session") return sessionStats(seat);
    const key = keys[seat.id];
    return (key === undefined ? undefined : cumulative[key]) ?? EMPTY_STATS;
  };

  const standings = [...seats].sort((a, b) => b.stack - a.stack);

  return (
    <aside className="stats">
      <h3>{t("stats.title")}</h3>

      <h4>{t("stats.standings")}</h4>
      <div className="table-scroll">
        <table className="standings">
          <thead>
            <tr>
              <th scope="col">{t("stats.rank")}</th>
              <th scope="col">{t("stats.player")}</th>
              <th scope="col">{t("stats.stack")}</th>
              <th scope="col">{t("stats.net")}</th>
              <th scope="col">{t("stats.rebuys")}</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((seat, index) => {
              const stats = sessionStats(seat);
              return (
                <tr key={seat.id}>
                  <td>{index + 1}</td>
                  <td className="name">{seat.name}</td>
                  <td>
                    {numbers.format(seat.stack)}
                    <span
                      className="stack-bar"
                      style={{
                        width: `${Math.min(100, Math.round((seat.stack / Math.max(1, startingStack * 2)) * 100))}%`,
                      }}
                    />
                  </td>
                  <td className={netClass(stats.netChips)}>{signed(stats.netChips)}</td>
                  <td>{stats.rebuys}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row stats-views">
        <button
          type="button"
          className={view === "session" ? "" : "secondary"}
          aria-pressed={view === "session"}
          onClick={() => setView("session")}
        >
          {t("stats.session")}
        </button>
        <button
          type="button"
          className={view === "cumulative" ? "" : "secondary"}
          aria-pressed={view === "cumulative"}
          onClick={() => setView("cumulative")}
        >
          {t("stats.cumulative")}
        </button>
      </div>

      <div className="table-scroll">
        <table className="player-stats">
          <thead>
            <tr>
              <th scope="col">{t("stats.player")}</th>
              <th scope="col">{t("stats.hands")}</th>
              <th scope="col">{t("stats.winRate")}</th>
              <th scope="col">{t("stats.vpip")}</th>
              <th scope="col">{t("stats.pfr")}</th>
              <th scope="col">{t("stats.showdownsWon")}</th>
              <th scope="col">{t("stats.allIns")}</th>
              <th scope="col">{t("stats.net")}</th>
              <th scope="col">{t("stats.jevLatency")}</th>
              <th scope="col">{t("stats.fallbacks")}</th>
              <th scope="col">{t("stats.bluff")}</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((seat) => {
              const stats = shownStats(seat);
              // Humans never ask Jev, so their Jev columns stay empty rather than reading 0.
              const jev = seat.kind === "cpu";
              const answered = stats.jevDecisions - stats.jevFallbacks;
              return (
                <tr key={seat.id}>
                  <td className="name">{seat.name}</td>
                  <td>{stats.handsPlayed}</td>
                  <td>{pct(stats.handsWon, stats.handsPlayed)}</td>
                  <td>{pct(stats.vpipHands, stats.handsPlayed)}</td>
                  <td>{pct(stats.pfrHands, stats.handsPlayed)}</td>
                  <td>{`${stats.showdownsWon}/${stats.showdowns}`}</td>
                  <td>{stats.allIns}</td>
                  <td className={netClass(stats.netChips)}>{signed(stats.netChips)}</td>
                  <td>
                    {jev && stats.jevDecisions > 0
                      ? numbers.format(Math.round(stats.jevLatencyMs / stats.jevDecisions))
                      : none}
                  </td>
                  <td>{jev && stats.jevDecisions > 0 ? stats.jevFallbacks : none}</td>
                  <td>{jev ? pct(stats.jevBluffSum, answered) : none}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {view === "cumulative" && (
        <button type="button" className="secondary danger" onClick={onResetCumulative}>
          {t("stats.reset")}
        </button>
      )}
    </aside>
  );
}

function netClass(chips: number): string {
  if (chips > 0) return "pos";
  return chips < 0 ? "neg" : "";
}
