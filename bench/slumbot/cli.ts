import { execSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  type AgentDecision,
  createAgent,
  createMockBackend,
  HeuristicAgent,
  JevAgent,
} from "@jev-poker/agent";
import { createNodeBackend, getPersona } from "../backend";
import { SlumbotClient } from "./client";
import { runSlumbot, type SlumbotSummary, summarizeSlumbot } from "./runner";

const RESULTS_DIR = fileURLToPath(new URL("../results-slumbot/", import.meta.url));

const USAGE = `Usage: pnpm bench:slumbot [options]

Plays heads-up no-limit hold'em (blinds 50/100, 200 bb stacks) against Slumbot's public API.
Be considerate: it is somebody else's server. Keep --sessions small.

  --hero jev|heuristic|rules|caller|random   who plays against Slumbot (default jev)
  --persona <id>                             Jev persona (default tag)
  --backend typesafe|mock                    Jev backend (default typesafe; needs TYPESAFE_API_KEY)
  --model <name>                             model passed to the SDK
  --variance X                               override the persona's variance (0..1)
  --hands N                                  hands to play (default 200)
  --sessions N                               parallel sessions, hands are sequential within one (default 4)
  --label <text>                             tag in the result file name
  --help, -h`;

type Hero = "jev" | "heuristic" | "rules" | "caller" | "random";

interface Options {
  hero: Hero;
  persona: string;
  backend: "typesafe" | "mock";
  model: string | null;
  variance: number | null;
  hands: number;
  sessions: number;
  label: string | null;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parse(argv: string[]): Options {
  const o: Options = {
    hero: "jev",
    persona: "tag",
    backend: "typesafe",
    model: null,
    variance: null,
    hands: 200,
    sessions: 4,
    label: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined) fail(`missing value for ${flag}\n\n${USAGE}`);
      return v;
    };
    const int = (): number => {
      const v = take();
      if (!/^\d+$/.test(v) || Number(v) <= 0) fail(`invalid value for ${flag}: ${v}`);
      return Number(v);
    };
    switch (flag) {
      case "--hero": {
        const v = take();
        if (!["jev", "heuristic", "rules", "caller", "random"].includes(v))
          fail(`invalid --hero: ${v}`);
        o.hero = v as Hero;
        break;
      }
      case "--persona":
        o.persona = take();
        break;
      case "--backend": {
        const v = take();
        if (v !== "typesafe" && v !== "mock") fail(`invalid --backend: ${v}`);
        o.backend = v;
        break;
      }
      case "--model":
        o.model = take();
        break;
      case "--variance": {
        const v = Number(take());
        if (!Number.isFinite(v) || v < 0 || v > 1)
          fail("invalid --variance: expected a number from 0 to 1");
        o.variance = v;
        break;
      }
      case "--hands":
        o.hands = int();
        break;
      case "--sessions":
        o.sessions = int();
        break;
      case "--label":
        o.label = take();
        break;
      default:
        fail(`unknown flag: ${flag}\n\n${USAGE}`);
    }
  }
  return o;
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const signed = (x: number): string => (x >= 0 ? "+" : "") + x.toFixed(1);

function table(hero: string, s: SlumbotSummary): string {
  const ci = s.ci95 === null ? "n/a" : `[${signed(s.ci95[0])}, ${signed(s.ci95[1])}]`;
  const vb = s.vsBaseline;
  const vbCell =
    vb === null
      ? "n/a"
      : `${signed(vb.bb100)} ${vb.ci95 === null ? "" : `[${signed(vb.ci95[0])}, ${signed(vb.ci95[1])}]`}`.trim();
  const head = [
    "hero",
    "hands",
    "bb/100",
    "95% CI",
    "vs baseline",
    "sd/hand",
    "as BB",
    "as BTN",
    "VPIP",
    "PFR",
    "fail-open",
    "latency",
  ];
  const row = [
    hero,
    String(s.hands),
    signed(s.bb100),
    ci,
    vbCell,
    `${s.sdPerHandBB.toFixed(1)} bb`,
    signed(s.asBigBlind.bb100),
    signed(s.asButton.bb100),
    `${Math.round(s.vpip * 100)}%`,
    `${Math.round(s.pfr * 100)}%`,
    String(s.failOpen),
    `${(s.meanLatencyMs / 1000).toFixed(1)}s`,
  ];
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    `| ${row.join(" | ")} |`,
  ].join("\n");
}

async function main(): Promise<void> {
  const opts = parse(process.argv.slice(2));
  if (
    opts.hero === "jev" &&
    opts.backend === "typesafe" &&
    (process.env.TYPESAFE_API_KEY ?? "") === ""
  )
    fail("TYPESAFE_API_KEY is not set");

  const basePersona = getPersona(opts.persona);
  const persona =
    opts.variance === null ? basePersona : { ...basePersona, variance: opts.variance };
  const backend =
    opts.hero !== "jev"
      ? null
      : opts.backend === "typesafe"
        ? createNodeBackend({ ...(opts.model !== null ? { model: opts.model } : {}) })
        : createMockBackend();

  const makeHero = (session: number, onDecision: (r: AgentDecision) => void): Agent => {
    if (opts.hero === "jev") {
      if (backend === null) throw new Error("the jev hero needs a backend");
      return new JevAgent({ persona, backend, seed: 1000 + session, onDecision });
    }
    if (opts.hero === "heuristic") return new HeuristicAgent();
    return createAgent(opts.hero, 1000 + session);
  };

  let sigints = 0;
  const controller = new AbortController();
  process.on("SIGINT", () => {
    sigints += 1;
    if (sigints >= 2) process.exit(130);
    process.stderr.write(
      "\ninterrupted: finishing the hands in flight, then writing results (Ctrl-C again to quit)\n",
    );
    controller.abort();
  });

  const heroName = opts.hero === "jev" ? `jev:${opts.persona}` : opts.hero;
  const startedAt = new Date().toISOString();
  let warned = false;
  const { hands, partial } = await runSlumbot({
    client: new SlumbotClient(),
    makeHero: (session, onDecision) =>
      makeHero(session, (r) => {
        if (r.error !== undefined && !warned) {
          warned = true;
          process.stderr.write(`warning: Jev decision failed open: ${r.error}\n`);
        }
        onDecision(r);
      }),
    hands: opts.hands,
    sessions: opts.sessions,
    signal: controller.signal,
    onHand: (done, total) => {
      if (done % 25 === 0 || done === total)
        process.stderr.write(`[slumbot/${heroName}] ${done}/${total} hands\n`);
    },
  });

  const summary = summarizeSlumbot(hands);
  const result = {
    version: 1,
    opponent: "slumbot",
    startedAt,
    finishedAt: new Date().toISOString(),
    partial,
    config: {
      hero: opts.hero,
      persona: opts.hero === "jev" ? opts.persona : null,
      backend: opts.hero === "jev" ? opts.backend : null,
      model: opts.model,
      variance: opts.variance,
      hands: opts.hands,
      sessions: opts.sessions,
      gitCommit: gitCommit(),
    },
    summary,
    hands,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const name = `${startedAt.replace(/[:.]/g, "-")}-${opts.label === null ? "" : `${opts.label}-`}slumbot-${heroName.replace(":", "-")}.json`;
  const file = `${RESULTS_DIR}${name}`;
  await writeFile(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(`${file}.tmp`, file);
  process.stderr.write(`wrote ${file}\n`);
  process.stdout.write(`${table(heroName, summary)}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
