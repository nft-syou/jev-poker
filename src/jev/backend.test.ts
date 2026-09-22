import { choice } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { createProxyBackend } from "./backend";
import {
  API_KEY_HEADER,
  CF_ACCOUNT_HEADER,
  CF_GATEWAY_HEADER,
  CF_PROVIDER_HEADER,
  CF_TOKEN_HEADER,
  type Connection,
  ROUTE_HEADER,
} from "./connection";

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(calls: Call[], model: string): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        model,
        answers: {
          action: {
            type: "choice",
            choice: "fold",
            confidence: 0.9,
            probabilities: { fold: 0.9, check_or_call: 0.1 },
          },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function ask(connection: Connection, model?: string): Promise<Call> {
  const calls: Call[] = [];
  const backend = createProxyBackend({
    connection,
    baseURL: "http://localhost/api/jev",
    fetch: recordingFetch(calls, "jev-latest"),
    ...(model === undefined ? {} : { model }),
  });
  const result = await backend.systemOne({
    state: { hello: "world" },
    questions: { action: choice("?", { fold: null, check_or_call: null }) },
  });
  expect(result.answers.action.choice).toBe("fold");
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error("no request was made");
  return call;
}

describe("createProxyBackend", () => {
  it("posts to <baseURL>/v1/systemone with the key header and default model", async () => {
    const call = await ask({ route: "typesafe", apiKey: "sk-test" });
    expect(call.url).toBe("http://localhost/api/jev/v1/systemone");
    const headers = new Headers(call.init?.headers);
    expect(headers.get(API_KEY_HEADER)).toBe("sk-test");
    expect(headers.get(ROUTE_HEADER)).toBe("typesafe");
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({ hello: "world" });
  });

  it("asks the vercel gateway for typesafe-ai/jev whatever the settings model says", async () => {
    const call = await ask({ route: "vercel", apiKey: "vck_1" }, "jev-2026-09");
    const headers = new Headers(call.init?.headers);
    expect(headers.get(API_KEY_HEADER)).toBe("vck_1");
    expect(headers.get(ROUTE_HEADER)).toBe("vercel");
    expect(JSON.parse(String(call.init?.body)).model).toBe("typesafe-ai/jev");
  });

  it("asks the lolipop gateway for typesafe/jev-latest whatever the settings model says", async () => {
    const call = await ask({ route: "lolipop", apiKey: "lp-1" }, "jev-2026-09");
    const headers = new Headers(call.init?.headers);
    expect(headers.get(API_KEY_HEADER)).toBe("lp-1");
    expect(headers.get(ROUTE_HEADER)).toBe("lolipop");
    expect(JSON.parse(String(call.init?.body)).model).toBe("typesafe/jev-latest");
  });

  it("sends the four cloudflare headers and keeps the settings model", async () => {
    const call = await ask(
      {
        route: "cloudflare",
        apiKey: "sk-cf",
        accountId: "0123456789abcdef0123456789abcdef",
        gatewayId: "my-gateway",
        providerSlug: "typesafe",
        gatewayToken: "tok-1",
      },
      "jev-2026-09",
    );
    const headers = new Headers(call.init?.headers);
    expect(headers.get(API_KEY_HEADER)).toBe("sk-cf");
    expect(headers.get(ROUTE_HEADER)).toBe("cloudflare");
    expect(headers.get(CF_ACCOUNT_HEADER)).toBe("0123456789abcdef0123456789abcdef");
    expect(headers.get(CF_GATEWAY_HEADER)).toBe("my-gateway");
    expect(headers.get(CF_PROVIDER_HEADER)).toBe("typesafe");
    expect(headers.get(CF_TOKEN_HEADER)).toBe("tok-1");
    expect(JSON.parse(String(call.init?.body)).model).toBe("jev-2026-09");
  });
});
