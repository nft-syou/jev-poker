import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "../i18n";
import type { Persona } from "../jev/personas";
import {
  DEFAULT_SEATS,
  PREFETCH_MAX_IN_FLIGHT_OPTIONS,
  type SeatSetting,
  type Settings,
  SPEEDS,
  validateSettings,
} from "./storage";

interface Props {
  settings: Settings;
  personas: readonly Persona[];
  language: Language;
  hasApiKey: boolean;
  onChange: (settings: Settings) => void;
  onStart: () => void;
  onEditPersonas: () => void;
  onOpenKey: () => void;
}

export function Setup({
  settings,
  personas,
  language,
  hasApiKey,
  onChange,
  onStart,
  onEditPersonas,
  onOpenKey,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const problem = validateSettings(settings);
  const spectator = settings.seats.every((s) => s.kind === "cpu");
  const canStart = hasApiKey && problem === null;

  const updateSeat = (index: number, patch: Partial<SeatSetting>) => {
    const seats = settings.seats.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange({ ...settings, seats });
  };

  const setSeatCount = (count: number) => {
    const seats = Array.from(
      { length: count },
      (_, i) =>
        settings.seats[i] ??
        DEFAULT_SEATS[i] ?? { name: `CPU ${i + 1}`, kind: "cpu" as const, personaId: "tag" },
    );
    onChange({ ...settings, seats });
  };

  const number = (key: "startingStack" | "smallBlind" | "bigBlind") => (
    <label className="field">
      <span>{t(`setup.${key}`)}</span>
      <input
        type="number"
        min={1}
        value={settings[key]}
        onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <section className="setup">
      <h2>{t("setup.title")}</h2>
      <div className="grid">
        <label className="field" htmlFor={`${id}-seats`}>
          <span>{t("setup.seats")}</span>
          <select
            id={`${id}-seats`}
            value={settings.seats.length}
            onChange={(e) => setSeatCount(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {number("startingStack")}
        {number("smallBlind")}
        {number("bigBlind")}
        <label className="field">
          <span>{t("setup.speed")}</span>
          <select
            value={settings.speed}
            onChange={(e) => onChange({ ...settings, speed: e.target.value as Settings["speed"] })}
          >
            {SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {t(`setup.speed_${speed}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={settings.prefetch}
              onChange={(e) => onChange({ ...settings, prefetch: e.target.checked })}
            />{" "}
            {t("setup.prefetch")}
          </span>
        </label>
        {settings.prefetch && (
          <label className="field">
            <span>{t("setup.prefetchMaxInFlight")}</span>
            <select
              value={settings.prefetchMaxInFlight}
              onChange={(e) =>
                onChange({ ...settings, prefetchMaxInFlight: Number(e.target.value) })
              }
            >
              {PREFETCH_MAX_IN_FLIGHT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <table className="seats">
        <thead>
          <tr>
            <th>#</th>
            <th>{t("setup.seatName")}</th>
            <th>{t("setup.seatKind")}</th>
            <th>{t("setup.persona")}</th>
          </tr>
        </thead>
        <tbody>
          {settings.seats.map((seat, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: seats have no stable id
            <tr key={`${id}-seat-${index}`}>
              <td>{index + 1}</td>
              <td>
                <input
                  aria-label={`${t("setup.seatName")} ${index + 1}`}
                  value={seat.name}
                  onChange={(e) => updateSeat(index, { name: e.target.value })}
                />
              </td>
              <td>
                <select
                  aria-label={`${t("setup.seatKind")} ${index + 1}`}
                  value={seat.kind}
                  onChange={(e) =>
                    updateSeat(index, { kind: e.target.value as SeatSetting["kind"] })
                  }
                >
                  <option value="human">{t("setup.human")}</option>
                  <option value="cpu">{t("setup.cpu")}</option>
                </select>
              </td>
              <td>
                {seat.kind === "cpu" && (
                  <select
                    aria-label={`${t("setup.persona")} ${index + 1}`}
                    value={seat.personaId}
                    onChange={(e) => updateSeat(index, { personaId: e.target.value })}
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name[language]}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {problem !== null && <p className="error">{t(`setup.${problem}`)}</p>}
      {!hasApiKey && (
        <p className="error">
          {t("setup.needKey")}{" "}
          <button type="button" className="link" onClick={onOpenKey}>
            {t("app.apiKey")}
          </button>
        </p>
      )}
      <div className="row">
        <button type="button" onClick={onStart} disabled={!canStart}>
          {spectator ? t("setup.spectate") : t("setup.start")}
        </button>
        <button type="button" className="secondary" onClick={onEditPersonas}>
          {t("setup.editPersonas")}
        </button>
      </div>
    </section>
  );
}
