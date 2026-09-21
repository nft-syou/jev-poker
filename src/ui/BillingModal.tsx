import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { JevRoute } from "../jev/connection";

interface Props {
  open: boolean;
  /** Who charged for the call, so the text does not blame the wrong account. */
  route: JevRoute;
  onResume: () => void;
  onClose: () => void;
}

const TOP_UP_LINKS: Record<JevRoute, string> = {
  typesafe: "https://typesafe.ai",
  vercel: "https://vercel.com/docs/ai-gateway",
  lolipop: "https://ai-gateway.lolipop.jp/",
  cloudflare: "https://typesafe.ai",
};

/**
 * Shown when the service returns 402 Payment Required: the account is out of credit, so every
 * CPU decision fails open. Unlike the auth modal, nothing here fixes itself when the backend
 * changes — the same key is still valid — so the table stays paused until `onResume` is used.
 */
export function BillingModal({ open, route, onResume, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  if (!open) return null;
  // Vercel and Lolipop bill their own credit; the other routes are paid with a TypeSafe key.
  const suffix = route === "vercel" || route === "lolipop" ? `_${route}` : "";
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{t("billing.title")}</h2>
        <p>{t(`billing.description${suffix}`)}</p>
        <p>
          <a href={TOP_UP_LINKS[route]} target="_blank" rel="noreferrer">
            {t(`billing.topUp${suffix}`)}
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
