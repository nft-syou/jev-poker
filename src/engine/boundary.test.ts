import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("engine boundary", () => {
  it("imports only sibling engine modules (no React, DOM, jev, ui or packages)", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    const importPattern = /^\s*(?:import|export)\b[^'"]*?\bfrom\s+["']([^"']+)["']/gm;
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1] ?? "";
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\/[a-z-]+$/);
      }
    }
  });
});
