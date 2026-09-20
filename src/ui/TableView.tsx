import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SeatId } from "../engine/types";
import type { Language } from "../i18n";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { DecisionBubble } from "./DecisionBubble";
import { HistoryPanel } from "./HistoryPanel";
import { SeatView } from "./SeatView";
import { ShowcasePanel } from "./ShowcasePanel";
import { StatsPanel } from "./StatsPanel";
import { SPEEDS, type Speed } from "./storage";
import { Ticker } from "./Ticker";
import { presentationTimings } from "./timings";
import { type GameController, NO_BACKEND_ERROR } from "./useGame";

interface Props {
  game: GameController;
  speed: Speed;
  startingStack: number;
  language: Language;
  onSpeedChange: (speed: Speed) => void;
  onLeave: () => void;
  /** Persona name per seat, for the recording overlays; the seat's own name otherwise. */
  personaNames?: Record<SeatId, string>;
  /** Model the table asks for, shown when no decision has named one yet. */
  model?: string;
  /** Whether CPU turns are speculatively prefetched; the header toggle mirrors it. */
  prefetch?: boolean;
  onPrefetchChange?: (prefetch: boolean) => void;
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

export function TableView({
  game,
  speed,
  startingStack,
  language,
  onSpeedChange,
  onLeave,
  personaNames,
  model,
  prefetch,
  onPrefetchChange,
}: Props) {
  const { t } = useTranslation();
  const speedId = useId();
  const phone = usePhone();
  const timings = presentationTimings(speed);
  const [panel, setPanel] = useState<Panel>("table");
  /** Recording mode: the table alone, narrated. Kept here, and only for this sitting. */
  const [showcase, setShowcase] = useState(false);

  // The body carries the mode, so the chrome outside this component can step aside too.
  useEffect(() => {
    if (!showcase) return;
    document.body.classList.add("showcase");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowcase(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("showcase");
      document.removeEventListener("keydown", onKey);
    };
  }, [showcase]);

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
  // side column carries whichever of the two panels the tab switch selected. Recording mode
  // takes the side column for itself.
  const showFelt = !phone || panel === "table" || showcase;
  const showStats = !showcase && panel === "stats";
  const showLog = !showcase && (phone ? panel === "log" : panel !== "stats");
  const last = state.lastDecision;
  const nameOf = (seat: SeatId) => personaNames?.[seat] ?? names.get(seat) ?? `#${seat}`;

  return (
    <section className={showcase ? "table-screen showcase-mode" : "table-screen"}>
      <div className="table-main">
        <div className="table-header row">
          <span>{snapshot !== null && t("table.hand", { number: snapshot.handNumber + 1 })}</span>
          {game.spectator && !phone && !showcase && (
            <span className="badge">{t("table.spectating")}</span>
          )}
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
          {state.pauseReason === "billing" && !showcase && (
            <span className="badge">{t("table.pausedBilling")}</span>
          )}
          {showcase ? (
            <button
              type="button"
              className="secondary showcase-exit"
              aria-label={t("showcase.exit")}
              onClick={() => setShowcase(false)}
            >
              ×
            </button>
          ) : (
            <>
              {onPrefetchChange !== undefined && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onPrefetchChange(!(prefetch ?? true))}
                >
                  {(prefetch ?? true) ? t("table.prefetchOn") : t("table.prefetchOff")}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setShowcase(true)}>
                {t("showcase.toggle")}
              </button>
              <button type="button" className="secondary" onClick={onLeave}>
                {t("table.leave")}
              </button>
            </>
          )}
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
              const thinking = state.thinkingSeat === seat.id;
              // A seat is narrated while it thinks, and for a moment after it has decided.
              const decided = last !== null && last.seat === seat.id ? last : null;
              const bubble =
                showcase && (thinking || decided !== null) ? (
                  <DecisionBubble
                    seat={seat.id}
                    personaName={nameOf(seat.id)}
                    thinking={thinking}
                    decision={decided?.record ?? null}
                    features={decided?.features ?? null}
                    bigBlind={snapshot?.bigBlind ?? 0}
                    visibleUntil={decided === null ? null : decided.at + timings.decisionHoldMs}
                    speed={speed}
                  />
                ) : null;
              return (
                <SeatView
                  key={seat.id}
                  seat={seat}
                  player={player}
                  isButton={snapshot?.button === seat.id}
                  isActing={snapshot?.actingSeat === seat.id && !snapshot.complete}
                  isThinking={thinking}
                  revealCards={revealAll || game.humanSeats.includes(seat.id)}
                  style={style}
                  overlay={bubble}
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
        {showcase && (
          <ShowcasePanel
            last={last}
            personaName={last === null ? "" : nameOf(last.seat)}
            bigBlind={snapshot?.bigBlind ?? 0}
            model={model ?? ""}
          />
        )}
        {!showcase && !phone && (
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

      {showcase && (
        <div className="showcase-bottom">
          <Ticker
            stats={state.stats}
            prefetch={state.prefetch}
            handsPlayed={state.handsPlayed}
            maxPot={state.maxPot}
          />
          <p className="showcase-corner">{t("showcase.poweredBy")}</p>
        </div>
      )}

      {!showcase && phone && (
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
