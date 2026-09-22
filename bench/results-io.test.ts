import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isResultFile, listResultFiles, readResult, writeResult } from "./results-io";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jev-results-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeResult / readResult", () => {
  it("round-trips a result through a gzipped file", async () => {
    const path = join(dir, "run.json.gz");
    const result = { startedAt: "2026-09-22T00:00:00.000Z", hands: [{ net: [1, -1] }] };
    await writeResult(path, result);
    expect(await readResult(path)).toEqual(result);
    // Really gzip on disk: the raw bytes are not the JSON text, and gunzip gives it back.
    const raw = await readFile(path);
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
    expect(JSON.parse(gunzipSync(raw).toString("utf8"))).toEqual(result);
  });

  it("leaves no temporary file behind", async () => {
    await writeResult(join(dir, "run.json.gz"), { ok: true });
    expect(await readdir(dir)).toEqual(["run.json.gz"]);
  });

  it("still reads a plain .json result from before the change", async () => {
    const path = join(dir, "old.json");
    await writeFile(path, JSON.stringify({ legacy: true }), "utf8");
    expect(await readResult(path)).toEqual({ legacy: true });
  });
});

describe("listResultFiles", () => {
  it("lists .json and .json.gz results, nothing else, as full paths", async () => {
    await writeFile(join(dir, "a.json"), "{}", "utf8");
    await writeResult(join(dir, "b.json.gz"), {});
    await writeFile(join(dir, "c.json.tmp"), "{", "utf8");
    await writeFile(join(dir, "notes.md"), "", "utf8");
    const files = await listResultFiles(dir);
    expect(files.map((f) => f.slice(dir.length + 1)).sort()).toEqual(["a.json", "b.json.gz"]);
  });

  it("is empty for a directory that does not exist", async () => {
    expect(await listResultFiles(join(dir, "missing"))).toEqual([]);
  });

  it("recognises result file names", () => {
    expect(isResultFile("x.json")).toBe(true);
    expect(isResultFile("x.json.gz")).toBe(true);
    expect(isResultFile("x.json.tmp")).toBe(false);
    expect(isResultFile("x.gz")).toBe(false);
  });
});
