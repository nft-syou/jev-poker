import { useMemo } from "react";
import type { SeatId } from "../engine/types";
import type { Language } from "../i18n";
import { createTypeSafeBackend, type JevBackend } from "../jev/backend";
import type { Persona } from "../jev/personas";
import type { Settings } from "./storage";
import { TableView } from "./TableView";
import { useGame } from "./useGame";

interface Props {
  settings: Settings;
  personas: readonly Persona[];
  apiKey: string | null;
  language: Language;
  onSettingsChange: (settings: Settings) => void;
  onLeave: () => void;
  onAuthFailed: () => void;
}

export function GameScreen({
  settings,
  personas,
  apiKey,
  language,
  onSettingsChange,
  onLeave,
  onAuthFailed,
}: Props) {
  const backend: JevBackend | null = useMemo(
    () =>
      apiKey === null
        ? null
        : createTypeSafeBackend({
            apiKey,
            baseURL: `${window.location.origin}/api/jev`,
            model: settings.model,
          }),
    [apiKey, settings.model],
  );
  const game = useGame({ settings, personas, backend, onAuthFailed });
  // Recording mode names the character, not the chair, so the overlays get persona names.
  const personaNames = useMemo(() => {
    const byId = new Map(personas.map((p) => [p.id, p.name[language]]));
    const names: Record<SeatId, string> = {};
    settings.seats.forEach((seat, id) => {
      const name = seat.kind === "cpu" ? byId.get(seat.personaId) : undefined;
      names[id] = name ?? seat.name;
    });
    return names;
  }, [language, personas, settings.seats]);

  return (
    <TableView
      game={game}
      speed={settings.speed}
      startingStack={settings.startingStack}
      language={language}
      personaNames={personaNames}
      model={settings.model}
      onSpeedChange={(speed) => onSettingsChange({ ...settings, speed })}
      onLeave={onLeave}
    />
  );
}
