import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { HandPlayerSnapshot } from "../engine/types";
import { CardView } from "./CardView";
import type { GameSeat } from "./useGame";

interface Props {
  seat: GameSeat;
  player: HandPlayerSnapshot | undefined;
  isButton: boolean;
  isActing: boolean;
  isThinking: boolean;
  revealCards: boolean;
  style: CSSProperties;
}

export function SeatView({
  seat,
  player,
  isButton,
  isActing,
  isThinking,
  revealCards,
  style,
}: Props) {
  const { t } = useTranslation();
  const folded = player?.folded ?? false;
  const classes = ["seat", isActing ? "acting" : "", folded ? "folded" : ""].join(" ");
  return (
    <div className={classes} style={style}>
      <div className="seat-cards">
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
      {player !== undefined && player.streetBet > 0 && (
        <div className="seat-bet">{player.streetBet}</div>
      )}
    </div>
  );
}
