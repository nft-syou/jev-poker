import {
  createTypeSafeBackend,
  type JevBackend,
  type Persona,
  PRESET_PERSONAS,
} from "@jev-poker/agent";
import { LOLIPOP_MODEL, LOLIPOP_UPSTREAM } from "../src/jev/connection";

/** Where the benchmark reaches Jev: TypeSafe's own API, or the Lolipop AI Gateway in front of it. */
export type BenchRoute = "typesafe" | "lolipop";

export const BENCH_ROUTES: readonly BenchRoute[] = ["typesafe", "lolipop"];

/** The environment variable that holds the API key of each route. */
export const ROUTE_KEY_ENV: Record<BenchRoute, string> = {
  typesafe: "TYPESAFE_API_KEY",
  lolipop: "LOLIPOP_API_KEY",
};

export interface NodeBackendOptions {
  /** Default `typesafe`. */
  route?: BenchRoute;
  /** Falls back to the route's environment variable (`ROUTE_KEY_ENV`) when omitted. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** Test seam: replaces the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * The library backend with the benchmark's key lookup: explicit option first, then the
 * environment variable of the route. The gateway serves the same `POST /v1/systemone` under
 * its own host, takes its own project key as the bearer token, and lists Jev under its own
 * model id.
 */
export function createNodeBackend(options: NodeBackendOptions = {}): JevBackend {
  const route = options.route ?? "typesafe";
  const apiKey = options.apiKey ?? process.env[ROUTE_KEY_ENV[route]];
  if (apiKey === undefined || apiKey === "") throw new Error(`${ROUTE_KEY_ENV[route]} is not set`);
  const viaGateway = route === "lolipop";
  const model = options.model ?? (viaGateway ? LOLIPOP_MODEL : undefined);
  return createTypeSafeBackend({
    apiKey,
    ...(viaGateway ? { baseURL: LOLIPOP_UPSTREAM } : {}),
    ...(model === undefined ? {} : { model }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    // A gateway adds a hop that can answer 503 in bursts; a long run should ride those out.
    ...(viaGateway ? { maxRetries: 4 } : {}),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/** One of the game's preset personas, by id. */
export function getPersona(id: string): Persona {
  const persona = PRESET_PERSONAS.find((p) => p.id === id);
  if (persona === undefined) throw new Error(`unknown persona: ${id}`);
  return persona;
}
