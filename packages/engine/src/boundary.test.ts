import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("engine boundary", () => {
  it("imports only sibling engine modules (no React, DOM, jev, ui or packages)", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    // `from "x"` anywhere (also matches `export * from`, `export { a } from`, and multi-line imports)
    const fromPattern = /\bfrom\s+["']([^"']+)["']/g;
    // side-effect imports: `import "x";`
    const sideEffectPattern = /^\s*import\s+["']([^"']+)["']/gm;
    // dynamic imports: `import("x")`
    const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      const specifiers = [fromPattern, sideEffectPattern, dynamicPattern].flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => match[1] ?? ""),
      );
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\/[a-z-]+\.js$/);
      }
    }
  });
});
