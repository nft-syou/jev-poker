// Packs each workspace package the way `pnpm publish` would (publishConfig applied), then
// checks the tarball: publint for package.json/file mistakes, attw for types that resolve
// wrongly, and finally an end-to-end smoke test that installs the tarballs into a throwaway
// consumer and runs a plain script against the published entry points.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const root = resolve(import.meta.dirname, "..");
const packs = join(root, ".packs");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const windows = process.platform === "win32";

rmSync(packs, { recursive: true, force: true });
mkdirSync(packs);

/** Packs `name`'s package.json with `publishConfig` applied and returns the tarball's path. */
function packTarball(name, dir) {
  execFileSync(pnpm, ["pack", "--pack-destination", packs], {
    cwd: dir,
    stdio: "inherit",
    shell: windows,
  });
  const tarball = readdirSync(packs).find(
    (f) => f.startsWith(`jev-poker-${name}-`) && f.endsWith(".tgz"),
  );
  if (tarball === undefined) throw new Error(`no tarball produced for ${name}`);
  return join(packs, tarball);
}

/** Runs publint against the packed tarball; returns false if it reported an error. */
async function lintTarball(name, dir, tarballPath) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  // readFileSync's buffer can be a slice of a shared pool, not a whole ArrayBuffer of its own;
  // hand publint only the bytes that belong to this file.
  const buf = readFileSync(tarballPath);
  const { messages } = await publint({
    pack: { tarball: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
    strict: true,
  });
  let ok = true;
  for (const message of messages) {
    console.log(`publint ${name}: ${formatMessage(message, pkg)}`);
    if (message.type === "error") ok = false;
  }
  return ok;
}

/** Runs attw against the packed tarball; returns false if it reported a type problem. */
function checkTypes(tarballPath) {
  try {
    execFileSync("attw", [tarballPath, "--profile", "esm-only"], {
      cwd: root,
      stdio: "inherit",
      shell: windows,
    });
    return true;
  } catch {
    return false;
  }
}

/** Converts an absolute path under `packs` to a `/`-joined path relative to it, for `tar`. */
function relativeToPacks(path) {
  return relative(packs, path).split(sep).join("/");
}

/** Extracts a `pnpm pack` tarball (its files sit under `package/`) into `dir` and returns that. */
function extractTarball(tarballPath, dir) {
  mkdirSync(dir, { recursive: true });
  // Both GNU tar (Git Bash) and bsdtar (Windows' built-in tar.exe) must work from any shell.
  // GNU tar parses an argument like `C:\...` as a remote `host:path` spec, so every argument
  // here is relative to `cwd` and uses forward slashes; `--force-local` is not an option because
  // bsdtar rejects it as unknown.
  execFileSync("tar", ["-xzf", basename(tarballPath), "-C", relativeToPacks(dir)], {
    cwd: packs,
  });
  return join(dir, "package");
}

/**
 * Copies the workspace's installed `@typesafe-ai/sdk` into the consumer's `node_modules`, the
 * way `pnpm install` would for a real consumer of `@jev-poker/agent`. It ships no runtime
 * dependencies of its own (checked below against its own package.json), so a plain directory
 * copy — resolved the same way Node would resolve it from `packages/agent` — is a complete,
 * working install.
 */
function copyTypeSafeSdk(consumerDir) {
  const require = createRequire(join(root, "packages", "agent", "package.json"));
  const sdkPackageJsonPath = require.resolve("@typesafe-ai/sdk/package.json");
  const sdkDir = dirname(sdkPackageJsonPath);
  const sdkPkg = JSON.parse(readFileSync(sdkPackageJsonPath, "utf8"));
  const sdkDeps = Object.keys(sdkPkg.dependencies ?? {});
  if (sdkDeps.length > 0) {
    throw new Error(
      `@typesafe-ai/sdk now declares runtime dependencies (${sdkDeps.join(", ")}); ` +
        "consumerSmoke only copies the sdk package itself and needs updating to copy these too",
    );
  }
  const typeSafeModules = join(consumerDir, "node_modules", "@typesafe-ai");
  mkdirSync(typeSafeModules, { recursive: true });
  cpSync(sdkDir, join(typeSafeModules, "sdk"), { recursive: true });
}

const SMOKE_SCRIPT = `import assert from "node:assert/strict";
import * as agent from "@jev-poker/agent";
import * as engine from "@jev-poker/engine";

assert.equal(Object.keys(agent).length, 33, "expected 33 runtime exports from @jev-poker/agent");

const table = new engine.Table({
  format: "cash",
  blinds: engine.fixedBlinds(1, 2),
  startingStack: 200,
  seed: 1,
  seats: [
    { id: 0, name: "jev", kind: "cpu" },
    { id: 1, name: "rules", kind: "cpu" },
    { id: 2, name: "caller", kind: "cpu" },
  ],
});
const tag = agent.PRESET_PERSONAS.find((p) => p.id === "tag");
const agents = [
  new agent.JevAgent({ persona: tag, backend: agent.createMockBackend(), seed: 1 }),
  new agent.RulesAgent(),
  new agent.CallerAgent(),
];
const snapshot = await agent.playHand(table, agents);
assert.equal(snapshot.complete, true, "expected the hand to reach completion");

assert.equal(agent.createTypeSafeBackend({ apiKey: "x" }).kind, "typesafe");

console.log("consumer smoke: ok (33 exports, 1 hand)");
`;

/**
 * End-to-end check that the tarballs are actually consumable: extract both into a fresh
 * `.packs/consumer/`, lay out a `node_modules` from them plus `@typesafe-ai/sdk`, and run a
 * plain Node script against the published entry points — imports, a full hand, and the backend
 * factory. Returns false if the script exits non-zero.
 */
function consumerSmoke(tarballs) {
  const consumerDir = join(packs, "consumer");
  rmSync(consumerDir, { recursive: true, force: true });
  mkdirSync(consumerDir, { recursive: true });

  const jevPokerModules = join(consumerDir, "node_modules", "@jev-poker");
  mkdirSync(jevPokerModules, { recursive: true });
  for (const [name, tarballPath] of Object.entries(tarballs)) {
    const extracted = extractTarball(tarballPath, join(consumerDir, "extract", name));
    cpSync(extracted, join(jevPokerModules, name), { recursive: true });
  }

  copyTypeSafeSdk(consumerDir);

  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  );
  writeFileSync(join(consumerDir, "smoke.mjs"), SMOKE_SCRIPT);

  try {
    execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumerDir, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

let failed = false;
const tarballs = {};
for (const name of readdirSync(join(root, "packages"))) {
  const dir = join(root, "packages", name);
  const tarballPath = packTarball(name, dir);
  tarballs[name] = tarballPath;
  if (!(await lintTarball(name, dir, tarballPath))) failed = true;
  if (!checkTypes(tarballPath)) failed = true;
}

if (!failed && !consumerSmoke(tarballs)) failed = true;

if (failed) {
  console.error("package verification failed");
  process.exit(1);
}
console.log("packages verified");
