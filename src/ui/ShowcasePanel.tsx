import { useTranslation } from "react-i18next";
import { actionText, DecisionCost, ProbabilityBars, showNumber, sizingLevel } from "./showcase";
import type { LastDecision } from "./useGame";

interface Props {
  last: LastDecision | null;
  /** Name of the persona that seat plays; the seat's own name when none is known. */
  personaName: string;
  bigBlind: number;
  model: string;
}

/**
 * The right-hand column of the recording layout: the decision the table just played, in
 * full, at a size a screen recording can read.
 */
export function ShowcasePanel({ last, personaName, bigBlind, model }: Props) {
  const { t } = useTranslation();
  const shown = last?.record.jev?.model ?? model;

  return (
    <aside className="showcase-panel">
      {last === null ? (
        <p className="showcase-waiting">{t("showcase.waiting")}</p>
      ) : (
        <Decision last={last} personaName={personaName} bigBlind={bigBlind} />
      )}
      <footer className="showcase-footer">{t("showcase.poweredByModel", { model: shown })}</footer>
    </aside>
  );
}

function Decision({ last, personaName, bigBlind }: Omit<Props, "model">) {
  const { t } = useTranslation();
  if (last === null) return null;
  const { record, features } = last;
  const { hand, table } = features;
  // What Jev was told about the cards: the made hand (post-flop), what it is drawing to,
  // and how the two hole cards rank before the flop.
  const summary = [
    ...(hand.madeHand === null ? [] : [t(`hands.${hand.madeHand}`)]),
    ...hand.draws.map((draw) => t(`showcase.draw_${draw}`)),
    t(`showcase.strength_${hand.preflopStrength}`),
  ].join(" · ");

  return (
    <div className="showcase-decision">
      <div className="showcase-who">
        <span className="showcase-persona">{personaName}</span>
        <span className="showcase-where">
          {table.position} · {t(`streets.${hand.street}`)}
        </span>
      </div>

      <strong className="showcase-action">
        {actionText(t, record.action, bigBlind, features)}
      </strong>

      <p className="showcase-summary">{summary}</p>
      <dl className="showcase-facts">
        <div>
          <dt>{t("showcase.pot")}</dt>
          <dd>{t("showcase.bb", { value: showNumber(table.potBB) })}</dd>
        </div>
        <div>
          <dt>{t("showcase.toCall")}</dt>
          <dd>{t("showcase.bb", { value: showNumber(table.toCallBB) })}</dd>
        </div>
      </dl>

      {record.jev === null ? (
        <p className="showcase-unavailable">{t("showcase.unavailable")}</p>
      ) : (
        <>
          <ProbabilityBars record={record} t={t} />
          <dl className="showcase-facts">
            <div>
              <dt>{t("showcase.sizing")}</dt>
              <dd>{t(`showcase.sizing_${sizingLevel(record.jev.sizingScore)}`)}</dd>
            </div>
            <div>
              <dt>{t("showcase.bluff")}</dt>
              <dd>{Math.round(record.jev.bluffIntent * 100)}%</dd>
            </div>
          </dl>
        </>
      )}
      <div className="showcase-meta">
        <DecisionCost record={record} t={t} />
      </div>
    </div>
  );
}
