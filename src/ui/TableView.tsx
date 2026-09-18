import { useTranslation } from "react-i18next";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { HistoryPanel } from "./HistoryPanel";
import { SeatView } from "./SeatView";
import type { GameController } from "./useGame";

interface Props {
  game: GameController;
  onLeave: () => void;
}

export function TableView({ game, onLeave }: Props) {
  const { t } = useTranslation();
  const { state } = game;
  const snapshot = state.snapshot;
  const names = new Map(state.seats.map((s) => [s.id, s.name]));
  const count = state.seats.length;
  // Put the first human seat (or seat 0) at the bottom of the table.
  const anchor = game.humanSeats[0] ?? 0;
  const anchorIndex = state.seats.findIndex((s) => s.id === anchor);
  const revealAll = game.spectator || snapshot?.street === "showdown";

  return (
    <section className="table-screen">
      <div className="table-header row">
        <span>{snapshot !== null && t("table.hand", { number: snapshot.handNumber + 1 })}</span>
        {game.spectator && <span className="badge">{t("table.spectating")}</span>}
        <button type="button" className="secondary" onClick={game.togglePause}>
          {state.paused ? t("table.resume") : t("table.pause")}
        </button>
        <button type="button" className="secondary" onClick={onLeave}>
          {t("table.leave")}
        </button>
      </div>

      <div className="felt">
        {state.seats.map((seat, index) => {
          const angle = ((index - anchorIndex) / count) * 2 * Math.PI + Math.PI / 2;
          const style = {
            left: `${50 + 42 * Math.cos(angle)}%`,
            top: `${50 + 40 * Math.sin(angle)}%`,
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
      {state.gameOver && (
        <p className="error">
          {t("table.gameOver")} {state.error}
        </p>
      )}

      <HistoryPanel log={state.log} names={names} />
    </section>
  );
}
