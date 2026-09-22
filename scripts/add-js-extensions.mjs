// Rewrites `from "./x"` / `from "../x"` to `from "./x.js"` inside the given directories.
// Only extensionless relative specifiers change; package imports and `.json` are left alone.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
if (dirs.length === 0) throw new Error("usage: node scripts/add-js-extensions.mjs <dir>...");

const SPECIFIER = /(from\s+|import\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

let changed = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const before = readFileSync(file, "utf8");
    const after = before.replace(SPECIFIER, (all, lead, quote, spec) =>
      /\.(js|ts|json)$/.test(spec) ? all : `${lead}${quote}${spec}.js${quote}`,
    );
    if (after !== before) {
      writeFileSync(file, after);
      changed++;
    }
  }
}
console.log(`rewrote ${changed} file(s)`);
