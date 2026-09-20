import type { BenchResult, Format, Opponent } from './types.js';

export interface CliOptions {
  opponent: Opponent | 'all';
  format: Format | 'all';
  seeds: number;
  persona: string;
  backend: 'typesafe' | 'mock';
  concurrency: number;
  baseSeed: number;
  label: string | null;
  model: string | null;
  promptStyle: 'unified' | 'split';
  /** Overrides the persona's variance when set. */
  variance: number | null;
  hero: 'jev' | 'heuristic';
  preflop: 'jev' | 'chart';
}

export const USAGE = `Usage: pnpm bench [options]

  --opponent random|caller|rules|all   default all
  --format   hu|6max|all               default all
  --seeds N                            default 100  (hands = seeds x seats)
  --persona <id>                       default tag
  --backend  typesafe|mock             default typesafe (typesafe requires TYPESAFE_API_KEY)
  --concurrency N                      default 4
  --base-seed N                        default 1
  --label <text>                       extra tag in the result file name, before "<opponent>-<format>"
  --model <name>                       model passed to the SDK, default the SDK's own
  --prompt unified|split               one state/question format, or separate preflop/postflop ones (default unified)
  --preflop jev|chart                  chart: preflop from the position chart in code, Jev decides postflop only
  --hero jev|heuristic                 who sits in the measured seat: Jev (default) or the fixed heuristic over the same features
  --variance X                         override the persona's variance, 0 (always the most likely action) to 1
  --help, -h                           print this message

Results are written to bench/results/. Render them again with: pnpm bench:report [files...]`;

/** Sort key: opponents in table order, then formats, then persona alphabetically. */
const OPPONENT_ORDER: readonly Opponent[] = ['random', 'caller', 'rules'];
const FORMAT_ORDER: readonly Format[] = ['hu', '6max'];

const FORMAT_LABEL: Record<Format, string> = { hu: 'HU', '6max': '6-max' };

/** Below this many independent groups the estimate is too noisy to read straight. */
const SMALL_N = 30;

const COLUMNS = ['相手', '形式', '人格', 'N (群)', 'ハンド', 'bb/100', '95% CI', 'VPIP', 'PFR', '失敗', '平均応答', 'コード', '条件'];

function orderIndex<T>(order: readonly T[], value: T): number {
  const i = order.indexOf(value);
  return i === -1 ? order.length : i;
}

function compare(a: BenchResult, b: BenchResult): number {
  return (
    orderIndex(OPPONENT_ORDER, a.config.opponent) - orderIndex(OPPONENT_ORDER, b.config.opponent) ||
    orderIndex(FORMAT_ORDER, a.config.format) - orderIndex(FORMAT_ORDER, b.config.format) ||
    a.config.persona.localeCompare(b.config.persona) ||
    a.finishedAt.localeCompare(b.finishedAt)
  );
}

/** `+45.2` / `-3.0`: always signed, always one decimal. */
function signed(x: number): string {
  const s = x.toFixed(1);
  return s.startsWith('-') ? s : `+${s}`;
}

function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** What distinguishes this run from another of the same matchup: seed set, prompt format, backend, model. */
function conditions(r: BenchResult): string {
  const parts = [`base ${r.config.baseSeed}`];
  if ((r.config.promptStyle ?? 'unified') === 'split') parts.push('split');
  if (r.config.hero === 'heuristic') parts.push('heuristic');
  if (r.config.preflop === 'chart') parts.push('chart');
  if (r.config.variance !== undefined) parts.push(`var ${r.config.variance}`);
  if (r.config.backend === 'mock') parts.push('mock');
  if (r.config.model !== null) parts.push(r.config.model);
  return parts.join(' ');
}

/** Identity of an experimental configuration: two results with the same key measure the same thing. */
export function configKey(r: BenchResult): string {
  const c = r.config;
  return JSON.stringify([c.opponent, c.format, c.persona, c.backend, c.model, c.promptStyle ?? 'unified', c.variance ?? null, c.hero ?? 'jev', c.preflop ?? 'jev', c.seeds, c.baseSeed, c.gitCommit]);
}

function row(r: BenchResult): string {
  const { jev } = r.summary;
  const opponent = r.partial ? `⚠ ${r.config.opponent}` : r.config.opponent;
  const n = jev.n < SMALL_N ? `${jev.n} (N が小さい)` : String(jev.n);
  const cells = [
    opponent,
    FORMAT_LABEL[r.config.format],
    r.config.persona,
    n,
    String(jev.hands),
    signed(jev.bb100),
    jev.ci95 === null ? 'n/a' : `[${signed(jev.ci95[0])}, ${signed(jev.ci95[1])}]`,
    percent(jev.vpip),
    percent(jev.pfr),
    String(jev.failOpen),
    seconds(jev.latencyMs.mean),
    r.config.gitCommit ?? '-',
    conditions(r),
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * Render results as the Markdown table of spec §6.3, one row per result,
 * sorted by opponent, then format, then persona.
 */
export function resultsToMarkdown(results: BenchResult[]): string {
  const sorted = [...results].sort(compare);
  const lines = [`| ${COLUMNS.join(' | ')} |`, `| ${COLUMNS.map(() => '---').join(' | ')} |`, ...sorted.map(row)];
  return lines.join('\n');
}

/**
 * Keep only the newest result (by `finishedAt`) for each experimental configuration
 * (`configKey`: matchup, persona, backend, model, prompt format, seed set and code version),
 * in the table's sort order. A re-run replaces its predecessor; a different experiment never does.
 */
export function pickLatest(results: BenchResult[]): BenchResult[] {
  const best = new Map<string, BenchResult>();
  for (const r of results) {
    const key = configKey(r);
    const current = best.get(key);
    if (current === undefined || r.finishedAt > current.finishedAt) best.set(key, r);
  }
  return [...best.values()].sort(compare);
}

/**
 * `2026-09-19T00-00-00-000Z-random-hu.json`, or with a user label
 * `2026-09-19T00-00-00-000Z-smoke-random-hu.json` — colons and dots are not
 * portable in file names. The matchup is always part of the name, so one
 * `--label` shared by every matchup of a run cannot collide with itself.
 */
export function resultFileName(result: BenchResult, label: string | null): string {
  const { opponent, format } = result.config;
  const suffix = label === null ? `${opponent}-${format}` : `${label}-${opponent}-${format}`;
  return `${result.startedAt.replace(/[:.]/g, '-')}-${suffix}.json`;
}

const OPPONENT_VALUES: readonly string[] = [...OPPONENT_ORDER, 'all'];
const FORMAT_VALUES: readonly string[] = [...FORMAT_ORDER, 'all'];
const BACKEND_VALUES: readonly string[] = ['typesafe', 'mock'];

/** Thrown by `parseArgs` when `--help` / `-h` is given; the CLI prints `USAGE` and exits 0. */
export class HelpRequested extends Error {
  constructor() {
    super('help requested');
    this.name = 'HelpRequested';
  }
}

function enumValue<T extends string>(flag: string, value: string, allowed: readonly string[]): T {
  if (!allowed.includes(value)) throw new Error(`invalid value for ${flag}: ${value} (expected ${allowed.join('|')})`);
  return value as T;
}

function positiveInt(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for ${flag}: ${value} (expected a positive integer)`);
  const n = Number(value);
  if (n <= 0) throw new Error(`invalid value for ${flag}: ${value} (expected a positive integer)`);
  return n;
}

/**
 * Parse `pnpm bench` arguments. Supports `--flag value` and `--flag=value`.
 * Throws `HelpRequested` for `--help` / `-h` and a plain `Error` for an unknown
 * flag, a missing value, a bad enum value or a non-positive integer.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    opponent: 'all',
    format: 'all',
    seeds: 100,
    persona: 'tag',
    backend: 'typesafe',
    concurrency: 4,
    baseSeed: 1,
    label: null,
    model: null,
    promptStyle: 'unified',
    variance: null,
    hero: 'jev',
    preflop: 'jev',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') throw new HelpRequested();
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);

    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const take = (): string => {
      if (inline !== null) return inline;
      const next = argv[++i];
      if (next === undefined) throw new Error(`missing value for ${flag}`);
      return next;
    };

    switch (flag) {
      case '--opponent':
        options.opponent = enumValue<Opponent | 'all'>(flag, take(), OPPONENT_VALUES);
        break;
      case '--format':
        options.format = enumValue<Format | 'all'>(flag, take(), FORMAT_VALUES);
        break;
      case '--seeds':
        options.seeds = positiveInt(flag, take());
        break;
      case '--persona':
        options.persona = take();
        break;
      case '--backend':
        options.backend = enumValue<'typesafe' | 'mock'>(flag, take(), BACKEND_VALUES);
        break;
      case '--concurrency':
        options.concurrency = positiveInt(flag, take());
        break;
      case '--base-seed':
        options.baseSeed = positiveInt(flag, take());
        break;
      case '--label':
        options.label = take();
        break;
      case '--model':
        options.model = take();
        break;
      case '--variance': {
        const value = Number(take());
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('invalid --variance: expected a number from 0 to 1');
        options.variance = value;
        break;
      }
      case '--preflop': {
        const value = take();
        if (value !== 'jev' && value !== 'chart') throw new Error(`invalid --preflop: ${value}`);
        options.preflop = value;
        break;
      }
      case '--hero': {
        const value = take();
        if (value !== 'jev' && value !== 'heuristic') throw new Error(`invalid --hero: ${value}`);
        options.hero = value;
        break;
      }
      case '--prompt': {
        const value = take();
        if (value !== 'unified' && value !== 'split') throw new Error(`invalid --prompt: ${value}`);
        options.promptStyle = value;
        break;
      }
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  return options;
}
