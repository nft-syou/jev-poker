import type { IncomingMessage, ServerResponse } from "node:http";

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
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer | string));
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.end(new Uint8Array(await response.arrayBuffer()));
}
