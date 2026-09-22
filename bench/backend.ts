import { type Persona, PRESET_PERSONAS } from "@jev-poker/agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevBackend } from "../src/jev/backend";

export interface NodeBackendOptions {
  /** Falls back to `TYPESAFE_API_KEY` in the SDK when omitted. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Talks to the TypeSafe API directly from Node. The game's own backend goes through the
 * browser proxy; a benchmark has no browser, so it builds the same `JevBackend` on a plain client.
 */
export function createNodeBackend(options: NodeBackendOptions = {}): JevBackend {
  const client = new TypeSafeClient({
    timeout: options.timeoutMs ?? 10_000,
    logLevel: "off",
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.model === undefined ? {} : { defaultModel: options.model }),
  });
  return {
    kind: "typesafe",
    systemOne: (request, requestOptions) => client.systemOne(request, requestOptions),
  };
}

/** One of the game's preset personas, by id. */
export function getPersona(id: string): Persona {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`unknown persona: ${id}`);
  return persona;
}
