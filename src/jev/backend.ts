import { DEFAULT_MODEL, type JevBackend } from "@jev-poker/agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { type Connection, connectionHeaders, modelFor } from "./connection";

export { DEFAULT_MODEL, type JevBackend };

export interface TypeSafeBackendOptions {
  /** Which service the proxy should forward to, and the credentials for it. */
  connection: Connection;
  /** e.g. `${location.origin}/api/jev`; the SDK appends `/v1/systemone`. */
  baseURL: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend {
  const { connection } = options;
  const client = new TypeSafeClient({
    apiKey: connection.apiKey,
    baseURL: options.baseURL,
    defaultModel: modelFor(connection, options.model ?? DEFAULT_MODEL),
    dangerouslyAllowBrowser: true,
    defaultHeaders: connectionHeaders(connection),
    timeout: options.timeoutMs ?? 10_000,
    logLevel: "off",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    kind: "typesafe",
    systemOne: (request, requestOptions) => client.systemOne(request, requestOptions),
  };
}
