import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

function containerWidths(container: string): number[] {
  const pattern = new RegExp(
    `@container ${container} \\(max-width: (\\d+(?:\\.\\d+)?)rem\\)`,
    "gu",
  );
  return [...css.matchAll(pattern)].map((match) => Number(match[1]));
}

describe("the composer keeps its full form in a side-by-side pane", () => {
  it("collapses to one line and hides labels only below 24rem", () => {
    expect(containerWidths("promptbox")).toEqual([24]);
    expect(Math.max(...containerWidths("promptbox-shell"))).toBeLessThanOrEqual(26);
    expect(css).toMatch(
      /@container promptbox-shell \(max-width: 24rem\) \{\s*\[data-follow-up-composer\] \{\s*--follow-up-composer-container-compact: true;/u,
    );
  });
});
