import { execSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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
      promptStyle: opts.promptStyle,
      signal: controller.signal,
      onHand: (done, total) => {
        if (done % PROGRESS_EVERY === 0 || done === total) process.stderr.write(`[${tag}] ${done}/${total} hands\n`);
      },
      onDecision: (record) => {
        if (record.error === undefined || warnedFailOpen) return;
        warnedFailOpen = true;
        process.stderr.write(`warning: Jev decision failed open: ${record.error}\n`);
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
        promptStyle: opts.promptStyle,
      },
      summary: summarize(hands, matchup.format),
      hands,
    };
    results.push(result);

    await mkdir(RESULTS_DIR, { recursive: true });
    // `resultFileName` adds the matchup itself; `--label` (or null) is all it needs.
    const file = `${RESULTS_DIR}${resultFileName(result, opts.label)}`;
    // Write then rename, so an interrupted run never leaves a truncated JSON behind.
    await writeFile(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(`${file}.tmp`, file);
    process.stderr.write(`[${tag}] wrote ${file}\n`);

    if (controller.signal.aborted) break;
  }

  process.stdout.write(`${resultsToMarkdown(results)}\n`);

  // After the table, so the warnings are the last thing on the screen.
  for (const r of results) {
    const { failOpen } = r.summary.jev;
    if (failOpen === 0) continue;
    process.stderr.write(
      `warning: ${r.config.opponent}/${r.config.format}: ${failOpen} decisions failed open\n`,
    );
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
