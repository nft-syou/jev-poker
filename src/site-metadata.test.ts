import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const html = readFileSync(fileURLToPath(new URL("index.html", root)), "utf8");
const publicFile = (name: string) => fileURLToPath(new URL(`public/${name}`, root));

/** The `content`/`href` of the first tag whose `property`/`name`/`rel` is `key`. */
function tag(attr: "property" | "name" | "rel", key: string): string | null {
  const re = new RegExp(`<(?:meta|link)[^>]*\\b${attr}="${key}"[^>]*>`);
  const match = re.exec(html);
  if (match === null) return null;
  return /\b(?:content|href)="([^"]*)"/.exec(match[0])?.[1] ?? null;
}

// Link previews are rendered by crawlers that never run the app, so everything they need
// has to be in the static index.html and in files that Vite copies from public/ as they are.
describe("site metadata", () => {
  it("describes the page for crawlers", () => {
    expect(html).toMatch(/<html lang="ja">/);
    expect(html).toMatch(/<title>jev-poker/);
    expect(tag("name", "description")).toMatch(/TypeSafe Jev/);
    expect(tag("rel", "canonical")).toBe("https://jev-poker.syou.io/");
  });

  it("has an Open Graph card with an absolute 1200x630 image", () => {
    expect(tag("property", "og:type")).toBe("website");
    expect(tag("property", "og:url")).toBe("https://jev-poker.syou.io/");
    expect(tag("property", "og:title")).toMatch(/jev-poker/);
    expect(tag("property", "og:description")).not.toBeNull();
    expect(tag("property", "og:image")).toBe("https://jev-poker.syou.io/og.png");
    expect(tag("property", "og:image:width")).toBe("1200");
    expect(tag("property", "og:image:height")).toBe("630");
    expect(tag("name", "twitter:card")).toBe("summary_large_image");
    expect(tag("name", "twitter:image")).toBe("https://jev-poker.syou.io/og.png");
  });

  it("ships every file the head points at", () => {
    for (const name of [
      "og.png",
      "favicon.ico",
      "favicon.svg",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "site.webmanifest",
      "robots.txt",
    ]) {
      expect(existsSync(publicFile(name)), name).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(publicFile("site.webmanifest"), "utf8"));
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual([
      "/icon-192.png",
      "/icon-512.png",
    ]);
    expect(tag("name", "theme-color")).toBe(manifest.theme_color);
  });
});
