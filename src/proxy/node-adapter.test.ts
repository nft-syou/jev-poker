import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_BODY_BYTES,
  PayloadTooLargeError,
  payloadTooLargeResponse,
  toWebRequest,
  writeWebResponse,
} from "./node-adapter";

function nodeRequest(
  method: string,
  url: string,
  headers: Record<string, string | string[]>,
  body?: string,
): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [body]);
  return Object.assign(stream, { method, url, headers }) as unknown as IncomingMessage;
}

function nodeResponse() {
  const headers: Record<string, string> = {};
  const state = { statusCode: 0, headers, body: "" };
  const res = {
    set statusCode(value: number) {
      state.statusCode = value;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: Uint8Array) {
      state.body = chunk === undefined ? "" : new TextDecoder().decode(chunk);
    },
  };
  return { res: res as unknown as ServerResponse, state };
}

describe("toWebRequest", () => {
  it("carries the method, url, headers and body over", async () => {
    const request = await toWebRequest(
      nodeRequest(
        "POST",
        "/v1/systemone?x=1",
        { "content-type": "application/json", "x-typesafe-key": "sk-1" },
        '{"state":1}',
      ),
      "http://localhost:5173",
    );
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://localhost:5173/v1/systemone?x=1");
    expect(request.headers.get("x-typesafe-key")).toBe("sk-1");
    expect(await request.text()).toBe('{"state":1}');
  });

  it("leaves a GET without a body and joins repeated headers", async () => {
    const request = await toWebRequest(
      nodeRequest("GET", "/v1/models", { accept: ["a/b", "c/d"] }),
      "http://localhost",
    );
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(request.headers.get("accept")).toBe("a/b, c/d");
  });

  it("refuses to buffer a body past the cap", async () => {
    const big = "a".repeat(MAX_REQUEST_BODY_BYTES + 1);
    await expect(
      toWebRequest(nodeRequest("POST", "/v1/systemone", {}, big), "http://localhost"),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    // The cap itself is still allowed through.
    const atCap = await toWebRequest(
      nodeRequest("POST", "/v1/systemone", {}, "a".repeat(MAX_REQUEST_BODY_BYTES)),
      "http://localhost",
    );
    expect((await atCap.text()).length).toBe(MAX_REQUEST_BODY_BYTES);
  });

  it("answers an oversized body with 413", async () => {
    const response = payloadTooLargeResponse();
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("drops http/2 pseudo headers, which a Headers bag refuses", async () => {
    const request = await toWebRequest(
      nodeRequest("GET", "/v1/models", { ":method": "GET", accept: "a/b" }),
      "http://localhost",
    );
    expect(request.headers.get("accept")).toBe("a/b");
  });
});

describe("writeWebResponse", () => {
  it("copies the status, headers and body onto the node response", async () => {
    const { res, state } = nodeResponse();
    await writeWebResponse(
      res,
      new Response('{"error":"invalid_route"}', {
        status: 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
    expect(state.statusCode).toBe(400);
    expect(state.headers["content-type"]).toBe("application/json");
    expect(state.headers["cache-control"]).toBe("no-store");
    expect(state.body).toBe('{"error":"invalid_route"}');
  });
});
