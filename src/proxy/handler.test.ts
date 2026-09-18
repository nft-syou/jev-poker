import { describe, expect, it } from "vitest";
import { handleJevProxy } from "./handler";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(response: Response | Error): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetch: impl, calls };
}

const post = (headers: Record<string, string>, body = '{"state":null}') =>
  new Request("http://localhost/api/jev/v1/systemone", { method: "POST", headers, body });

describe("handleJevProxy", () => {
  it("rejects unknown paths and wrong methods", async () => {
    const { fetch } = fakeFetch(new Response("{}"));
    expect((await handleJevProxy(post({}), "v1/other", {}, fetch)).status).toBe(404);
    const get = new Request("http://localhost/api/jev/v1/systemone", { method: "GET" });
    expect((await handleJevProxy(get, "v1/systemone", {}, fetch)).status).toBe(405);
  });

  it("requires the key header and never contacts upstream without it", async () => {
    const { fetch, calls } = fakeFetch(new Response("{}"));
    const response = await handleJevProxy(
      post({ "content-type": "application/json" }),
      "v1/systemone",
      {},
      fetch,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "missing_api_key" });
    expect(calls).toHaveLength(0);
  });

  it("forwards to upstream with a Bearer token and passes the response through", async () => {
    const upstream = new Response('{"model":"jev-latest"}', {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-typesafe-request-id": "req_1",
        "set-cookie": "a=b",
      },
    });
    const { fetch, calls } = fakeFetch(upstream);
    const response = await handleJevProxy(
      post({ "content-type": "application/json", "x-typesafe-key": " sk-abc " }, '{"state":1}'),
      "v1/systemone",
      {},
      fetch,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const sent = new Headers(calls[0]?.init?.headers);
    expect(sent.get("authorization")).toBe("Bearer sk-abc");
    expect(sent.get("x-typesafe-key")).toBeNull();
    expect(sent.get("content-type")).toBe("application/json");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"state":1}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: "jev-latest" });
    expect(response.headers.get("x-typesafe-request-id")).toBe("req_1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("passes upstream errors through unchanged", async () => {
    const { fetch } = fakeFetch(
      new Response('{"error":"rate limited"}', { status: 429, headers: { "retry-after": "2" } }),
    );
    const response = await handleJevProxy(
      post({ "x-typesafe-key": "k" }),
      "v1/systemone",
      {},
      fetch,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
  });

  it("honours TYPESAFE_BASE_URL and forwards GET /v1/models without a body", async () => {
    const { fetch, calls } = fakeFetch(new Response('{"models":[]}'));
    const get = new Request("http://localhost/api/jev/v1/models", {
      method: "GET",
      headers: { "x-typesafe-key": "k" },
    });
    await handleJevProxy(get, "v1/models", { TYPESAFE_BASE_URL: "https://example.test/" }, fetch);
    expect(calls[0]?.url).toBe("https://example.test/v1/models");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("returns 502 when upstream is unreachable", async () => {
    const { fetch } = fakeFetch(new Error("ECONNREFUSED"));
    const response = await handleJevProxy(
      post({ "x-typesafe-key": "k" }),
      "v1/systemone",
      {},
      fetch,
    );
    expect(response.status).toBe(502);
  });
});
