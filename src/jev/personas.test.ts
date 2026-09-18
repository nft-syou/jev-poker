import { describe, expect, it } from 'vitest';
import { PRESET_PERSONAS, getPersona } from './personas.js';

describe('personas', () => {
  it('exposes the five presets with distinct ids and variances in [0,1]', () => {
    expect(PRESET_PERSONAS.map((p) => p.id)).toEqual(['rock', 'tag', 'lag', 'maniac', 'station']);
    for (const p of PRESET_PERSONAS) {
      expect(p.isPreset).toBe(true);
      expect(p.variance).toBeGreaterThanOrEqual(0);
      expect(p.variance).toBeLessThanOrEqual(1);
      expect(p.name.ja.length).toBeGreaterThan(0);
      expect(p.name.en.length).toBeGreaterThan(0);
      expect(p.description.en.length).toBeGreaterThan(40);
      expect(p.description.ja.length).toBeGreaterThan(10);
    }
  });

  it('getPersona returns the preset and throws on an unknown id', () => {
    expect(getPersona('maniac').name.en).toBe('Maniac');
    expect(getPersona('maniac').variance).toBe(0.8);
    expect(() => getPersona('nope')).toThrow(/nope/);
  });
});
