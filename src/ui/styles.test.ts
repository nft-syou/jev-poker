import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\})\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)*${escaped}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(css);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1] ?? "";
}

// jsdom computes no layout, so these guard the two stylesheet facts that were measured in a real
// browser to stop the table from changing width on every action.
describe("layout stability guards", () => {
  it("clips chip flights exactly at the felt", () => {
    // Each flight is a felt-sized box translated by tens of percent. Any clip margin counted as
    // scrollable overflow: a 390px page grew to 400px for a few frames per bet.
    const layer = rule(".fx-layer");
    expect(layer).toMatch(/overflow:\s*clip/);
    expect(layer).not.toMatch(/overflow-clip-margin/);
    expect(layer).toMatch(/inset:\s*0/);
  });

  it("does not let the action feed set the table column's minimum width", () => {
    // A grid item's default `min-width: auto` is its min-content width; the feed is a row of
    // unbreakable entries, so at 820px the whole column sat 50px wider than the page and
    // changed width as entries came and went.
    expect(rule(".table-screen > *")).toMatch(/min-width:\s*0/);
    const feed = rule(".action-feed");
    expect(feed).toMatch(/overflow:\s*hidden/);
    expect(feed).toMatch(/min-width:\s*0/);
    // Packed right, so it is the oldest entries that leave the strip, not the newest action.
    expect(feed).toMatch(/justify-content:\s*flex-end/);
  });

  it("keeps the scrollbar gutter reserved so a vertical scrollbar cannot shift the layout", () => {
    expect(rule(":root")).toMatch(/scrollbar-gutter:\s*stable/);
  });
});

// Measured at 390x844 and 375x667: the fixed action bar used to sit on top of the bottom seat,
// the player's own, hiding 145px of it (all of it) on their own turn.
describe("action bar guards", () => {
  it("keeps room under the felt for the bar and scrolls the felt clear of it", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(phone).toMatch(/padding-bottom:\s*calc\([^;]*var\(--turn-bar-height, 0px\)/);
    expect(phone).toMatch(/scroll-margin-bottom:\s*calc\([^;]*var\(--turn-bar-height, 0px\)/);
  });

  it("gives fold, call and raise a fixed slot each, whichever of them are on offer", () => {
    expect(rule(".action-main")).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(rule(".action-main .passive")).toMatch(/grid-column:\s*2/);
    expect(rule(".action-main .aggressive")).toMatch(/grid-column:\s*3/);
  });

  it("sizes the amount inputs to their grid cell, padding included", () => {
    // Without it the 84px number box rendered 110px wide and ran under the + button.
    expect(rule('.sizing-fine input[type="number"]')).toMatch(/box-sizing:\s*border-box/);
  });
});
