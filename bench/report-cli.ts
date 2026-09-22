import { fileURLToPath } from "node:url";
import { pickLatest, resultsToMarkdown } from "./report";
import { listResultFiles, readResult } from "./results-io";
import { summarize } from "./stats";
import type { BenchResult } from "./types";

const RESULTS_DIR = fileURLToPath(new URL("results/", import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : await listResultFiles(RESULTS_DIR);
  if (files.length === 0) fail(`no result files (looked in ${RESULTS_DIR}); run pnpm bench first`);

  const results: BenchResult[] = [];
  for (const file of files) {
    const result = await readResult<BenchResult>(file);
    // Recompute from the raw hands: the stored summary reflects the statistics code of its day.
    results.push({ ...result, summary: summarize(result.hands, result.config.format) });
  }

  process.stdout.write(`${resultsToMarkdown(pickLatest(results))}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
