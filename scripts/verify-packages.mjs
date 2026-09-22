// Packs each workspace package the way `pnpm publish` would (publishConfig applied) and checks
// the tarball: publint for package.json/file mistakes, attw for types that resolve wrongly.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const root = resolve(import.meta.dirname, "..");
const packs = join(root, ".packs");
rmSync(packs, { recursive: true, force: true });
mkdirSync(packs);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = false;

for (const name of readdirSync(join(root, "packages"))) {
  const dir = join(root, "packages", name);
  execFileSync(pnpm, ["pack", "--pack-destination", packs], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const tarball = readdirSync(packs).find(
    (f) => f.startsWith(`jev-poker-${name}-`) && f.endsWith(".tgz"),
  );
  if (tarball === undefined) throw new Error(`no tarball produced for ${name}`);
  const path = join(packs, tarball);

  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const { messages } = await publint({
    pack: { tarball: readFileSync(path).buffer },
    strict: true,
  });
  for (const m of messages) {
    console.log(`publint ${name}: ${formatMessage(m, pkg)}`);
    if (m.type === "error") failed = true;
  }

  try {
    execFileSync("attw", [path, "--profile", "esm-only"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } catch {
    failed = true;
  }
}

if (failed) {
  console.error("package verification failed");
  process.exit(1);
}
console.log("packages verified");
