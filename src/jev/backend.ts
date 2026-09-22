import { createTypeSafeBackend, DEFAULT_MODEL, type JevBackend } from "@jev-poker/agent";
import { type Connection, connectionHeaders, modelFor } from "./connection";

export { DEFAULT_MODEL, type JevBackend };

export interface ProxyBackendOptions {
  /** Which service the proxy should forward to, and the credentials for it. */
  connection: Connection;
  /** e.g. `${location.origin}/api/jev`; the SDK appends `/v1/systemone`. */
  baseURL: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * The game's backend: the library client pointed at this site's proxy, with the route headers
 * the proxy needs to pick an upstream. The key travels in `X-TypeSafe-Key`, not as a bearer
 * token, because the proxy turns it into `Authorization` itself.
 */
export function createProxyBackend(options: ProxyBackendOptions): JevBackend {
  const { connection } = options;
  return createTypeSafeBackend({
    apiKey: connection.apiKey,
    baseURL: options.baseURL,
    model: modelFor(connection, options.model ?? DEFAULT_MODEL),
    headers: connectionHeaders(connection),
    browser: true,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
