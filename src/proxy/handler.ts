import {
  ALLOWED_PATHS,
  CF_ACCOUNT_HEADER,
  CF_GATEWAY_HEADER,
  CF_PROVIDER_HEADER,
  CF_TOKEN_HEADER,
  ROUTE_HEADER,
  SECRET_PATTERN,
  TYPESAFE_UPSTREAM,
  type UpstreamEnv,
  upstreamUrl,
} from "../jev/connection";

export type ProxyEnv = UpstreamEnv;

export const DEFAULT_UPSTREAM = TYPESAFE_UPSTREAM;

const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "x-typesafe-request-id",
  "retry-after",
  "retry-after-ms",
] as const;

/**
 * Forwards an allow-listed request to the service the caller's route header names, with the
 * caller's key moved from `X-TypeSafe-Key` into `Authorization`. Nothing is logged or stored.
 *
 * The upstream is never taken from the request: `upstreamUrl` picks one of three fixed hosts
 * by route id and interpolates only regex-validated, percent-encoded segments. Upstream
 * headers are built from scratch, so none of our own `X-*` headers can leak onward.
 */
export async function handleJevProxy(
  request: Request,
  path: string,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const route = path.replace(/^\/+|\/+$/g, "");
  const method = Object.hasOwn(ALLOWED_PATHS, route) ? ALLOWED_PATHS[route] : undefined;
  if (method === undefined) return json(404, { error: "not_found" });
  if (request.method !== method) return json(405, { error: "method_not_allowed" });

  const key = request.headers.get("x-typesafe-key")?.trim() ?? "";
  if (!SECRET_PATTERN.test(key)) return json(401, { error: "missing_api_key" });

  const routeId = request.headers.get(ROUTE_HEADER);
  const url = upstreamUrl(
    routeId,
    route,
    {
      accountId: request.headers.get(CF_ACCOUNT_HEADER),
      gatewayId: request.headers.get(CF_GATEWAY_HEADER),
      providerSlug: request.headers.get(CF_PROVIDER_HEADER),
    },
    env,
  );
  if (typeof url !== "string") {
    if (url.error === "invalid_path") return json(404, { error: "not_found" });
    return json(400, { error: url.error });
  }

  const headers = new Headers({ authorization: `Bearer ${key}`, accept: "application/json" });
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);

  // Authenticated Cloudflare AI Gateways want their own token beside the provider key.
  if (routeId === "cloudflare") {
    const token = request.headers.get(CF_TOKEN_HEADER)?.trim() ?? "";
    if (token.length > 0) {
      if (!SECRET_PATTERN.test(token)) return json(400, { error: "invalid_gateway_config" });
      headers.set("cf-aig-authorization", `Bearer ${token}`);
    }
  }

  const init: RequestInit = { method, headers };
  if (method === "POST") init.body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetchImpl(url, init);
  } catch {
    return json(502, { error: "upstream_unreachable" });
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function json(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
