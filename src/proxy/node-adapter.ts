import type { IncomingMessage, ServerResponse } from "node:http";

/** A Jev request body is a few KB; anything past this is not worth buffering in the dev server. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor() {
    super(`request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export function payloadTooLargeResponse(): Response {
  return new Response(JSON.stringify({ error: "payload_too_large" }), {
    status: 413,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Bridges Node's http objects to the WHATWG pair `handleJevProxy` speaks, so the Vite dev
 * server can run the very same proxy code as the deployed Pages Function.
 */
export async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? "/", origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2 pseudo headers (`:method`, …) are not legal in a `Headers` bag.
    if (value === undefined || name.startsWith(":")) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Buffer | string);
      size += buffer.byteLength;
      if (size > MAX_REQUEST_BODY_BYTES) throw new PayloadTooLargeError();
      chunks.push(buffer);
    }
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.end(new Uint8Array(await response.arrayBuffer()));
}
