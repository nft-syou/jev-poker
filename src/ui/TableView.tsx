import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "../i18n";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { HistoryPanel } from "./HistoryPanel";
import { SeatView } from "./SeatView";
import { StatsPanel } from "./StatsPanel";
import { SPEEDS, type Speed } from "./storage";
import { type GameController, NO_BACKEND_ERROR } from "./useGame";

interface Props {
  game: GameController;
  speed: Speed;
  startingStack: number;
  language: Language;
  onSpeedChange: (speed: Speed) => void;
  onLeave: () => void;
}

type Panel = "table" | "stats" | "log";

const PHONE_QUERY = "(max-width: 720px)";

function matchesPhone(): boolean {
  // jsdom (and any non-browser host) has no matchMedia; treat those as wide screens.
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY).matches
    : false;
}

/** True while the viewport is phone-sized, so only one panel is mounted at a time. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

export function TableView({ game, speed, startingStack, language, onSpeedChange, onLeave }: Props) {
  const { t } = useTranslation();
  const speedId = useId();
  const phone = usePhone();
  const [panel, setPanel] = useState<Panel>("table");
  const { state } = game;
  const snapshot = state.snapshot;
  const names = new Map(state.seats.map((s) => [s.id, s.name]));
  const count = state.seats.length;
  // Put the first human seat (or seat 0) at the bottom of the table.
  const anchor = game.humanSeats[0] ?? 0;
  const anchorIndex = state.seats.findIndex((s) => s.id === anchor);
  const revealAll = game.spectator || snapshot?.street === "showdown";
  // A taller felt needs a narrower, taller ellipse to keep the seats on the rail.
  const radiusX = phone ? 40 : 42;
  const radiusY = phone ? 42 : 40;

  // On a phone one panel shows at a time; on a wide screen the felt is always up and the
  // side column carries whichever of the two panels the tab switch selected.
  const showFelt = !phone || panel === "table";
  const showStats = panel === "stats";
  const showLog = phone ? panel === "log" : panel !== "stats";

  return (
    <section className="table-screen">
      <div className="table-main">
        <div className="table-header row">
          <span>{snapshot !== null && t("table.hand", { number: snapshot.handNumber + 1 })}</span>
          {game.spectator && !phone && <span className="badge">{t("table.spectating")}</span>}
          <label className="visually-hidden" htmlFor={speedId}>
            {t("setup.speed")}
          </label>
          <select
            id={speedId}
            value={speed}
            onChange={(e) => onSpeedChange(e.target.value as Speed)}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {t(`setup.speed_${s}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary"
            onClick={game.togglePause}
            disabled={state.gameOver}
          >
            {state.paused ? t("table.resume") : t("table.pause")}
          </button>
          <button type="button" className="secondary" onClick={onLeave}>
            {t("table.leave")}
          </button>
        </div>

        {showFelt && (
          <div className="felt">
            {state.seats.map((seat, index) => {
              const angle = ((index - anchorIndex) / count) * 2 * Math.PI + Math.PI / 2;
              const style = {
                left: `${50 + radiusX * Math.cos(angle)}%`,
                top: `${50 + radiusY * Math.sin(angle)}%`,
              };
              const player = snapshot?.players.find((p) => p.seat === seat.id);
              return (
                <SeatView
                  key={seat.id}
                  seat={seat}
                  player={player}
                  isButton={snapshot?.button === seat.id}
                  isActing={snapshot?.actingSeat === seat.id && !snapshot.complete}
                  isThinking={state.thinkingSeat === seat.id}
                  revealCards={revealAll || game.humanSeats.includes(seat.id)}
                  style={style}
                />
              );
            })}
            <div className="board">
              <div className="board-cards">
                {[0, 1, 2, 3, 4].map((i) => (
                  <CardView key={i} card={snapshot?.board[i] ?? null} />
                ))}
              </div>
              {snapshot !== null && (
                <div className="pot">
                  {t("table.pot")}: {snapshot.pot}
                </div>
              )}
            </div>
          </div>
        )}

        {state.gameOver && (
          <p className="error">
            {t("table.gameOver")}{" "}
            {state.error === NO_BACKEND_ERROR ? t("table.noBackend") : state.error}
          </p>
        )}

        {game.legalForHuman !== null && snapshot !== null && (
          <div className="your-turn">
            <strong>{t("table.yourTurn")}</strong>
            <ActionBar
              legal={game.legalForHuman}
              currentBet={snapshot.currentBet}
              onAct={game.humanAct}
            />
          </div>
        )}
      </div>

      <div className="table-side">
        {!phone && (
          <div className="row side-tabs">
            <button
              type="button"
              className={showLog ? "" : "secondary"}
              aria-pressed={showLog}
              onClick={() => setPanel("log")}
            >
              {t("tabs.log")}
            </button>
            <button
              type="button"
              className={showStats ? "" : "secondary"}
              aria-pressed={showStats}
              onClick={() => setPanel("stats")}
            >
              {t("tabs.stats")}
            </button>
          </div>
        )}
        {showStats && (
          <StatsPanel
            seats={state.seats}
            session={state.stats}
            cumulative={game.cumulative}
            keys={game.statsKeys}
            startingStack={startingStack}
            onResetCumulative={game.resetCumulative}
            language={language}
          />
        )}
        {showLog && <HistoryPanel log={state.log} names={names} />}
      </div>

      {phone && (
        <nav className="tab-bar">
          {(["table", "stats", "log"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={panel === key ? "" : "secondary"}
              aria-pressed={panel === key}
              onClick={() => setPanel(key)}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}
