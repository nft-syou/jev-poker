import {
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

export interface JevBackend {
  readonly kind: "typesafe" | "mock";
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

export const DEFAULT_MODEL = "jev-latest";
/** The browser sends the user's key in this header; the proxy turns it into `Authorization`. */
export const API_KEY_HEADER = "X-TypeSafe-Key";

export interface TypeSafeBackendOptions {
  apiKey: string;
  /** e.g. `${location.origin}/api/jev`; the SDK appends `/v1/systemone`. */
  baseURL: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createTypeSafeBackend(options: TypeSafeBackendOptions): JevBackend {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultModel: options.model ?? DEFAULT_MODEL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { [API_KEY_HEADER]: options.apiKey },
    timeout: options.timeoutMs ?? 10_000,
    logLevel: "off",
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    kind: "typesafe",
    systemOne: (request, requestOptions) => client.systemOne(request, requestOptions),
  };
}
