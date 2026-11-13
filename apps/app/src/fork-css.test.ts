import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "fork.css"), "utf8");
const main = readFileSync(join(here, "main.tsx"), "utf8");

function block(selectorStart: string): string {
  const at = css.indexOf(selectorStart);
  if (at === -1) throw new Error(`no rule starting ${selectorStart}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("fork.css", () => {
  it("loads after bb's app.css, so its unlayered rules win", () => {
    expect(main.indexOf('import "./fork.css"')).toBeGreaterThan(
      main.indexOf('import "./app.css"'),
    );
    expect(css).not.toMatch(/@layer\b/u);
  });

  it("draws one quiet focus ring, only for keyboard focus", () => {
    const visible = block(":focus-visible:not(");
    expect(visible).toContain(
      "outline: 1px solid color-mix(in oklab, var(--ring) 50%, transparent)",
    );
    expect(visible).toContain("outline-offset: 2px");
    expect(visible).toContain("--tw-ring-shadow: 0 0 #0000");
    const pointer = block(":focus:not(:focus-visible)");
    expect(pointer).toContain("outline: none");
    expect(pointer).toContain("--tw-ring-shadow: 0 0 #0000");
  });

  it("makes the sidebar's header row 38px, so a 30px control sits at y=4", () => {
    expect(
      block('[data-testid="app-layout-root"]:not([data-framed])'),
    ).toContain("--bb-app-chrome-row-height: 38px");
  });

  it("makes the sidebar a 320px overlay drawer below 768px with a mouse, and leaves phones alone", () => {
    expect(css).toContain("@media (width < 48rem) and (pointer: fine)");
    const closed = block(
      '[data-sidebar="panel"][data-vaul-drawer-direction="left"] {',
    );
    expect(closed).toContain(
      "--sidebar-width-mobile: min(320px, calc(100vw - 48px)) !important",
    );
    expect(closed).toContain("translate: -100% 0");
    expect(closed).toContain("visibility: hidden");
    expect(closed).toContain("z-index: 45");
    const open = block(
      '[data-sidebar="panel"][data-vaul-drawer-direction="left"][data-state="open"]',
    );
    expect(open).toContain("translate: 0 0");
    expect(open).toContain("visibility: visible");
    expect(block('[data-sidebar="inset"][data-sidebar-shelf],')).toContain(
      "translate: none !important",
    );
  });

  it("uses no achromatic color literals", () => {
    expect(css).not.toMatch(/oklch\([^)]*\s0\s+0\)/u);
  });
});
