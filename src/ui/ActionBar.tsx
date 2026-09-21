import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Action, LegalActions } from "../engine/types";
import { potShare, type SizingSpot, sizingPresets } from "./betSizing";

interface Props {
  legal: LegalActions;
  currentBet: number;
  /** Everything contributed so far, this street's bets included. */
  pot: number;
  bigBlind: number;
  preflop: boolean;
  onAct: (action: Action) => void;
}

/** One decimal at most, and none when it is a whole number of big blinds. */
function inBigBlinds(amount: number, bigBlind: number): string {
  return String(Math.round((amount / bigBlind) * 10) / 10);
}

/**
 * A commit button's face: what it does over how much. One line ("オールイン (200)") was wider
 * than a third of a small phone; stacked, the amount can grow a digit without cutting the verb.
 * The button's accessible name stays the full sentence.
 */
function Stacked({ name, amount }: { name: string; amount: number }) {
  return (
    <>
      <span className="act-name">{name}</span>
      <span className="act-amount">{amount}</span>
    </>
  );
}

/**
 * The player's controls, in two rows. Picking a size and committing to it are separate
 * steps on purpose: the top row (one-tap sizes, a stepper, the slider) only ever changes the
 * number, and the bottom row is the three things that end the turn, always in the same
 * order and the same width so a thumb finds them without looking.
 *
 * There is no separate all-in button beside them. All-in is a size like any other: tapping
 * it fills in the stack and the commit button then says so, which makes shoving a deliberate
 * two-tap move instead of a slip next to "call".
 */
export function ActionBar({ legal, currentBet, pot, bigBlind, preflop, onAct }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const min = legal.minRaiseTo ?? 0;
  const max = legal.maxRaiseTo ?? 0;
  const [amount, setAmount] = useState(min);
  useEffect(() => setAmount(min), [min]);
  const clamped = Math.max(min, Math.min(max, Math.round(Number.isFinite(amount) ? amount : min)));
  const canRaise = legal.minRaiseTo !== null && legal.maxRaiseTo !== null;
  // A stack too short for a full raise can only shove: there is no size to pick.
  const canSize = canRaise && max > min;
  const raiseKey = currentBet === 0 ? "bet" : "raise";
  const shoving = clamped >= max;

  const spot: SizingSpot = {
    pot,
    currentBet,
    callAmount: legal.callAmount ?? 0,
    preflop,
    min,
    max,
  };
  const share = potShare(spot, clamped);
  const step = Math.max(1, bigBlind);

  return (
    <div className="action-bar">
      {canSize && (
        <div className="action-sizing">
          <div className="sizing-presets">
            {sizingPresets(spot).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={preset.amount === clamped ? "preset active" : "preset"}
                disabled={!preset.available}
                aria-pressed={preset.amount === clamped}
                onClick={() => setAmount(preset.amount)}
              >
                {t(`actions.size.${preset.id}`)}
              </button>
            ))}
          </div>
          <div className="sizing-fine">
            <button
              type="button"
              className="secondary stepper"
              aria-label={t("actions.less")}
              disabled={clamped <= min}
              onClick={() => setAmount(clamped - step)}
            >
              −
            </button>
            <label htmlFor={id} className="visually-hidden">
              {t("actions.amount")}
            </label>
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <button
              type="button"
              className="secondary stepper"
              aria-label={t("actions.more")}
              disabled={clamped >= max}
              onClick={() => setAmount(clamped + step)}
            >
              +
            </button>
            <input
              type="range"
              aria-hidden="true"
              tabIndex={-1}
              min={min}
              max={max}
              step={1}
              value={clamped}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <p className="sizing-info muted">
            {share === null
              ? t("actions.sizeInfoNoPot", { bb: inBigBlinds(clamped, bigBlind) })
              : t("actions.sizeInfo", {
                  bb: inBigBlinds(clamped, bigBlind),
                  percent: Math.round(share * 100),
                })}
          </p>
        </div>
      )}

      <div className="action-main">
        {legal.canFold && (
          <button type="button" className="secondary fold" onClick={() => onAct({ type: "fold" })}>
            {t("actions.fold")}
          </button>
        )}
        {legal.canCheck && (
          <button type="button" className="passive" onClick={() => onAct({ type: "check" })}>
            {t("actions.check")}
          </button>
        )}
        {legal.callAmount !== null && (
          <button
            type="button"
            className="passive"
            aria-label={t("actions.call", { amount: legal.callAmount })}
            onClick={() => onAct({ type: "call" })}
          >
            <Stacked name={t("actions.short.call")} amount={legal.callAmount} />
          </button>
        )}
        {canRaise && (
          <button
            type="button"
            className={shoving ? "aggressive shove" : "aggressive"}
            aria-label={
              shoving
                ? t("actions.allin", { amount: max })
                : t(`actions.${raiseKey}`, { amount: clamped })
            }
            onClick={() => onAct(shoving ? { type: "allin" } : { type: raiseKey, amount: clamped })}
          >
            <Stacked
              name={t(`actions.short.${shoving ? "allin" : raiseKey}`)}
              amount={shoving ? max : clamped}
            />
          </button>
        )}
      </div>
    </div>
  );
}
