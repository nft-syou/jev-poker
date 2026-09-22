import { PRESET_PERSONAS } from "@jev-poker/agent";
import { describe, expect, it } from "vitest";
import { createNodeBackend, getPersona } from "./backend";

describe("getPersona", () => {
  it("returns the game's own preset for every preset id", () => {
    expect(PRESET_PERSONAS.length).toBeGreaterThan(0);
    for (const preset of PRESET_PERSONAS) expect(getPersona(preset.id)).toBe(preset);
    expect(getPersona("tag").id).toBe("tag");
  });

  it("throws on an unknown id", () => {
    expect(() => getPersona("nobody")).toThrow("unknown persona: nobody");
    expect(() => getPersona("")).toThrow("unknown persona");
  });
});

describe("createNodeBackend", () => {
  // Building the backend only constructs the SDK client; no request is sent until `systemOne`.
  it("builds a typesafe backend from an explicit key", () => {
    const backend = createNodeBackend({ apiKey: "test" });
    expect(backend.kind).toBe("typesafe");
    expect(typeof backend.systemOne).toBe("function");
  });

  it("accepts a model and a timeout", () => {
    const backend = createNodeBackend({ apiKey: "test", model: "jev-latest", timeoutMs: 1234 });
    expect(backend.kind).toBe("typesafe");
  });
});
