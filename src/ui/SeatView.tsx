import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HandPlayerSnapshot } from "../engine/types";
import { CalloutView, INWARD_UP, type Inward } from "./CalloutView";
import { CardView } from "./CardView";
import type { Callout } from "./fx";
import type { GameSeat } from "./useGame";

interface Props {
  seat: GameSeat;
  player: HandPlayerSnapshot | undefined;
  isButton: boolean;
  isActing: boolean;
  isThinking: boolean;
  revealCards: boolean;
  style: CSSProperties;
  /** Rendered inside the seat, which is the positioning context for a decision bubble. */
  overlay?: ReactNode;
  /** The seat's most recent shout, if it still has one. */
  callout?: Callout | null;
  bigBlind?: number;
  /** When this seat last won a pot; a new value restarts its glow. Zero for never. */
  winnerAt?: number;
  /** When cards were last revealed at showdown; a new value restarts the flip. */
  flipAt?: number;
  /** Which way the middle of the felt is, so the callout can be thrown that way. */
  inward?: Inward;
}

export function SeatView({
  seat,
  player,
  isButton,
  isActing,
  isThinking,
  revealCards,
  style,
  overlay,
  callout = null,
  bigBlind = 0,
  winnerAt = 0,
  flipAt = 0,
  inward = INWARD_UP,
}: Props) {
  const { t } = useTranslation();
  const folded = player?.folded ?? false;
  const classes = ["seat", isActing ? "acting" : "", folded ? "folded" : ""].join(" ");
  return (
    <div className={classes} style={style}>
      {/* Keyed by the callout, so a seat that acts twice running flashes twice. */}
      {callout !== null && (
        <span key={callout.id} className={`seat-flash flash-${callout.kind}`} aria-hidden="true" />
      )}
      {winnerAt > 0 && <span key={winnerAt} className="winner-glow" aria-hidden="true" />}
      <div className={flipAt > 0 ? "seat-cards flipping" : "seat-cards"} key={flipAt}>
        {player !== undefined && !folded ? (
          <>
            <CardView card={player.holeCards[0]} hidden={!revealCards} />
            <CardView card={player.holeCards[1]} hidden={!revealCards} />
          </>
        ) : (
          <>
            <CardView card={null} />
            <CardView card={null} />
          </>
        )}
      </div>
      <div className="seat-name">
        {isButton && <span className="dealer-button">{t("table.dealer")}</span>}
        {seat.name}
      </div>
      <div className="seat-stack">{player?.stack ?? seat.stack}</div>
      <div className="seat-status">
        {isThinking && t("table.thinking")}
        {player?.allIn && t("table.allIn")}
        {folded && t("table.folded")}
      </div>
      {callout !== null && (
        <CalloutView
          key={callout.id}
          kind={callout.kind}
          amount={callout.amount}
          bigBlind={bigBlind}
          inward={inward}
        />
      )}
      {overlay}
    </div>
  );
}
