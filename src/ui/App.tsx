import { loadPersonas, type Persona, saveCustomPersonas } from "@jev-poker/agent";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next, { detectLanguage, initI18n, type Language } from "../i18n";
import type { Connection } from "../jev/connection";
import { ConnectionModal } from "./ConnectionModal";
import { GameScreen } from "./GameScreen";
import { LanguageSwitch } from "./LanguageSwitch";
import { PersonaEditor } from "./PersonaEditor";
import { Setup } from "./Setup";
import {
  clearConnection,
  loadConnection,
  loadLanguage,
  loadSettings,
  type Settings,
  saveConnection,
  saveLanguage,
  saveSettings,
} from "./storage";

type Screen = "setup" | "table" | "personas";

/** Preset a seat falls back to when its persona is deleted. */
const FALLBACK_PERSONA_ID = "tag";

const initialLanguage = detectLanguage(loadLanguage(), globalThis.navigator?.language);
initI18n(initialLanguage);

export function App() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [connection, setConnection] = useState<Connection | null>(() => loadConnection());
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(connection === null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas(localStorage));
  const [screen, setScreen] = useState<Screen>("setup");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const onAuthFailed = useCallback(() => {
    // Deliberately generic: which of the services refused is not ours to guess.
    setKeyError(t("connection.invalid"));
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
    // A seat left pointing at a deleted persona would silently fall back at the table;
    // point it at the default preset instead, and persist the correction.
    const ids = new Set(next.map((p) => p.id));
    const seats = settings.seats.map((seat) =>
      ids.has(seat.personaId) ? seat : { ...seat, personaId: FALLBACK_PERSONA_ID },
    );
    if (seats.some((seat, i) => seat !== settings.seats[i])) {
      changeSettings({ ...settings, seats });
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
            {connection === null ? t("app.connection") : t(`connection.route_${connection.route}`)}
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
            hasConnection={connection !== null}
            onChange={changeSettings}
            onStart={() => setScreen("table")}
            onEditPersonas={() => setScreen("personas")}
            onOpenConnection={() => setKeyModalOpen(true)}
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
            connection={connection}
            language={language}
            onSettingsChange={changeSettings}
            onLeave={() => setScreen("setup")}
            onAuthFailed={onAuthFailed}
          />
        )}
      </main>

      <ConnectionModal
        open={keyModalOpen}
        connection={connection}
        error={keyError}
        onSave={(next) => {
          saveConnection(next);
          setConnection(next);
          setKeyError(null);
          setKeyModalOpen(false);
        }}
        onRemove={() => {
          clearConnection();
          setConnection(null);
          setKeyError(null);
          setScreen("setup");
        }}
        onClose={() => {
          setKeyError(null);
          setKeyModalOpen(false);
        }}
      />
    </div>
  );
}
