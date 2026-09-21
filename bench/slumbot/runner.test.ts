import { describe, expect, it } from "vitest";
import { createAgent, HeuristicAgent } from "../../src/agents";
import { type FetchLike, SlumbotClient, type SlumbotResponse } from "./client";
import { BIG_BLIND, type Pos, replay } from "./protocol";
import { runSlumbot, type SlumbotHand, summarizeSlumbot } from "./runner";

/**
 * A stand-in for the Slumbot server that speaks the same protocol: the bot always checks or
 * calls, the client alternates positions, and a hand that reaches showdown is a chop.
 */
function fakeServer(): {
  fetchImpl: FetchLike;
  requests: { path: string; body: Record<string, string> }[];
} {
  const requests: { path: string; body: Record<string, string> }[] = [];
  const sessions = new Map<string, { action: string; clientPos: Pos; handNo: number }>();
  let nextToken = 0;

  const botPlays = (s: { action: string; clientPos: Pos }): void => {
    for (;;) {
      const st = replay(s.action);
      if (st.toAct === null || st.toAct === s.clientPos) return;
      s.action += st.currentBet > st.onStreet[st.toAct] ? "c" : "k";
      const after = replay(s.action);
      if (after.street > st.street && after.toAct !== null) s.action += "/";
    }
  };

  const respond = (token: string): SlumbotResponse => {
    const s = sessions.get(token);
    if (s === undefined) throw new Error(`unknown token ${token}`);
    const st = replay(s.action);
    const board = ["2c", "7d", "Th", "Js", "3h"].slice(0, st.street === 0 ? 0 : st.street + 2);
    const res: SlumbotResponse = {
      action: s.action,
      client_pos: s.clientPos,
      hole_cards: ["As", "Kd"],
      board,
      token,
    };
    if (st.toAct === null) {
      const me = s.clientPos;
      const opp = me === 0 ? 1 : 0;
      res.winnings = st.folded === null ? 0 : st.folded === me ? -st.total[me] : st.total[opp];
      res.session_num_hands = s.handNo;
    }
    return res;
  };

  const fetchImpl: FetchLike = async (url, init) => {
    const path = url.split("/").pop() ?? "";
    const body = JSON.parse(init.body) as Record<string, string>;
    requests.push({ path, body });
    let token = body.token;
    if (path === "new_hand") {
      if (token === undefined) token = `t${nextToken++}`;
      const prev = sessions.get(token);
      const s = {
        action: "",
        clientPos: ((prev?.handNo ?? 0) % 2) as Pos,
        handNo: (prev?.handNo ?? 0) + 1,
      };
      sessions.set(token, s);
      botPlays(s);
    } else {
      const s = sessions.get(token ?? "");
      if (s === undefined)
        return { ok: true, status: 200, json: async () => ({ error_msg: "bad token" }) };
      s.action += body.incr ?? "";
      const st = replay(s.action);
      const before = replay(s.action.slice(0, s.action.length - (body.incr ?? "").length));
      if (st.street > before.street && st.toAct !== null) s.action += "/";
      botPlays(s);
    }
    return { ok: true, status: 200, json: async () => respond(token ?? "") };
  };
  return { fetchImpl, requests };
}

describe("runSlumbot", () => {
  it("plays whole hands with any agent and conserves the protocol", async () => {
    const { fetchImpl, requests } = fakeServer();
    const client = new SlumbotClient({ fetchImpl, retryDelayMs: 1 });
    const { hands, partial } = await runSlumbot({
      client,
      makeHero: () => createAgent("caller", 1),
      hands: 6,
      sessions: 2,
    });
    expect(partial).toBe(false);
    expect(hands).toHaveLength(6);
    // A caller against a caller always reaches showdown, which the fake scores as a chop.
    expect(hands.every((h) => h.netBB === 0)).toBe(true);
    expect(hands.every((h) => replay(h.action).toAct === null)).toBe(true);
    expect(hands.some((h) => h.clientPos === 0) && hands.some((h) => h.clientPos === 1)).toBe(true);
    expect(hands[0]?.extra.session_num_hands).toBeGreaterThan(0);
    // Every act request carries a token; only a session's first new_hand may omit it.
    expect(
      requests.filter((r) => r.path === "act").every((r) => typeof r.body.token === "string"),
    ).toBe(true);
    expect(
      requests.filter((r) => r.path === "new_hand" && r.body.token === undefined),
    ).toHaveLength(2);
  });

  it("lets a folding hero lose exactly what it put in", async () => {
    const { fetchImpl } = fakeServer();
    const client = new SlumbotClient({ fetchImpl, retryDelayMs: 1 });
    const folder = {
      id: "folder",
      decide: async (_v: unknown, legal: { canFold: boolean }) =>
        legal.canFold ? { type: "fold" as const } : { type: "check" as const },
    };
    const { hands } = await runSlumbot({ client, makeHero: () => folder, hands: 4, sessions: 1 });
    // As the button it folds the small blind (-0.5 bb); as the big blind the bot limps and the hand is checked down.
    expect(hands.map((h) => h.netBB).sort()).toEqual([-0.5, -0.5, 0, 0]);
  });

  it("runs the heuristic hero without touching any backend, and stops early when aborted", async () => {
    const { fetchImpl } = fakeServer();
    const client = new SlumbotClient({ fetchImpl, retryDelayMs: 1 });
    const ctrl = new AbortController();
    const { hands, partial } = await runSlumbot({
      client,
      makeHero: () => new HeuristicAgent(),
      hands: 50,
      sessions: 1,
      signal: ctrl.signal,
      onHand: (done) => {
        if (done >= 3) ctrl.abort();
      },
    });
    expect(partial).toBe(true);
    expect(hands.length).toBeGreaterThanOrEqual(3);
    expect(hands.length).toBeLessThan(50);
  });

  it("surfaces a server error instead of looping", async () => {
    const failing: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error_msg: "Illegal bet" }),
    });
    const client = new SlumbotClient({ fetchImpl: failing, retryDelayMs: 1 });
    await expect(
      runSlumbot({ client, makeHero: () => createAgent("caller", 1), hands: 2, sessions: 1 }),
    ).rejects.toThrow("Illegal bet");
  });
});

describe("summarizeSlumbot", () => {
  const hand = (netBB: number, clientPos: Pos, action: string): SlumbotHand => ({
    session: 0,
    index: 0,
    clientPos,
    holeCards: [],
    board: [],
    botHoleCards: null,
    action,
    netBB,
    decisions: [],
    extra: {},
  });
  it("reports bb/100 with a CI over hands, the split by position, and the client VPIP/PFR", () => {
    const s = summarizeSlumbot([
      hand(1, 1, "b250f"),
      hand(-0.5, 1, "f"),
      hand(-1, 0, "b200f"),
      hand(2, 0, "b200c/kk/kk/kk"),
    ]);
    expect(s.hands).toBe(4);
    expect(s.bb100).toBeCloseTo(37.5);
    expect(s.asButton).toEqual({ hands: 2, bb100: 25 });
    expect(s.asBigBlind).toEqual({ hands: 2, bb100: 50 });
    expect(s.vpip).toBe(0.5); // raised once as the button, called once as the big blind
    expect(s.pfr).toBe(0.25);
    expect(s.ci95?.[0]).toBeLessThan(s.bb100);
    expect(s.sdPerHandBB).toBeGreaterThan(0);
    expect(summarizeSlumbot([hand(1, 1, "f")]).ci95).toBeNull();
    expect(s.vsBaseline).toBeNull(); // no baseline in these hands
    const based = [hand(1, 1, "b250f"), hand(-1, 0, "b200f")].map((h, i) => ({
      ...h,
      extra: { baseline_winnings: i === 0 ? 50 : -150 },
    }));
    const b = summarizeSlumbot(based);
    expect(b.vsBaseline?.bb100).toBeCloseTo(50); // (1 - 0.5) and (-1 + 1.5): +0.5 bb a hand
    expect(BIG_BLIND).toBe(100);
  });
});
