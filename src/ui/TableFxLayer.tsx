import type { CSSProperties } from "react";
import type { SeatId } from "../engine/types";
import { ChipStack } from "./ChipStack";
import type { ChipMove } from "./fx";

/** Where a seat and its bet sit on the felt, in percent of the felt's own box. */
export interface SeatSpot {
  x: number;
  y: number;
  betX: number;
  betY: number;
}

interface Props {
  moves: readonly ChipMove[];
  spots: ReadonlyMap<SeatId, SeatSpot>;
  bigBlind: number;
}

const MIDDLE = { x: 50, y: 50 };

/**
 * Chips in flight. Each move is drawn as a felt-sized layer holding one stack: because the
 * layer is exactly as big as the felt, a percentage translate on it is a percentage of the
 * felt, which is what lets the whole journey be one `transform` and nothing else.
 *
 * Nothing here is ever taken down on a timer. The animation ends on `opacity: 0` and holds
 * there, and the moves are capped in the state, so a table at max speed costs no re-render
 * just to make a chip disappear.
 */
export function TableFxLayer({ moves, spots, bigBlind }: Props) {
  return (
    <>
      {moves.map((move) => {
        const spot = spots.get(move.seat);
        if (spot === undefined) return null;
        const seat = { x: spot.x, y: spot.y };
        const bet = { x: spot.betX, y: spot.betY };
        const from = move.kind === "toBet" ? seat : move.kind === "toPot" ? bet : MIDDLE;
        const to = move.kind === "toBet" ? bet : move.kind === "toPot" ? MIDDLE : seat;
        return (
          <div
            key={move.id}
            className="chip-fly"
            aria-hidden="true"
            style={{ "--dx": `${from.x - to.x}%`, "--dy": `${from.y - to.y}%` } as CSSProperties}
          >
            <ChipStack
              className="chip-fly-stack"
              amount={move.amount}
              bigBlind={bigBlind}
              style={{ left: `${to.x}%`, top: `${to.y}%` }}
              // Only a pot coming home is worth a number; the rest would just be clutter.
              label={move.kind === "toSeat" ? `+${move.amount}` : ""}
            />
          </div>
        );
      })}
    </>
  );
}
