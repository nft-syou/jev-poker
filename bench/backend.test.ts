import { PRESET_PERSONAS } from "@jev-poker/agent";
import { describe, expect, it } from "vitest";
import { createNodeBackend, getPersona } from "./backend";

describe("getPersona", () => {
  it("returns the game's own preset for every preset id", () => {
    expect(PRESET_PERSONAS.length).toBeGreaterThan(0);
    for (const preset of PRESET_PERSONAS) expect(getPersona(preset.id)).toBe(preset);
    expect(getPersona("tag").id).toBe("tag");
  });

  it("throws on an unknown id", () => {
    expect(() => getPersona("nobody")).toThrow("unknown persona: nobody");
    expect(() => getPersona("")).toThrow("unknown persona");
  });
});

describe("createNodeBackend", () => {
  // Building the backend only constructs the SDK client; no request is sent until `systemOne`.
  it("builds a typesafe backend from an explicit key", () => {
    const backend = createNodeBackend({ apiKey: "test" });
    expect(backend.kind).toBe("typesafe");
    expect(typeof backend.systemOne).toBe("function");
  });

  it("accepts a model and a timeout", () => {
    const backend = createNodeBackend({ apiKey: "test", model: "jev-latest", timeoutMs: 1234 });
    expect(backend.kind).toBe("typesafe");
  });

  it("refuses to build without a key", () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => createNodeBackend()).toThrow("TYPESAFE_API_KEY is not set");
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });
});

describe("createNodeBackend routes", () => {
  const answer = {
    model: "jev-test",
    answers: { ok: { type: "noul", noul: 0.5 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  function recordingFetch(): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return { fetch: fake, calls };
  }

  async function ask(backend: ReturnType<typeof createNodeBackend>): Promise<void> {
    const { noul } = await import("@typesafe-ai/sdk");
    await backend.systemOne({ state: { a: 1 }, questions: { ok: noul("ok?") } });
  }

  it("reaches TypeSafe's own API by default", async () => {
    const { fetch, calls } = recordingFetch();
    await ask(createNodeBackend({ apiKey: "ts-key", fetch }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer ts-key");
  });

  it("reaches the Lolipop AI Gateway with its key and its model id", async () => {
    const { fetch, calls } = recordingFetch();
    await ask(createNodeBackend({ route: "lolipop", apiKey: "lp-key", fetch }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ai-gateway.lolipop.jp/v1/systemone");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer lp-key");
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("typesafe/jev-latest");
  });

  it("lets --model override the gateway's model id", async () => {
    const { fetch, calls } = recordingFetch();
    await ask(createNodeBackend({ route: "lolipop", apiKey: "lp-key", model: "auto", fetch }));
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("auto");
  });

  it("names the environment variable of the route when the key is missing", () => {
    const saved = { ...process.env };
    delete process.env.LOLIPOP_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => createNodeBackend({ route: "lolipop" })).toThrow("LOLIPOP_API_KEY is not set");
      expect(() => createNodeBackend()).toThrow("TYPESAFE_API_KEY is not set");
      process.env.LOLIPOP_API_KEY = "from-env";
      expect(createNodeBackend({ route: "lolipop" }).kind).toBe("typesafe");
    } finally {
      process.env = saved;
    }
  });
});
