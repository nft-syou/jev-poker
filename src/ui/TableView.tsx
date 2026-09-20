import { type CSSProperties, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SeatId } from "../engine/types";
import type { Language } from "../i18n";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { ChipStack } from "./ChipStack";
import { DecisionBubble } from "./DecisionBubble";
import { cardText } from "./format";
import { handsPerMinute } from "./fx";
import { HistoryPanel } from "./HistoryPanel";
import { SeatView } from "./SeatView";
import { ShowcasePanel } from "./ShowcasePanel";
import { StatsPanel } from "./StatsPanel";
import { SPEEDS, type Speed } from "./storage";
import { TableFxLayer } from "./TableFxLayer";
import { Ticker } from "./Ticker";
import { presentationTimings } from "./timings";
import { useCountUp } from "./useCountUp";
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
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * How far from the rail a seat's chips sit, as a fraction of the seat's own distance from
 * the middle: the bet lands a third of the way in, between the player and the pot.
 */
const BET_SPOT = 0.65;

function mediaMatches(query: string): boolean {
  // jsdom (and any non-browser host) has no matchMedia; treat those as a wide, moving screen.
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

/** Tracks one media query. Used for the phone layout and for reduced motion. */
function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => mediaMatches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setOn(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return on;
}

/** The pot, drawn as chips, with its number rolling to whatever the last action made it. */
function PotView({ pot, bigBlind, ms }: { pot: number; bigBlind: number; ms: number }) {
  const { t } = useTranslation();
  const shown = useCountUp(pot, ms);
  const label = `${t("table.pot")}: ${shown}`;
  if (pot <= 0) return <div className="pot">{label}</div>;
  return <ChipStack className="pot" amount={pot} bigBlind={bigBlind} label={label} />;
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
  const phone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
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
  const bigBlind = snapshot?.bigBlind ?? 0;

  // Where each seat sits on the ellipse, and where its chips go: both are wanted by the
  // seats, by the bet stacks and by anything flying between them, so they are worked out
  // once here rather than three times over.
  const layout = state.seats.map((seat, index) => {
    const angle = ((index - anchorIndex) / count) * 2 * Math.PI + Math.PI / 2;
    const dx = radiusX * Math.cos(angle);
    const dy = radiusY * Math.sin(angle);
    return {
      seat,
      player: snapshot?.players.find((p) => p.seat === seat.id),
      x: 50 + dx,
      y: 50 + dy,
      betX: 50 + dx * BET_SPOT,
      betY: 50 + dy * BET_SPOT,
    };
  });
  const spots = new Map(
    layout.map(({ seat, x, y, betX, betY }) => [seat.id, { x, y, betX, betY }]),
  );

  // The effects layer keeps a short history; only each seat's newest shout is on screen.
  const fx = state.fx;
  const calloutBySeat = new Map<SeatId, (typeof fx.callouts)[number]>();
  for (const callout of fx.callouts) calloutBySeat.set(callout.seat, callout);
  const rate = handsPerMinute(fx.handTimes);
  /** Durations the felt's animations read; one place to change, one place to speed up. */
  const feltVars = {
    "--callout-ms": `${timings.calloutMs}ms`,
    "--chip-ms": `${timings.chipMoveMs}ms`,
    "--glow-ms": `${timings.winnerGlowMs}ms`,
    "--flip-ms": `${timings.cardFlipMs}ms`,
  } as CSSProperties;

  return (
    <section className={showcase ? "table-screen showcase-mode" : "table-screen"}>
      <div className="table-main">
        <div className="table-header row">
          <span>{snapshot !== null && t("table.hand", { number: snapshot.handNumber + 1 })}</span>
          {game.spectator && !phone && !showcase && (
            <span className="badge">{t("table.spectating")}</span>
          )}
          {game.spectator && !phone && rate !== null && (
            <span className="badge">{t("table.handsPerMin", { rate })}</span>
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
          <div className="felt" style={feltVars}>
            {layout.map(({ seat, player, x, y }) => {
              const style = { left: `${x}%`, top: `${y}%` };
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
                  callout={calloutBySeat.get(seat.id) ?? null}
                  bigBlind={bigBlind}
                  winnerAt={fx.winners.includes(seat.id) ? fx.winnersAt : 0}
                  flipAt={revealAll ? fx.flipAt : 0}
                />
              );
            })}

            {/* Chips on their way out to a bet, into the pot, or home to a winner. */}
            <TableFxLayer moves={fx.chipMoves} spots={spots} bigBlind={bigBlind} />

            {/* Each seat's live bet, drawn as chips between the player and the middle. */}
            {layout.map(({ seat, player, betX, betY }) => (
              <ChipStack
                key={seat.id}
                className="bet-stack"
                amount={player?.streetBet ?? 0}
                bigBlind={bigBlind}
                style={{ left: `${betX}%`, top: `${betY}%` }}
              />
            ))}

            <div className="board">
              <div className="board-cards">
                {[0, 1, 2, 3, 4].map((i) => {
                  const card = snapshot?.board[i] ?? null;
                  // Keying on the card itself remounts only the slots that just changed, so
                  // a new street's cards pop in and the ones already out stay put.
                  return (
                    <CardView key={`${i}:${card === null ? "" : cardText(card)}`} card={card} />
                  );
                })}
              </div>
              {snapshot !== null && (
                <PotView
                  pot={snapshot.pot}
                  bigBlind={bigBlind}
                  ms={reducedMotion ? 0 : timings.potCountMs}
                />
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
