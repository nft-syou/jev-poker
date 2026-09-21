import { useTranslation } from "react-i18next";
import type { Language } from "../i18n";
import { clampVariance, duplicatePersona, type Persona } from "../jev/personas";

interface Props {
  personas: readonly Persona[];
  language: Language;
  onChange: (personas: Persona[]) => void;
  onBack: () => void;
}

export function PersonaEditor({ personas, language, onChange, onBack }: Props) {
  const { t } = useTranslation();

  const update = (id: string, patch: (p: Persona) => Persona) =>
    onChange(personas.map((p) => (p.id === id ? patch(p) : p)));

  const duplicate = (source: Persona) => {
    const id = `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    onChange([...personas, duplicatePersona(source, id)]);
  };

  return (
    <section className="personas">
      <div className="row">
        <button type="button" className="secondary" onClick={onBack}>
          {t("app.back")}
        </button>
        <h2>{t("personas.title")}</h2>
      </div>
      <p className="muted">{t("personas.description")}</p>
      <ul className="persona-list">
        {personas.map((persona) => (
          <li key={persona.id} className="persona">
            {persona.isPreset ? (
              <>
                <div className="row">
                  <strong>{persona.name[language]}</strong>
                  <span className="badge">{t("personas.preset")}</span>
                </div>
                <p>{persona.description[language]}</p>
                <p className="muted">
                  {t("personas.variance")}: {persona.variance}
                </p>
              </>
            ) : (
              <div className="grid">
                <label className="field">
                  <span>{t("personas.nameEn")}</span>
                  <input
                    value={persona.name.en}
                    onChange={(e) =>
                      update(persona.id, (p) => ({ ...p, name: { ...p.name, en: e.target.value } }))
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("personas.nameJa")}</span>
                  <input
                    value={persona.name.ja}
                    onChange={(e) =>
                      update(persona.id, (p) => ({ ...p, name: { ...p.name, ja: e.target.value } }))
                    }
                  />
                </label>
                <label className="field wide">
                  <span>{t("personas.descriptionEn")}</span>
                  <textarea
                    rows={3}
                    value={persona.description.en}
                    onChange={(e) =>
                      update(persona.id, (p) => ({
                        ...p,
                        description: { ...p.description, en: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field wide">
                  <span>{t("personas.descriptionJa")}</span>
                  <textarea
                    rows={3}
                    value={persona.description.ja}
                    onChange={(e) =>
                      update(persona.id, (p) => ({
                        ...p,
                        description: { ...p.description, ja: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>
                    {t("personas.variance")} ({persona.variance})
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={persona.variance}
                    onChange={(e) =>
                      update(persona.id, (p) => ({
                        ...p,
                        variance: clampVariance(Number(e.target.value)),
                      }))
                    }
                  />
                  <small className="muted">{t("personas.varianceHelp")}</small>
                </label>
              </div>
            )}
            <div className="row">
              <button type="button" className="secondary" onClick={() => duplicate(persona)}>
                {t("personas.duplicate")}
              </button>
              {!persona.isPreset && (
                <button
                  type="button"
                  className="secondary danger"
                  onClick={() => onChange(personas.filter((p) => p.id !== persona.id))}
                >
                  {t("personas.delete")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
