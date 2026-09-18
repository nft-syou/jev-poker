import { useMemo } from "react";
import { createTypeSafeBackend, type JevBackend } from "../jev/backend";
import type { Persona } from "../jev/personas";
import type { Settings } from "./storage";
import { TableView } from "./TableView";
import { useGame } from "./useGame";

interface Props {
  settings: Settings;
  personas: readonly Persona[];
  apiKey: string | null;
  onSettingsChange: (settings: Settings) => void;
  onLeave: () => void;
  onAuthFailed: () => void;
}

export function GameScreen({
  settings,
  personas,
  apiKey,
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
  return (
    <TableView
      game={game}
      speed={settings.speed}
      onSpeedChange={(speed) => onSettingsChange({ ...settings, speed })}
      onLeave={onLeave}
    />
  );
}
