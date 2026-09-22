import {
  createTypeSafeBackend,
  type JevBackend,
  type Persona,
  PRESET_PERSONAS,
} from "@jev-poker/agent";

export interface NodeBackendOptions {
  /** Falls back to `TYPESAFE_API_KEY` when omitted. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/** The library backend with the benchmark's key lookup: explicit option first, then the environment. */
export function createNodeBackend(options: NodeBackendOptions = {}): JevBackend {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("no TypeSafe API key: pass apiKey or set TYPESAFE_API_KEY");
  }
  return createTypeSafeBackend({
    apiKey,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

/** One of the game's preset personas, by id. */
export function getPersona(id: string): Persona {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`unknown persona: ${id}`);
  return persona;
}
