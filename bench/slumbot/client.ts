/** One response from `/slumbot/api/new_hand` or `/slumbot/api/act`. */
export interface SlumbotResponse {
  old_action?: string;
  action: string;
  client_pos: 0 | 1;
  hole_cards: string[];
  board: string[];
  token?: string;
  /** Present once the hand is over: the client's result in chips. */
  winnings?: number;
  /** Slumbot's own cards, shown at a showdown. */
  bot_hole_cards?: string[];
  error_msg?: string;
  [key: string]: unknown;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SlumbotClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Retries for network errors and 5xx responses (the hand state lives on the server, so a retry is safe only before it answered). */
  retries?: number;
  retryDelayMs?: number;
}

/** Thin JSON client for Slumbot's public API. It keeps no state; the caller carries the token. */
export class SlumbotClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(opts: SlumbotClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "https://slumbot.com/slumbot/api";
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.retries = opts.retries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
  }

  newHand(token: string | null): Promise<SlumbotResponse> {
    return this.post("new_hand", token === null ? {} : { token });
  }

  act(token: string, incr: string): Promise<SlumbotResponse> {
    return this.post("act", { token, incr });
  }

  private async post(path: string, body: Record<string, string>): Promise<SlumbotResponse> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          lastError = new Error(`slumbot ${path}: HTTP ${res.status}`);
          if (res.status >= 500) continue;
          throw lastError;
        }
        const json = (await res.json()) as SlumbotResponse;
        if (typeof json.error_msg === "string" && json.error_msg !== "")
          throw new Error(`slumbot ${path}: ${json.error_msg}`);
        return json;
      } catch (err) {
        lastError = err;
        // A protocol error from the server is final; only transport failures are retried.
        if (err instanceof Error && err.message.startsWith("slumbot ")) throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
