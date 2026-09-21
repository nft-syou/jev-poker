import { describe, expect, it } from "vitest";
import { parseArgs, pickLatest, resultFileName, resultsToMarkdown, USAGE } from "./report";
import type { BenchResult } from "./types";

const mk = (
  o: Partial<BenchResult> & { opponent?: string; format?: string; finishedAt?: string },
): BenchResult => ({
  version: 1,
  startedAt: "2026-09-19T00:00:00.000Z",
  finishedAt: o.finishedAt ?? "2026-09-19T01:00:00.000Z",
  partial: false,
  config: {
    opponent: (o.opponent ?? "random") as never,
    format: (o.format ?? "hu") as never,
    seeds: 100,
    persona: "tag",
    backend: "mock",
    model: null,
    baseSeed: 1,
    concurrency: 4,
    sdkVersion: "0.6.0",
    gitCommit: null,
  },
  summary: {
    jev: {
      bb100: 45.23,
      ci95: [30.1, 60.3],
      n: 100,
      hands: 200,
      decisions: 500,
      apiCalls: 500,
      failOpen: 0,
      latencyMs: { mean: 1300, p50: 1200, p95: 2000 },
      vpip: 0.42,
      pfr: 0.28,
      showdowns: 10,
      showdownWinRate: 0.5,
      incompleteGroups: 0,
    },
    opponent: { bb100PerSeat: -45.23, vpip: 1, pfr: 0 },
  },
  hands: [],
  ...o,
});

describe("report", () => {
  it("renders a markdown table", () => {
    const md = resultsToMarkdown([mk({})]);
    expect(md).toContain(
      "| random | HU | tag | 100 | 200 | +45.2 | [+30.1, +60.3] | 42% | 28% | 0 | 1.3s | - | base 1 mock |",
    );
    expect(md).toMatchSnapshot();
  });

  it("renders the header columns from the spec", () => {
    const md = resultsToMarkdown([mk({})]);
    expect(md.split("\n")[0]).toBe(
      "| 相手 | 形式 | 人格 | N (群) | ハンド | bb/100 | 95% CI | VPIP | PFR | 失敗 | 平均応答 | コード | 条件 |",
    );
  });

  it("renders 6max as 6-max and negative bb/100 with a sign", () => {
    const r = mk({ format: "6max" });
    const md = resultsToMarkdown([
      {
        ...r,
        summary: { ...r.summary, jev: { ...r.summary.jev, bb100: -3.04, ci95: [-10.5, 4.42] } },
      },
    ]);
    expect(md).toContain(
      "| random | 6-max | tag | 100 | 200 | -3.0 | [-10.5, +4.4] | 42% | 28% | 0 | 1.3s | - | base 1 mock |",
    );
  });

  it("flags small N", () =>
    expect(
      resultsToMarkdown([
        mk({ summary: { ...mk({}).summary, jev: { ...mk({}).summary.jev, n: 10 } } }),
      ]),
    ).toContain("10 (N が小さい)"));

  it("marks partial results in the opponent cell", () => {
    expect(resultsToMarkdown([mk({ partial: true })])).toContain("| ⚠ random |");
  });

  it("sorts rows by opponent, then format, then persona", () => {
    const rows = resultsToMarkdown([
      mk({ opponent: "rules", format: "hu" }),
      mk({ opponent: "random", format: "6max" }),
      mk({ opponent: "caller", format: "hu" }),
      mk({ opponent: "random", format: "hu" }),
    ])
      .split("\n")
      .slice(2)
      .map((line) => line.split(" | ").slice(0, 2).join("/").replace("| ", ""));
    expect(rows).toEqual(["random/HU", "random/6-max", "caller/HU", "rules/HU"]);
  });

  it("picks the latest per matchup", () => {
    const old = mk({ finishedAt: "2026-09-18T00:00:00.000Z" }),
      nu = mk({ finishedAt: "2026-09-19T00:00:00.000Z" }),
      other = mk({ opponent: "rules" });
    expect(pickLatest([old, nu, other])).toEqual([nu, other]);
  });

  it("keeps different personas apart", () => {
    const a = mk({});
    const b = {
      ...a,
      config: { ...a.config, persona: "lag" },
      finishedAt: "2026-09-20T00:00:00.000Z",
    };
    expect(pickLatest([a, b])).toEqual([b, a]);
  });

  it("builds a result file name from startedAt and the matchup", () => {
    expect(resultFileName(mk({}), null)).toBe("2026-09-19T00-00-00-000Z-random-hu.json");
    expect(resultFileName(mk({ opponent: "rules", format: "6max" }), null)).toBe(
      "2026-09-19T00-00-00-000Z-rules-6max.json",
    );
  });

  it("keeps the matchup in the name when a label is given", () => {
    expect(resultFileName(mk({}), "smoke")).toBe("2026-09-19T00-00-00-000Z-smoke-random-hu.json");
    expect(resultFileName(mk({ opponent: "caller" }), "smoke")).toBe(
      "2026-09-19T00-00-00-000Z-smoke-caller-hu.json",
    );
  });
});

describe("parseArgs", () => {
  it("defaults", () =>
    expect(parseArgs([])).toEqual({
      opponent: "all",
      format: "all",
      seeds: 100,
      persona: "tag",
      backend: "typesafe",
      concurrency: 4,
      baseSeed: 1,
      label: null,
      model: null,
      promptStyle: "unified",
      variance: null,
      hero: "jev",
      preflop: "jev",
      rangeEquity: false,
      profile: false,
    }));

  it("parses values", () =>
    expect(
      parseArgs(["--opponent", "rules", "--format", "hu", "--seeds", "5", "--backend", "mock"]),
    ).toMatchObject({
      opponent: "rules",
      format: "hu",
      seeds: 5,
      backend: "mock",
    }));

  it("parses --flag=value", () =>
    expect(
      parseArgs(["--opponent=caller", "--base-seed=7", "--label=smoke", "--model=jev-latest"]),
    ).toMatchObject({
      opponent: "caller",
      baseSeed: 7,
      label: "smoke",
      model: "jev-latest",
    }));

  it("rejects unknown flags", () => expect(() => parseArgs(["--nope"])).toThrow());
  it("rejects bad enum values", () => expect(() => parseArgs(["--opponent", "nobody"])).toThrow());
  it("rejects a bad format", () => expect(() => parseArgs(["--format", "9max"])).toThrow());
  it("rejects a bad backend", () => expect(() => parseArgs(["--backend", "openai"])).toThrow());
  it("rejects non-positive integers", () => expect(() => parseArgs(["--seeds", "0"])).toThrow());
  it("rejects non-numeric integers", () =>
    expect(() => parseArgs(["--concurrency", "many"])).toThrow());
  it("rejects a missing value", () => expect(() => parseArgs(["--seeds"])).toThrow());
  it("rejects positional arguments", () => expect(() => parseArgs(["hu"])).toThrow());

  it("exposes a usage string mentioning every flag", () => {
    for (const flag of [
      "--opponent",
      "--format",
      "--seeds",
      "--persona",
      "--backend",
      "--concurrency",
      "--base-seed",
      "--label",
      "--model",
      "--help",
    ]) {
      expect(USAGE).toContain(flag);
    }
  });
});

describe("report identity", () => {
  it("keeps different experiments of the same matchup apart and shows what differs", () => {
    const base = mk({});
    const split = mk({
      finishedAt: "2026-09-19T02:00:00.000Z",
      config: { ...base.config, promptStyle: "split" },
    });
    const moreSeeds = mk({
      finishedAt: "2026-09-19T03:00:00.000Z",
      config: { ...base.config, seeds: 1000, gitCommit: "abc1234" },
    });
    const rerun = mk({ finishedAt: "2026-09-19T04:00:00.000Z" });
    const picked = pickLatest([base, split, moreSeeds, rerun]);
    expect(picked).toEqual([split, moreSeeds, rerun]); // the re-run replaced `base`; the others are distinct
    const md = resultsToMarkdown(picked);
    expect(md).toContain("| - | base 1 split mock |");
    expect(md).toContain("| abc1234 | base 1 mock |");
  });
  it("prints n/a when no interval can be estimated", () => {
    const one = mk({
      summary: { ...mk({}).summary, jev: { ...mk({}).summary.jev, n: 1, ci95: null } },
    });
    expect(resultsToMarkdown([one])).toContain("| n/a |");
  });
});

describe("parseArgs --profile", () => {
  it("is off by default and means the numbers as a bare flag", () => {
    expect(parseArgs([]).profile).toBe(false);
    expect(parseArgs(["--profile"]).profile).toBe("numbers");
    expect(parseArgs(["--seeds", "5", "--profile"])).toMatchObject({
      seeds: 5,
      profile: "numbers",
    });
  });

  it("takes an optional mode", () => {
    expect(parseArgs(["--profile", "numbers"]).profile).toBe("numbers");
    expect(parseArgs(["--profile", "label"]).profile).toBe("label");
    expect(parseArgs(["--profile", "jev-label"]).profile).toBe("jev-label");
    expect(parseArgs(["--profile", "label", "--seeds", "7"])).toMatchObject({
      profile: "label",
      seeds: 7,
    });
    // The last one wins, like every other flag.
    expect(parseArgs(["--profile", "label", "--profile"]).profile).toBe("numbers");
    expect(parseArgs(["--profile", "--profile", "jev-label"]).profile).toBe("jev-label");
  });

  it("does not swallow a following token that is not a mode", () => {
    expect(parseArgs(["--profile", "--seeds", "5"])).toMatchObject({
      profile: "numbers",
      seeds: 5,
    });
    expect(parseArgs(["--profile", "--backend", "mock", "--opponent", "mixed"])).toMatchObject({
      profile: "numbers",
      backend: "mock",
      opponent: "mixed",
    });
    expect(parseArgs(["--profile", "--range-equity"])).toMatchObject({
      profile: "numbers",
      rangeEquity: true,
    });
    expect(parseArgs(["--profile", "--backend=mock"])).toMatchObject({
      profile: "numbers",
      backend: "mock",
    });
    // A value that belongs to another flag is left for that flag to reject or accept.
    expect(parseArgs(["--label", "label", "--profile"])).toMatchObject({
      label: "label",
      profile: "numbers",
    });
    expect(parseArgs(["--profile", "--label", "label"])).toMatchObject({
      label: "label",
      profile: "numbers",
    });
  });

  it("still rejects a stray word after it", () => {
    expect(() => parseArgs(["--profile", "everything"])).toThrow("unexpected argument: everything");
    expect(() => parseArgs(["--profile", "Label"])).toThrow("unexpected argument: Label");
    expect(() => parseArgs(["--profile", "true"])).toThrow("unexpected argument: true");
  });

  it("leaves --help reachable after it", () => {
    expect(() => parseArgs(["--profile", "--help"])).toThrow("help requested");
  });
});

describe("parseArgs --opponent mixed", () => {
  it("accepts the two mixed tables by name", () => {
    expect(parseArgs(["--opponent", "mixed"]).opponent).toBe("mixed");
    expect(parseArgs(["--opponent=mixed-jev", "--format", "6max"])).toMatchObject({
      opponent: "mixed-jev",
      format: "6max",
    });
    expect(() => parseArgs(["--opponent", "mixed-bots"])).toThrow(
      "invalid value for --opponent: mixed-bots (expected random|caller|rules|mixed|mixed-jev|all)",
    );
  });

  it("documents the mixed tables and the profile modes", () => {
    for (const word of ["--profile", "numbers", "label", "jev-label", "mixed", "mixed-jev"]) {
      expect(USAGE).toContain(word);
    }
    expect(USAGE).toContain("--profile [numbers|label|jev-label]");
  });
});

describe("report profile conditions", () => {
  const withProfile = (profile: BenchResult["config"]["profile"], finishedAt?: string) => {
    const base = mk(finishedAt === undefined ? {} : { finishedAt });
    return { ...base, config: { ...base.config, ...(profile === undefined ? {} : { profile }) } };
  };
  const conditionsOf = (r: BenchResult): string =>
    (resultsToMarkdown([r]).split("\n")[2] ?? "").split(" | ").at(-1)?.replace(" |", "") ?? "";

  it("shows `profile` for the numbers and `profile:<mode>` for the labels", () => {
    expect(conditionsOf(withProfile("numbers"))).toBe("base 1 profile mock");
    expect(conditionsOf(withProfile("label"))).toBe("base 1 profile:label mock");
    expect(conditionsOf(withProfile("jev-label"))).toBe("base 1 profile:jev-label mock");
  });

  it("renders an old result with `profile: true` as `profile`", () => {
    expect(conditionsOf(withProfile(true))).toBe("base 1 profile mock");
    expect(resultsToMarkdown([withProfile(true)])).toBe(
      resultsToMarkdown([withProfile("numbers")]),
    );
  });

  it("shows nothing when the memory was off or the field is absent", () => {
    expect(conditionsOf(withProfile(undefined))).toBe("base 1 mock");
    expect(conditionsOf(withProfile(false))).toBe("base 1 mock");
  });

  it("keeps its place among the other conditions, and ignores the label-call count", () => {
    const base = mk({});
    const r: BenchResult = {
      ...base,
      config: {
        ...base.config,
        promptStyle: "split",
        rangeEquity: true,
        profile: "jev-label",
        profileLabelCalls: 12,
        variance: 0.5,
        model: "jev-x",
      },
    };
    expect(conditionsOf(r)).toBe("base 1 split range profile:jev-label var 0.5 mock jev-x");
  });

  it("keeps the profile modes of one matchup apart when picking the latest", () => {
    const none = withProfile(undefined, "2026-09-19T01:00:00.000Z");
    const numbers = withProfile("numbers", "2026-09-19T02:00:00.000Z");
    const label = withProfile("label", "2026-09-19T03:00:00.000Z");
    const jevLabel = withProfile("jev-label", "2026-09-19T04:00:00.000Z");
    const rerun = withProfile("label", "2026-09-19T05:00:00.000Z");
    const picked = pickLatest([none, numbers, label, jevLabel, rerun]);
    expect(picked).toEqual([none, numbers, jevLabel, rerun]);
    const md = resultsToMarkdown(picked);
    expect(md).toContain("| base 1 profile mock |");
    expect(md).toContain("| base 1 profile:label mock |");
    expect(md).toContain("| base 1 profile:jev-label mock |");
  });
});

describe("report mixed tables", () => {
  it("sorts the mixed tables after the single-kind opponents", () => {
    const rows = resultsToMarkdown([
      mk({ opponent: "mixed-jev", format: "6max" }),
      mk({ opponent: "mixed", format: "6max" }),
      mk({ opponent: "rules", format: "6max" }),
      mk({ opponent: "random", format: "hu" }),
    ])
      .split("\n")
      .slice(2)
      .map((line) => line.split(" | ").slice(0, 2).join("/").replace("| ", ""));
    expect(rows).toEqual(["random/HU", "rules/6-max", "mixed/6-max", "mixed-jev/6-max"]);
  });

  it("names their result files like any other matchup", () => {
    expect(resultFileName(mk({ opponent: "mixed", format: "6max" }), null)).toBe(
      "2026-09-19T00-00-00-000Z-mixed-6max.json",
    );
    expect(resultFileName(mk({ opponent: "mixed-jev", format: "6max" }), "types")).toBe(
      "2026-09-19T00-00-00-000Z-types-mixed-jev-6max.json",
    );
  });
});

describe("parseArgs --variance", () => {
  it("accepts 0..1 and rejects anything else", () => {
    expect(parseArgs(["--variance", "0"]).variance).toBe(0);
    expect(parseArgs(["--variance=0.5"]).variance).toBe(0.5);
    expect(() => parseArgs(["--variance", "2"])).toThrow();
    expect(() => parseArgs(["--variance", "x"])).toThrow();
  });
});
