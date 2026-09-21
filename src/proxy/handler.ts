export interface ProxyEnv {
  /** Override the upstream API root (tests, staging). */
  TYPESAFE_BASE_URL?: string;
}

export const DEFAULT_UPSTREAM = "https://api.typesafe.ai";

const ROUTES: Readonly<Record<string, "GET" | "POST">> = {
  "v1/systemone": "POST",
  "v1/models": "GET",
};

const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "x-typesafe-request-id",
  "retry-after",
  "retry-after-ms",
] as const;

/**
 * Forwards an allow-listed request to TypeSafe with the caller's key moved from
 * `X-TypeSafe-Key` into `Authorization`. Nothing is logged or stored.
 */
export async function handleJevProxy(
  request: Request,
  path: string,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const route = path.replace(/^\/+|\/+$/g, "");
  const method = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined;
  if (method === undefined) return json(404, { error: "not_found" });
  if (request.method !== method) return json(405, { error: "method_not_allowed" });

  const key = request.headers.get("x-typesafe-key")?.trim() ?? "";
  if (key.length === 0) return json(401, { error: "missing_api_key" });

  const base = (env.TYPESAFE_BASE_URL ?? DEFAULT_UPSTREAM).replace(/\/+$/, "");
  const headers = new Headers({ authorization: `Bearer ${key}`, accept: "application/json" });
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);

  const init: RequestInit = { method, headers };
  if (method === "POST") init.body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${base}/${route}`, init);
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
