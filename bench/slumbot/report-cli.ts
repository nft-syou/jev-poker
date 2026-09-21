import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { summarizeSlumbot, type SlumbotHand } from './runner.js';

const RESULTS_DIR = fileURLToPath(new URL('../results-slumbot/', import.meta.url));

interface ResultFile {
  config: { hero: string; persona: string | null; model: string | null; variance: number | null; gitCommit: string | null };
  partial: boolean;
  hands: SlumbotHand[];
}

const signed = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1);

/** Pool every result file of the same hero configuration (hands are independent deals) and print one row each. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : (await readdir(RESULTS_DIR)).filter((f) => f.endsWith('.json')).map((f) => `${RESULTS_DIR}${f}`);
  if (files.length === 0) {
    process.stderr.write(`no result files in ${RESULTS_DIR}; run pnpm bench:slumbot first\n`);
    process.exit(1);
  }
  const pools = new Map<string, { label: string; hands: SlumbotHand[]; files: number }>();
  for (const file of files) {
    const r = JSON.parse(await readFile(file, 'utf8')) as ResultFile;
    const c = r.config;
    const label = c.hero === 'jev' ? `jev:${c.persona}` : c.hero;
    const key = JSON.stringify([label, c.model, c.variance, c.gitCommit]);
    const pool = pools.get(key) ?? { label: `${label}${c.gitCommit ? ` (${c.gitCommit})` : ''}`, hands: [], files: 0 };
    pool.hands.push(...r.hands);
    pool.files += 1;
    pools.set(key, pool);
  }
  const head = ['hero', 'files', 'hands', 'bb/100', '95% CI', 'sd/hand', 'as BB', 'as BTN', 'VPIP', 'PFR', 'fail-open'];
  const rows = [...pools.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((p) => {
      const s = summarizeSlumbot(p.hands);
      const ci = s.ci95 === null ? 'n/a' : `[${signed(s.ci95[0])}, ${signed(s.ci95[1])}]`;
      return [p.label, String(p.files), String(s.hands), signed(s.bb100), ci, `${s.sdPerHandBB.toFixed(1)} bb`, signed(s.asBigBlind.bb100), signed(s.asButton.bb100), `${Math.round(s.vpip * 100)}%`, `${Math.round(s.pfr * 100)}%`, String(s.failOpen)];
    });
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
