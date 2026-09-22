import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Result files are gzipped JSON (`*.json.gz`): a match with thousands of hands is 16 MB of
 * text and about a twelfth of that compressed, and the repository keeps every run. Plain
 * `*.json` from before the change is still read, so old runs need no conversion by hand.
 */
export function isResultFile(name: string): boolean {
  return name.endsWith(".json") || name.endsWith(".json.gz");
}

/** Every result in `dir`, as full paths; an absent directory is simply empty. */
export async function listResultFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const base = dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`;
  return entries.filter(isResultFile).map((name) => `${base}${name}`);
}

export async function readResult<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(path);
  const text = path.endsWith(".gz") ? await gunzipAsync(raw) : raw;
  return JSON.parse(text.toString("utf8")) as T;
}

/**
 * Writes `<path>.tmp` and renames it into place, so an interrupted run never leaves a
 * truncated result behind. Gzipped when the name says so; pretty-printed either way, since
 * a diff of two runs is still the easiest way to see what changed.
 */
export async function writeResult(path: string, result: unknown): Promise<void> {
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const body = path.endsWith(".gz") ? await gzipAsync(text, { level: 9 }) : text;
  await writeFile(`${path}.tmp`, body);
  await rename(`${path}.tmp`, path);
}
