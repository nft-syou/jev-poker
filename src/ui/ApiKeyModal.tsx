import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  currentKey: string | null;
  error: string | null;
  onSave: (key: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ApiKeyModal({ open, currentKey, error, onSave, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputId = useId();
  if (!open) return null;
  const trimmed = value.trim();
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${inputId}-title`}>
        <h2 id={`${inputId}-title`}>{t("apiKey.title")}</h2>
        <p>{t("apiKey.description")}</p>
        <p className="muted">{t("apiKey.privacy")}</p>
        {error !== null && <p className="error">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed.length > 0) {
              onSave(trimmed);
              setValue("");
            }
          }}
        >
          <label htmlFor={inputId}>{t("app.apiKey")}</label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            placeholder={t("apiKey.placeholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="row">
            <button type="submit" disabled={trimmed.length === 0}>
              {t("apiKey.save")}
            </button>
            {currentKey !== null && (
              <button type="button" className="secondary" onClick={onRemove}>
                {t("apiKey.remove")}
              </button>
            )}
            {currentKey !== null && (
              <button type="button" className="secondary" onClick={onClose}>
                {t("apiKey.close")}
              </button>
            )}
          </div>
        </form>
        <p>
          <a href="https://typesafe.ai" target="_blank" rel="noreferrer">
            {t("apiKey.getOne")}
          </a>
        </p>
      </div>
    </div>
  );
}
