import { useTranslation } from "react-i18next";
import { LANGUAGES, type Language } from "../i18n";

interface Props {
  language: Language;
  onChange: (language: Language) => void;
}

export function LanguageSwitch({ language, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <label className="language-switch">
      <span className="visually-hidden">{t("app.language")}</span>
      <select value={language} onChange={(e) => onChange(e.target.value as Language)}>
        {LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {lng === "ja" ? "日本語" : "English"}
          </option>
        ))}
      </select>
    </label>
  );
}
