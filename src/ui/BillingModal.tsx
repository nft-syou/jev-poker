import { useId } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onResume: () => void;
  onClose: () => void;
}

/**
 * Shown when TypeSafe returns 402 Payment Required: the account is out of credit, so every
 * CPU decision fails open. Unlike the auth modal, nothing here fixes itself when the backend
 * changes — the same key is still valid — so the table stays paused until `onResume` is used.
 */
export function BillingModal({ open, onResume, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{t("billing.title")}</h2>
        <p>{t("billing.description")}</p>
        <p>
          <a href="https://typesafe.ai" target="_blank" rel="noreferrer">
            {t("billing.topUp")}
          </a>
        </p>
        <div className="row">
          <button type="button" onClick={onResume}>
            {t("billing.resume")}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {t("billing.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
