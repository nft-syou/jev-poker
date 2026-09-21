import type { Agent, AgentDecision } from "../../src/agents";
import type { SlumbotClient, SlumbotResponse } from "./client";
import { BIG_BLIND, encodeAction, heroView, type Pos } from "./protocol";

export interface SlumbotHand {
  session: number;
  index: number;
  clientPos: Pos;
  holeCards: string[];
  board: string[];
  botHoleCards: string[] | null;
  /** The complete action string of the hand. */
  action: string;
  /** Client result in big blinds. */
  netBB: number;
  /** Decisions of a Jev hero; empty for other heroes. */
  decisions: AgentDecision[];
  /** Numeric fields of the final response this client does not interpret (kept for later analysis). */
  extra: Record<string, number>;
}

export interface SlumbotRunOptions {
  client: SlumbotClient;
  /** Builds the hero for one session; `onDecision` lets a Jev hero report its decisions. */
  makeHero: (session: number, onDecision: (r: AgentDecision) => void) => Agent;
  hands: number;
  /** Parallel sessions, each with its own token; hands within a session are sequential. */
  sessions: number;
  signal?: AbortSignal;
  onHand?: (done: number, total: number) => void;
}

const KNOWN = new Set([
  "old_action",
  "action",
  "client_pos",
  "hole_cards",
  "board",
  "token",
  "winnings",
  "bot_hole_cards",
  "error_msg",
]);

/** Play one hand to the end. Returns the final response and the token to use next. */
async function playOne(
  client: SlumbotClient,
  token: string | null,
  hero: Agent,
): Promise<{ last: SlumbotResponse; token: string | null }> {
  let r = await client.newHand(token);
  let current = r.token ?? token;
  // Guard against a protocol bug looping forever: no hold'em hand has this many decisions.
  for (let step = 0; step < 60 && r.winnings === undefined; step++) {
    const { view, legal } = heroView(r.action, r.client_pos, r.hole_cards, r.board);
    const action = await hero.decide(view, legal);
    if (current === null) throw new Error("slumbot did not provide a token");
    r = await client.act(current, encodeAction(action, legal));
    current = r.token ?? current;
  }
  if (r.winnings === undefined) throw new Error(`hand did not finish: ${r.action}`);
  return { last: r, token: current };
}

/**
 * Play `hands` hands against Slumbot, split over `sessions` parallel sessions. Aborting stops
 * new hands from starting; a hand in flight is finished so the server is not left mid-hand.
 */
export async function runSlumbot(
  opts: SlumbotRunOptions,
): Promise<{ hands: SlumbotHand[]; partial: boolean }> {
  const total = opts.hands;
  const sessions = Math.max(1, Math.min(opts.sessions, total));
  const out: SlumbotHand[] = [];
  let claimed = 0;
  let done = 0;
  let failed = false;

  const session = async (id: number): Promise<void> => {
    let decisions: AgentDecision[] = [];
    const hero = opts.makeHero(id, (rec) => decisions.push(rec));
    let token: string | null = null;
    for (;;) {
      if (failed || opts.signal?.aborted === true || claimed >= total) return;
      const index = claimed++;
      decisions = [];
      try {
        const { last, token: next } = await playOne(opts.client, token, hero);
        token = next;
        const extra: Record<string, number> = {};
        for (const [k, v] of Object.entries(last))
          if (!KNOWN.has(k) && typeof v === "number") extra[k] = v;
        out.push({
          session: id,
          index,
          clientPos: last.client_pos,
          holeCards: last.hole_cards,
          board: last.board,
          botHoleCards: last.bot_hole_cards ?? null,
          action: last.action,
          netBB: (last.winnings ?? 0) / BIG_BLIND,
          decisions,
          extra,
        });
      } catch (err) {
        failed = true;
        throw err;
      }
      done += 1;
      opts.onHand?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: sessions }, (_, id) => session(id)));
  out.sort((a, b) => a.index - b.index);
  return { hands: out, partial: out.length < total };
}

export interface SlumbotSummary {
  hands: number;
  bb100: number;
  /** 95% CI over independent hands; `null` with fewer than two hands. */
  ci95: [number, number] | null;
  /** Standard deviation of one hand's result, in big blinds. */
  sdPerHandBB: number;
  /**
   * bb/100 relative to Slumbot's per-hand baseline (`baseline_winnings`: what Slumbot's own
   * strategy earns with the client's cards and seat). Same expectation as `bb100` against a
   * symmetric opponent, much lower variance. `null` when the server sent no baseline.
   */
  vsBaseline: { bb100: number; ci95: [number, number] | null; sdPerHandBB: number } | null;
  asBigBlind: { hands: number; bb100: number };
  asButton: { hands: number; bb100: number };
  vpip: number;
  pfr: number;
  decisions: number;
  failOpen: number;
  meanLatencyMs: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Hands against Slumbot are independent deals (no mirroring is possible), so the CI is over hands. */
export function summarizeSlumbot(hands: SlumbotHand[]): SlumbotSummary {
  const xs = hands.map((h) => h.netBB);
  const m = mean(xs);
  const sd =
    xs.length < 2 ? 0 : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  const half = xs.length < 2 ? 0 : (1.96 * sd) / Math.sqrt(xs.length);
  const by = (pos: Pos) => {
    const sel = hands.filter((h) => h.clientPos === pos).map((h) => h.netBB);
    return { hands: sel.length, bb100: mean(sel) * 100 };
  };
  // The client's own preflop actions: the tokens it contributed before the first '/'.
  const pre = hands.map((h) => {
    const first = h.action.split("/")[0] ?? "";
    const tokens = first.match(/b\d+|[kcf]/g) ?? [];
    // Position 1 (button) acts first preflop, so the client's tokens are the even or the odd ones.
    const mine = tokens.filter((_, i) => (i % 2 === 0) === (h.clientPos === 1));
    return {
      vpip: mine.some((t) => t === "c" || t.startsWith("b")),
      pfr: mine.some((t) => t.startsWith("b")),
    };
  });
  const withBase = hands.filter((h) => typeof h.extra.baseline_winnings === "number");
  let vsBaseline: SlumbotSummary["vsBaseline"] = null;
  if (withBase.length === hands.length && hands.length > 0) {
    const ds = hands.map((h) => h.netBB - (h.extra.baseline_winnings ?? 0) / BIG_BLIND);
    const dm = mean(ds);
    const dsd =
      ds.length < 2 ? 0 : Math.sqrt(ds.reduce((a, x) => a + (x - dm) ** 2, 0) / (ds.length - 1));
    const dh = ds.length < 2 ? 0 : (1.96 * dsd) / Math.sqrt(ds.length);
    vsBaseline = {
      bb100: dm * 100,
      ci95: ds.length < 2 ? null : [(dm - dh) * 100, (dm + dh) * 100],
      sdPerHandBB: dsd,
    };
  }
  const all = hands.flatMap((h) => h.decisions);
  return {
    hands: hands.length,
    bb100: m * 100,
    ci95: xs.length < 2 ? null : [(m - half) * 100, (m + half) * 100],
    sdPerHandBB: sd,
    vsBaseline,
    asBigBlind: by(0),
    asButton: by(1),
    vpip: mean(pre.map((p) => (p.vpip ? 1 : 0))),
    pfr: mean(pre.map((p) => (p.pfr ? 1 : 0))),
    decisions: all.length,
    failOpen: all.filter((d) => d.error !== undefined).length,
    meanLatencyMs: mean(all.map((d) => d.latencyMs)),
  };
}
