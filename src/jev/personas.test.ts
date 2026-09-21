import { describe, expect, it } from "vitest";
import {
  clampVariance,
  duplicatePersona,
  type KeyValueStorage,
  loadPersonas,
  PERSONA_STORAGE_KEY,
  PRESET_PERSONAS,
  personaPrompt,
  saveCustomPersonas,
} from "./personas";

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("personas", () => {
  it("ships five presets with both languages", () => {
    expect(PRESET_PERSONAS.map((p) => p.id)).toEqual(["rock", "tag", "lag", "maniac", "station"]);
    for (const persona of PRESET_PERSONAS) {
      expect(persona.isPreset).toBe(true);
      expect(persona.name.en.length).toBeGreaterThan(0);
      expect(persona.name.ja.length).toBeGreaterThan(0);
      expect(persona.description.en.length).toBeGreaterThan(20);
      expect(persona.description.ja.length).toBeGreaterThan(10);
      expect(persona.variance).toBeGreaterThanOrEqual(0);
      expect(persona.variance).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the measured variance of each preset", () => {
    // TAG is 0.15: at 0.3 a strong hand still folded about 9% of the time (bench/EXPERIMENTS.md).
    expect(Object.fromEntries(PRESET_PERSONAS.map((p) => [p.id, p.variance]))).toEqual({
      rock: 0.2,
      tag: 0.15,
      lag: 0.6,
      maniac: 0.8,
      station: 0.5,
    });
  });

  it("loads presets plus stored custom personas", () => {
    const custom = duplicatePersona(PRESET_PERSONAS[0] as never, "custom-1");
    const storage = memoryStorage({ [PERSONA_STORAGE_KEY]: JSON.stringify([custom]) });
    const loaded = loadPersonas(storage);
    expect(loaded).toHaveLength(PRESET_PERSONAS.length + 1);
    expect(loaded[loaded.length - 1]).toEqual(custom);
  });

  it("ignores broken or missing storage", () => {
    expect(loadPersonas(null)).toEqual(PRESET_PERSONAS);
    expect(loadPersonas(memoryStorage({ [PERSONA_STORAGE_KEY]: "{not json" }))).toEqual(
      PRESET_PERSONAS,
    );
    expect(
      loadPersonas(memoryStorage({ [PERSONA_STORAGE_KEY]: JSON.stringify([{ id: 1 }]) })),
    ).toEqual(PRESET_PERSONAS);
  });

  it("saves only custom personas", () => {
    const storage = memoryStorage();
    const custom = duplicatePersona(PRESET_PERSONAS[1] as never, "custom-2");
    saveCustomPersonas([...PRESET_PERSONAS, custom], storage);
    expect(JSON.parse(storage.data.get(PERSONA_STORAGE_KEY) ?? "[]")).toEqual([custom]);
  });

  it("duplicates as an editable copy", () => {
    const copy = duplicatePersona(PRESET_PERSONAS[2] as never, "copy");
    expect(copy.id).toBe("copy");
    expect(copy.isPreset).toBe(false);
    expect(copy.name.en).toContain(PRESET_PERSONAS[2]?.name.en);
    expect(copy.description).toEqual(PRESET_PERSONAS[2]?.description);
  });

  it("clamps variance and prompts in English", () => {
    expect(clampVariance(-1)).toBe(0);
    expect(clampVariance(2)).toBe(1);
    expect(clampVariance(Number.NaN)).toBe(0.5);
    const prompt = personaPrompt(PRESET_PERSONAS[0] as never);
    expect(prompt).toEqual({
      name: PRESET_PERSONAS[0]?.name.en,
      description: PRESET_PERSONAS[0]?.description.en,
    });
  });

  it("drops stored personas whose id collides with a preset or an earlier custom", () => {
    const clash = { ...duplicatePersona(PRESET_PERSONAS[0] as never, "rock") };
    const a = duplicatePersona(PRESET_PERSONAS[1] as never, "same");
    const b = duplicatePersona(PRESET_PERSONAS[2] as never, "same");
    const storage = memoryStorage({ [PERSONA_STORAGE_KEY]: JSON.stringify([clash, a, b]) });
    const loaded = loadPersonas(storage);
    expect(loaded.map((p) => p.id)).toEqual([...PRESET_PERSONAS.map((p) => p.id), "same"]);
    expect(loaded[loaded.length - 1]?.description).toEqual(a.description);
  });
});
