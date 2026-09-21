/**
 * The one description of how the browser reaches Jev, shared by the UI, the backend and the
 * proxy. It must stay dependency-free: `tsconfig.functions.json` compiles it for the
 * Cloudflare Pages Function, so it may not import React, the SDK or any node/browser API.
 *
 * The security rule this module exists to enforce: the proxy never accepts a free-form
 * upstream URL. It picks one of four fixed hosts by route id and interpolates only values
 * that passed an anchored regex here and then `encodeURIComponent`.
 */

export type JevRoute = "typesafe" | "vercel" | "lolipop" | "cloudflare";

export const JEV_ROUTES: readonly JevRoute[] = ["typesafe", "vercel", "lolipop", "cloudflare"];

export type Connection =
  | { route: "typesafe"; apiKey: string }
  /** `apiKey` is a Vercel AI Gateway key, not a TypeSafe one. */
  | { route: "vercel"; apiKey: string }
  /** `apiKey` is a Lolipop AI Gateway project key, not a TypeSafe one. */
  | { route: "lolipop"; apiKey: string }
  | {
      route: "cloudflare";
      apiKey: string;
      accountId: string;
      gatewayId: string;
      /** Without the `custom-` prefix the gateway URL adds. */
      providerSlug: string;
      gatewayToken?: string;
    };

/** The browser sends the key in this header; the proxy turns it into `Authorization`. */
export const API_KEY_HEADER = "X-TypeSafe-Key";
export const ROUTE_HEADER = "X-Jev-Route";
export const CF_ACCOUNT_HEADER = "X-Jev-CF-Account";
export const CF_GATEWAY_HEADER = "X-Jev-CF-Gateway";
export const CF_PROVIDER_HEADER = "X-Jev-CF-Provider";
export const CF_TOKEN_HEADER = "X-Jev-CF-Token";

/** Printable ASCII only: anything a header may carry, and nothing that could split one. */
export const SECRET_PATTERN = /^[\x21-\x7E]{1,512}$/;
export const CF_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
export const CF_GATEWAY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const CF_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const TYPESAFE_UPSTREAM = "https://api.typesafe.ai";
export const VERCEL_UPSTREAM = "https://ai-gateway.vercel.sh/typesafe";
export const LOLIPOP_UPSTREAM = "https://ai-gateway.lolipop.jp";
export const CLOUDFLARE_UPSTREAM = "https://gateway.ai.cloudflare.com";

/** The Vercel AI Gateway addresses Jev by this id instead of `jev-latest`. */
export const VERCEL_MODEL = "typesafe-ai/jev";
/** The Lolipop AI Gateway lists Jev under this id. */
export const LOLIPOP_MODEL = "typesafe/jev-latest";

/** The only paths the proxy will ever forward, with the method each one allows. */
export const ALLOWED_PATHS: Readonly<Record<string, "GET" | "POST">> = {
  "v1/systemone": "POST",
  "v1/models": "GET",
};

export type ConnectionField =
  | "route"
  | "apiKey"
  | "accountId"
  | "gatewayId"
  | "providerSlug"
  | "gatewayToken";

/** Error values are i18n keys, so the modal can render them next to their field. */
export type ConnectionErrors = Partial<Record<ConnectionField, string>>;

export type ConnectionValidation =
  | { ok: true; connection: Connection }
  | { ok: false; errors: ConnectionErrors };

export interface CloudflareGatewayInput {
  accountId?: unknown;
  gatewayId?: unknown;
  providerSlug?: unknown;
}

export interface UpstreamEnv {
  /** Overrides the upstream root of the `typesafe` route only (tests, staging). */
  TYPESAFE_BASE_URL?: string | undefined;
}

export type UpstreamUrlError = "invalid_route" | "invalid_path" | "invalid_gateway_config";

export function isJevRoute(value: unknown): value is JevRoute {
  return typeof value === "string" && (JEV_ROUTES as readonly string[]).includes(value);
}

/**
 * Cloudflare shows the provider as `custom-<slug>` but the URL segment already adds that
 * prefix, so a pasted `custom-foo` must not become `custom-custom-foo`.
 */
export function normalizeProviderSlug(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith("custom-") ? trimmed.slice("custom-".length) : trimmed;
}

function trimmed(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * The URL segment is `custom-<slug>`, so the slug itself must not carry that prefix — one
 * `custom-` is stripped on the way in, and a second one (`custom-custom-x`) is a mistake the
 * player has to see in the modal rather than a 400 on every hand.
 */
export function isProviderSlug(slug: string): boolean {
  return CF_PROVIDER_SLUG_PATTERN.test(slug) && !slug.startsWith("custom-");
}

const SAFE_BASE_URL_PATTERNS = [
  /^https:\/\/[^\s]+$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/,
] as const;

export function validateConnection(input: unknown): ConnectionValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { route: "connection.error.route" } };
  }
  const raw = input as Partial<Record<ConnectionField, unknown>>;
  if (!isJevRoute(raw.route)) return { ok: false, errors: { route: "connection.error.route" } };
  const route = raw.route;

  const errors: ConnectionErrors = {};
  const apiKey = trimmed(raw.apiKey) ?? "";
  if (!SECRET_PATTERN.test(apiKey)) errors.apiKey = "connection.error.apiKey";

  if (route !== "cloudflare") {
    if (errors.apiKey !== undefined) return { ok: false, errors };
    return { ok: true, connection: { route, apiKey } };
  }

  // Hex is case-insensitive; stored lowercased so the same account has one spelling.
  const accountId = (trimmed(raw.accountId) ?? "").toLowerCase();
  if (!CF_ACCOUNT_ID_PATTERN.test(accountId)) errors.accountId = "connection.error.accountId";
  const gatewayId = trimmed(raw.gatewayId) ?? "";
  if (!CF_GATEWAY_ID_PATTERN.test(gatewayId)) errors.gatewayId = "connection.error.gatewayId";
  const providerSlug = normalizeProviderSlug(trimmed(raw.providerSlug) ?? "");
  if (!isProviderSlug(providerSlug)) errors.providerSlug = "connection.error.providerSlug";

  // The gateway token is optional: only a non-blank one has to look like a secret.
  const token = raw.gatewayToken === undefined ? "" : (trimmed(raw.gatewayToken) ?? "\u0000");
  if (token.length > 0 && !SECRET_PATTERN.test(token))
    errors.gatewayToken = "connection.error.gatewayToken";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    connection: {
      route,
      apiKey,
      accountId,
      gatewayId,
      providerSlug,
      ...(token.length > 0 ? { gatewayToken: token } : {}),
    },
  };
}

export function connectionHeaders(connection: Connection): Record<string, string> {
  const headers: Record<string, string> = {
    [API_KEY_HEADER]: connection.apiKey,
    [ROUTE_HEADER]: connection.route,
  };
  if (connection.route === "cloudflare") {
    headers[CF_ACCOUNT_HEADER] = connection.accountId;
    headers[CF_GATEWAY_HEADER] = connection.gatewayId;
    headers[CF_PROVIDER_HEADER] = connection.providerSlug;
    if (connection.gatewayToken !== undefined) headers[CF_TOKEN_HEADER] = connection.gatewayToken;
  }
  return headers;
}

export function modelFor(connection: Connection, settingsModel: string): string {
  if (connection.route === "vercel") return VERCEL_MODEL;
  if (connection.route === "lolipop") return LOLIPOP_MODEL;
  return settingsModel;
}

/**
 * The single place an upstream URL is built. Every caller passes a route id and an
 * allow-listed path; nothing here is taken from user input except values that just matched
 * an anchored regex, and those are still `encodeURIComponent`d before interpolation.
 */
export function upstreamUrl(
  route: string | null | undefined,
  path: string,
  cf: CloudflareGatewayInput | null | undefined,
  env: UpstreamEnv,
): string | { error: UpstreamUrlError } {
  const id = route === null || route === undefined ? "typesafe" : route;
  if (!isJevRoute(id)) return { error: "invalid_route" };
  if (!Object.hasOwn(ALLOWED_PATHS, path)) return { error: "invalid_path" };

  if (id === "typesafe") {
    // An empty or malformed override would otherwise build a relative URL, or ship the key
    // over plain http to somewhere else entirely: fall back to the default instead.
    const override = (env.TYPESAFE_BASE_URL ?? "").trim();
    const safe = SAFE_BASE_URL_PATTERNS.some((pattern) => pattern.test(override));
    const base = (safe ? override : TYPESAFE_UPSTREAM).replace(/\/+$/, "");
    return `${base}/${path}`;
  }
  if (id === "vercel") return `${VERCEL_UPSTREAM}/${path}`;
  if (id === "lolipop") return `${LOLIPOP_UPSTREAM}/${path}`;

  const accountId = trimmed(cf?.accountId) ?? "";
  const gatewayId = trimmed(cf?.gatewayId) ?? "";
  const providerSlug = trimmed(cf?.providerSlug) ?? "";
  if (
    !CF_ACCOUNT_ID_PATTERN.test(accountId) ||
    !CF_GATEWAY_ID_PATTERN.test(gatewayId) ||
    !isProviderSlug(providerSlug)
  ) {
    return { error: "invalid_gateway_config" };
  }
  const segments = [accountId, gatewayId, `custom-${providerSlug}`].map(encodeURIComponent);
  return `${CLOUDFLARE_UPSTREAM}/v1/${segments.join("/")}/${path}`;
}
