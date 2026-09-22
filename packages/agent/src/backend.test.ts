import { choice } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { createTypeSafeBackend, DEFAULT_MODEL, type TypeSafeBackendOptions } from "./backend.js";

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(calls: Call[]): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        model: "jev-latest",
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

async function ask(options: Omit<TypeSafeBackendOptions, "fetch">): Promise<Call> {
  const calls: Call[] = [];
  const backend = createTypeSafeBackend({ ...options, fetch: recordingFetch(calls) });
  expect(backend.kind).toBe("typesafe");
  const result = await backend.systemOne({
    state: { hello: "world" },
    questions: { action: choice("?", { fold: null, check_or_call: null }) },
  });
  expect(result.answers.action.choice).toBe("fold");
  const call = calls[0];
  if (call === undefined || calls.length !== 1) throw new Error("expected exactly one request");
  return call;
}

describe("createTypeSafeBackend", () => {
  it("talks to api.typesafe.ai with the key as a bearer token and the default model", async () => {
    const call = await ask({ apiKey: "sk-test" });
    expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.state).toEqual({ hello: "world" });
  });

  it("takes a base URL, a model and extra headers for a gateway", async () => {
    const call = await ask({
      apiKey: "lp-1",
      baseURL: "https://ai-gateway.lolipop.jp",
      model: "typesafe/jev-latest",
      headers: { "x-trace": "abc" },
    });
    expect(call.url).toBe("https://ai-gateway.lolipop.jp/v1/systemone");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer lp-1");
    expect(headers.get("x-trace")).toBe("abc");
    expect(JSON.parse(String(call.init?.body)).model).toBe("typesafe/jev-latest");
  });

  it("does not need the SDK to read an environment variable", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const call = await ask({ apiKey: "explicit" });
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer explicit");
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });
});

describe("createTypeSafeBackend retries", () => {
  function flakyFetch(failures: number, calls: string[]): typeof fetch {
    let left = failures;
    return async (input) => {
      calls.push(String(input));
      if (left > 0) {
        left -= 1;
        return new Response(JSON.stringify({ error: "service_unavailable" }), { status: 503 });
      }
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: { ok: { type: "noul", noul: 0.5 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
  }

  it("retries as many times as asked, then gives up", async () => {
    const { noul } = await import("@typesafe-ai/sdk");
    const patient: string[] = [];
    const backend = createTypeSafeBackend({
      apiKey: "k",
      maxRetries: 4,
      fetch: flakyFetch(3, patient),
    });
    const result = await backend.systemOne({ state: { a: 1 }, questions: { ok: noul("ok?") } });
    expect(result.model).toBe("jev-latest");
    expect(patient).toHaveLength(4);

    const impatient: string[] = [];
    const none = createTypeSafeBackend({
      apiKey: "k",
      maxRetries: 0,
      fetch: flakyFetch(1, impatient),
    });
    await expect(
      none.systemOne({ state: { a: 1 }, questions: { ok: noul("ok?") } }),
    ).rejects.toThrow();
    expect(impatient).toHaveLength(1);
  });
});
