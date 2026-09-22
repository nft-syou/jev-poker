import {
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

/** Anything that can answer Jev's typed questions: the real service, or a stand-in in tests. */
export interface JevBackend {
  readonly kind: "typesafe" | "mock";
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

export const DEFAULT_MODEL = "jev-latest";

export interface TypeSafeBackendOptions {
  apiKey: string;
  /** Where `/v1/systemone` lives. Omit for api.typesafe.ai; set it to call a gateway or a proxy. */
  baseURL?: string;
  /** Defaults to `DEFAULT_MODEL`. A gateway may know Jev by another id. */
  model?: string;
  /** Sent with every request, e.g. a gateway's own token. */
  headers?: Record<string, string>;
  /** Per-request timeout; defaults to 10 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /**
   * The SDK refuses to run in a browser unless told the key is meant to be there (a player's
   * own key, sent to their own proxy). Set it in the browser; leave it off in Node.
   */
  browser?: boolean;
}

/** A `JevBackend` on the TypeSafe SDK. No environment variables are read: the key is explicit. */
export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model ?? DEFAULT_MODEL,
    timeout: options.timeoutMs ?? 10_000,
    logLevel: "off",
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.headers === undefined ? {} : { defaultHeaders: options.headers }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.browser === true ? { dangerouslyAllowBrowser: true } : {}),
  });
  return {
    kind: "typesafe",
    systemOne: (request, requestOptions) => client.systemOne(request, requestOptions),
  };
}
