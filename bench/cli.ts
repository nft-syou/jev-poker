import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VERSION } from '@typesafe-ai/sdk';
import { createMockBackend, createTypeSafeBackend, getPersona } from '../src/jev/index.js';
import { expandMatchups } from './matchups.js';
import { HelpRequested, USAGE, parseArgs, resultFileName, resultsToMarkdown, type CliOptions } from './report.js';
import { runMatch } from './runner.js';
import { summarize } from './stats.js';
import type { BenchResult } from './types.js';

const RESULTS_DIR = fileURLToPath(new URL('results/', import.meta.url));
const PROGRESS_EVERY = 10;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function gitCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readOptions(): CliOptions {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof HelpRequested) {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    return fail(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }
}

async function main(): Promise<void> {
  const opts = readOptions();

  // The SDK client is built eagerly and throws without a key, so this check comes first.
  if (opts.backend === 'typesafe' && (process.env['TYPESAFE_API_KEY'] ?? '') === '') {
    fail('TYPESAFE_API_KEY is not set');
  }

  const persona = getPersona(opts.persona);
  const commit = gitCommit();

  let sigints = 0;
  let controller = new AbortController();
  process.on('SIGINT', () => {
    sigints += 1;
    if (sigints >= 2) process.exit(130);
    process.stderr.write('\ninterrupted: finishing the hands in flight, then writing results (Ctrl-C again to quit)\n');
    controller.abort();
  });

  const results: BenchResult[] = [];

  for (const matchup of expandMatchups(opts.opponent, opts.format)) {
    const tag = `${matchup.opponent}/${matchup.format}`;
    controller = new AbortController();

    const backend =
      opts.backend === 'typesafe'
        ? createTypeSafeBackend({ ...(opts.model !== null ? { model: opts.model } : {}) })
        : createMockBackend();

    const startedAt = new Date().toISOString();
    // One loud warning per matchup: a fail-open means the table saw the fallback
    // action, not a Jev decision, so the numbers below are diluted.
    let warnedFailOpen = false;
    const { hands, partial } = await runMatch({
      opponent: matchup.opponent,
      format: matchup.format,
      seeds: opts.seeds,
      baseSeed: opts.baseSeed,
      concurrency: opts.concurrency,
      persona,
      backend,
      signal: controller.signal,
      onHand: (done, total) => {
        if (done % PROGRESS_EVERY === 0 || done === total) process.stderr.write(`[${tag}] ${done}/${total} hands\n`);
      },
    });

    const result: BenchResult = {
      version: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      partial,
      config: {
        opponent: matchup.opponent,
        format: matchup.format,
        seeds: opts.seeds,
        persona: opts.persona,
        backend: opts.backend,
        model: opts.model,
        baseSeed: opts.baseSeed,
        concurrency: opts.concurrency,
        sdkVersion: VERSION,
        gitCommit: commit,
      },
      summary: summarize(hands, matchup.format),
      hands,
    };
    results.push(result);

    await mkdir(RESULTS_DIR, { recursive: true });
    const label = opts.label ?? `${matchup.opponent}-${matchup.format}`;
    const file = `${RESULTS_DIR}${resultFileName(result, label)}`;
    await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stderr.write(`[${tag}] wrote ${file}\n`);

    if (controller.signal.aborted) break;
  }

  process.stdout.write(`${resultsToMarkdown(results)}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
