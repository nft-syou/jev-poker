import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Action, LegalActions } from "../engine/types";

interface Props {
  legal: LegalActions;
  currentBet: number;
  onAct: (action: Action) => void;
}

export function ActionBar({ legal, currentBet, onAct }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const min = legal.minRaiseTo ?? 0;
  const max = legal.maxRaiseTo ?? 0;
  const [amount, setAmount] = useState(min);
  useEffect(() => setAmount(min), [min]);
  const clamped = Math.max(min, Math.min(max, Math.round(Number.isFinite(amount) ? amount : min)));
  const canRaise = legal.minRaiseTo !== null && legal.maxRaiseTo !== null;
  const raiseKey = currentBet === 0 ? "bet" : "raise";

  return (
    <div className="action-bar">
      {legal.canFold && (
        <button type="button" className="secondary" onClick={() => onAct({ type: "fold" })}>
          {t("actions.fold")}
        </button>
      )}
      {legal.canCheck && (
        <button type="button" onClick={() => onAct({ type: "check" })}>
          {t("actions.check")}
        </button>
      )}
      {legal.callAmount !== null && (
        <button type="button" onClick={() => onAct({ type: "call" })}>
          {t("actions.call", { amount: legal.callAmount })}
        </button>
      )}
      {canRaise && (
        <>
          <label htmlFor={id} className="visually-hidden">
            {t("actions.amount")}
          </label>
          <input
            id={id}
            type="number"
            min={min}
            max={max}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
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
          <button
            type="button"
            onClick={() =>
              onAct(clamped >= max ? { type: "allin" } : { type: raiseKey, amount: clamped })
            }
          >
            {t(`actions.${raiseKey}`, { amount: clamped })}
          </button>
          {max > clamped && (
            <button type="button" className="secondary" onClick={() => onAct({ type: "allin" })}>
              {t("actions.allin", { amount: max })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
