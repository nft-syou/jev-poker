import { describe, expect, it } from "vitest";
import {
  CF_ACCOUNT_HEADER,
  CF_GATEWAY_HEADER,
  CF_PROVIDER_HEADER,
  CF_TOKEN_HEADER,
  ROUTE_HEADER,
} from "../jev/connection";
import { handleJevProxy } from "./handler";

const CF_HEADERS = {
  "x-typesafe-key": "sk-cf",
  [ROUTE_HEADER]: "cloudflare",
  [CF_ACCOUNT_HEADER]: "0123456789abcdef0123456789abcdef",
  [CF_GATEWAY_HEADER]: "my-gateway",
  [CF_PROVIDER_HEADER]: "typesafe",
};

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

  it("treats prototype property names as unknown paths", async () => {
    const { fetch, calls } = fakeFetch(new Response("{}"));
    for (const route of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const response = await handleJevProxy(post({ "x-typesafe-key": "k" }), route, {}, fetch);
      expect(response.status, route).toBe(404);
    }
    expect(calls).toHaveLength(0);
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

  it("passes a 204 through, which a Response may not carry a body for", async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 204 }));
    const response = await handleJevProxy(
      post({ "x-typesafe-key": "k" }),
      "v1/systemone",
      {},
      fetch,
    );
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("rejects a key that is not printable ascii, without contacting upstream", async () => {
    const { fetch, calls } = fakeFetch(new Response("{}"));
    for (const key of ["   ", "~".repeat(513)]) {
      const response = await handleJevProxy(
        post({ "x-typesafe-key": key }),
        "v1/systemone",
        {},
        fetch,
      );
      expect(response.status, key).toBe(401);
      expect(await response.json()).toEqual({ error: "missing_api_key" });
    }
    expect(calls).toHaveLength(0);
  });

  describe("routes", () => {
    it("sends the vercel route to the AI Gateway with the key as a Bearer token", async () => {
      const { fetch, calls } = fakeFetch(new Response('{"model":"typesafe-ai/jev"}'));
      const response = await handleJevProxy(
        post({
          "content-type": "application/json",
          "x-typesafe-key": "vck_1",
          [ROUTE_HEADER]: "vercel",
        }),
        "v1/systemone",
        {},
        fetch,
      );
      expect(response.status).toBe(200);
      expect(calls[0]?.url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
      const sent = new Headers(calls[0]?.init?.headers);
      expect(sent.get("authorization")).toBe("Bearer vck_1");
      expect(sent.get("cf-aig-authorization")).toBeNull();
    });

    it("builds the cloudflare custom-provider url and never forwards our own x- headers", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      await handleJevProxy(
        post({ ...CF_HEADERS, "content-type": "application/json" }),
        "v1/systemone",
        {},
        fetch,
      );
      expect(calls[0]?.url).toBe(
        "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/systemone",
      );
      const sent = new Headers(calls[0]?.init?.headers);
      expect(sent.get("authorization")).toBe("Bearer sk-cf");
      expect(sent.get("cf-aig-authorization")).toBeNull();
      for (const [name] of sent) expect(name.startsWith("x-"), name).toBe(false);
    });

    it("adds cf-aig-authorization only when a gateway token is supplied", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      await handleJevProxy(
        post({ ...CF_HEADERS, [CF_TOKEN_HEADER]: "tok-1" }),
        "v1/systemone",
        {},
        fetch,
      );
      expect(new Headers(calls[0]?.init?.headers).get("cf-aig-authorization")).toBe("Bearer tok-1");
    });

    it("keeps the gateway hosts fixed even when TYPESAFE_BASE_URL is set", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      const env = { TYPESAFE_BASE_URL: "https://example.test" };
      await handleJevProxy(
        post({ "x-typesafe-key": "k", [ROUTE_HEADER]: "vercel" }),
        "v1/systemone",
        env,
        fetch,
      );
      await handleJevProxy(post(CF_HEADERS), "v1/systemone", env, fetch);
      expect(calls[0]?.url).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
      expect(calls[1]?.url).toBe(
        "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/systemone",
      );
    });

    it("refuses an unknown route id with 400 and no upstream call", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      for (const route of ["openai", "Vercel", "https://evil.test", "__proto__"]) {
        const response = await handleJevProxy(
          post({ "x-typesafe-key": "k", [ROUTE_HEADER]: route }),
          "v1/systemone",
          {},
          fetch,
        );
        expect(response.status, route).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_route" });
      }
      expect(calls).toHaveLength(0);
    });

    it("refuses a broken cloudflare config with 400 and no upstream call", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      const broken: Record<string, string>[] = [
        { [CF_ACCOUNT_HEADER]: "../../evil" },
        { [CF_ACCOUNT_HEADER]: "0123456789abcdef0123456789abcde" },
        { [CF_GATEWAY_HEADER]: "gw/../.." },
        { [CF_GATEWAY_HEADER]: "" },
        { [CF_PROVIDER_HEADER]: "a/b" },
        { [CF_PROVIDER_HEADER]: "Upper" },
        { [CF_PROVIDER_HEADER]: "custom-typesafe" },
        { [CF_TOKEN_HEADER]: "~".repeat(513) },
      ];
      for (const patch of broken) {
        const response = await handleJevProxy(
          post({ ...CF_HEADERS, ...patch }),
          "v1/systemone",
          {},
          fetch,
        );
        expect(response.status, JSON.stringify(patch)).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_gateway_config" });
      }
      expect(calls).toHaveLength(0);
    });

    it("ignores stray cloudflare headers on the other routes", async () => {
      const { fetch, calls } = fakeFetch(new Response("{}"));
      await handleJevProxy(
        post({ ...CF_HEADERS, [ROUTE_HEADER]: "typesafe", [CF_ACCOUNT_HEADER]: "../evil" }),
        "v1/systemone",
        {},
        fetch,
      );
      expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(new Headers(calls[0]?.init?.headers).get("cf-aig-authorization")).toBeNull();
    });
  });
});
