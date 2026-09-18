import { choice } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { API_KEY_HEADER, createTypeSafeBackend } from "./backend";

describe("createTypeSafeBackend", () => {
  it("posts to <baseURL>/v1/systemone with the key header and default model", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
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
    const backend = createTypeSafeBackend({
      apiKey: "sk-test",
      baseURL: "http://localhost/api/jev",
      fetch: fakeFetch,
    });
    const result = await backend.systemOne({
      state: { hello: "world" },
      questions: { action: choice("?", { fold: null, check_or_call: null }) },
    });
    expect(result.answers.action.choice).toBe("fold");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost/api/jev/v1/systemone");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get(API_KEY_HEADER)).toBe("sk-test");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({ hello: "world" });
  });
});
