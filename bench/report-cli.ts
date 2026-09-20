import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pickLatest, resultsToMarkdown } from './report.js';
import { summarize } from './stats.js';
import type { BenchResult } from './types.js';

const RESULTS_DIR = fileURLToPath(new URL('results/', import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function defaultFiles(): Promise<string[]> {
  try {
    const entries = await readdir(RESULTS_DIR);
    return entries.filter((name) => name.endsWith('.json')).map((name) => `${RESULTS_DIR}${name}`);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : await defaultFiles();
  if (files.length === 0) fail(`no result files (looked in ${RESULTS_DIR}); run pnpm bench first`);

  const results: BenchResult[] = [];
  for (const file of files) {
    const result = JSON.parse(await readFile(file, 'utf8')) as BenchResult;
    // Recompute from the raw hands: the stored summary reflects the statistics code of its day.
    results.push({ ...result, summary: summarize(result.hands, result.config.format) });
  }

  process.stdout.write(`${resultsToMarkdown(pickLatest(results))}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
