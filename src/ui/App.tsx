import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next, { detectLanguage, initI18n, type Language } from "../i18n";
import { loadPersonas, type Persona, saveCustomPersonas } from "../jev/personas";
import { ApiKeyModal } from "./ApiKeyModal";
import { GameScreen } from "./GameScreen";
import { LanguageSwitch } from "./LanguageSwitch";
import { PersonaEditor } from "./PersonaEditor";
import { Setup } from "./Setup";
import {
  clearApiKey,
  loadApiKey,
  loadLanguage,
  loadSettings,
  type Settings,
  saveApiKey,
  saveLanguage,
  saveSettings,
} from "./storage";

type Screen = "setup" | "table" | "personas";

const initialLanguage = detectLanguage(loadLanguage(), globalThis.navigator?.language);
initI18n(initialLanguage);

export function App() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(apiKey === null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas());
  const [screen, setScreen] = useState<Screen>("setup");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const onAuthFailed = useCallback(() => {
    setKeyError(t("apiKey.invalid"));
    setKeyModalOpen(true);
  }, [t]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    saveLanguage(next);
    void i18next.changeLanguage(next);
  };

  const changeSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
  };

  const changePersonas = (next: Persona[]) => {
    setPersonas(next);
    try {
      saveCustomPersonas(next, localStorage);
    } catch {
      // storage unavailable
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t("app.title")}</h1>
          <p className="muted">{t("app.subtitle")}</p>
        </div>
        <nav className="row">
          <button type="button" className="secondary" onClick={() => setKeyModalOpen(true)}>
            {apiKey === null ? t("app.apiKey") : t("app.apiKeySet")}
          </button>
          <LanguageSwitch language={language} onChange={changeLanguage} />
          <a href="https://github.com/nft-syou/jev-poker" target="_blank" rel="noreferrer">
            {t("app.source")}
          </a>
        </nav>
      </header>

      <main>
        {screen === "setup" && (
          <Setup
            settings={settings}
            personas={personas}
            language={language}
            hasApiKey={apiKey !== null}
            onChange={changeSettings}
            onStart={() => setScreen("table")}
            onEditPersonas={() => setScreen("personas")}
            onOpenKey={() => setKeyModalOpen(true)}
          />
        )}
        {screen === "personas" && (
          <PersonaEditor
            personas={personas}
            language={language}
            onChange={changePersonas}
            onBack={() => setScreen("setup")}
          />
        )}
        {screen === "table" && (
          <GameScreen
            settings={settings}
            personas={personas}
            apiKey={apiKey}
            onLeave={() => setScreen("setup")}
            onAuthFailed={onAuthFailed}
          />
        )}
      </main>

      <ApiKeyModal
        open={keyModalOpen}
        currentKey={apiKey}
        error={keyError}
        onSave={(key) => {
          saveApiKey(key);
          setApiKey(key);
          setKeyError(null);
          setKeyModalOpen(false);
        }}
        onRemove={() => {
          clearApiKey();
          setApiKey(null);
          setKeyError(null);
          setScreen("setup");
        }}
        onClose={() => setKeyModalOpen(false)}
      />
    </div>
  );
}
