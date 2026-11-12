// A picture wall (cv-wall) at phone widths, laid out by a real browser: every card's title, rating and line stay
// inside its own cell, and no card runs into the next row, however long the titles. jsdom does no layout, so
// this renders the page frame's CSS and kit in headless Chrome (--dump-dom) and reads what it measured. It
// Chrome won't size a window under 500px, so the page lays out in a frame of the exact size. It needs Chrome (CHROME_PATH, the usual install, or google-chrome on PATH, as on CI); without one it's skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ORGANIC_LOOKS } from "../looks";
import { defaultBbTheme } from "../theme";
import { canvasKit } from "./kit";
import { pageCss } from "./renderer";

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((path): path is string => !!path);
  for (const path of candidates) if (existsSync(path)) return path;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim();
    if (found) return found;
  }
  return null;
}
const chrome = findChrome();

/** The guide's showcase, the shape agents write, with titles long enough to wrap on a phone. */
const LONG = ["The Legend of Zelda: Link's Awakening DX", "The Legend of Zelda: Oracle of Seasons", "Pokémon Crystal Version", "Wario Land 3", "Metal Gear Solid", "Dragon Warrior Monsters", "Shantae"];
/**
 * The page's frame: the kit's cv-fill (a min-height grid), or the agent's own grid with a fixed height and a 1fr
 * middle row, a shape agents often write, where the old wall squeezed its rows to fit and its cards overlapped.
 */
const FRAMES = {
  fill: '<div class="cv-fill">',
  fixed: '<div style="height:calc(100vh - 60px);display:grid;grid-template-rows:auto 1fr auto;gap:24px">',
  // A fixed-height box inside the page: the wall's own rows must still hold their cards.
  nested: '<div class="cv-fill"><div style="height:320px;display:grid;grid-template-rows:auto 1fr;gap:16px">',
} as const;
type Frame = keyof typeof FRAMES;
const wall = (cols: number, frame: Frame = "fill") => `${FRAMES[frame]}
  <header data-cv-id="title"><div class="cv-kicker">Game Boy Color</div><h1 class="cv-h1">Six cartridges worth owning first</h1></header>
  <div class="cv-wall" style="--cv-cols:${cols}" data-cv-id="games">
    ${LONG.map((title, i) => `<div data-block="card" data-cv-id="g${i}"${i === 0 ? ' data-span="2"' : ""} data-title="${title}" data-rating="${9 - i * 0.3}" data-source="IGN" data-line="About $${20 + i * 5} loose, ${i % 2 ? "a short line" : "with a line long enough to wrap twice on a phone screen"}."></div>`).join("\n    ")}
  </div>
  ${frame === "nested" ? "</div>" : ""}<p class="cv-small" data-cv-id="source">Scores: IGN.</p>
</div>`;

/** Lays the page out at a width and returns each card's box and how far its content reaches. */
function measure(width: number, height: number, cols: number, look: (typeof ORGANIC_LOOKS)[number], frame: Frame = "fill") {
  const dir = mkdtempSync(join(tmpdir(), "cv-wall-"));
  const file = join(dir, "page.html");
  const inner = `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss(look, defaultBbTheme("light"))}</style>
<script>(${canvasKit.toString()})(window);<\/script></head><body><div id="cv-page"></div>
<script>
window.cv.morph(document.getElementById("cv-page"), ${JSON.stringify(wall(cols, frame))}, false, { fit: false });
const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; };
const cards = [...document.querySelectorAll(".cv-wall > .cv-card")].map((card) => {
  const parts = [...card.querySelectorAll(".cv-card-pic, .cv-card-title, .cv-card-rating, .cv-card-line")].map(box);
  return { id: card.dataset.cvId, box: box(card), reach: Math.max(...parts.map((p) => p.bottom)) };
});
parent.postMessage(JSON.stringify({ cards, wall: box(document.querySelector(".cv-wall")), source: box(document.querySelector('[data-cv-id="source"]')), viewport: innerWidth }), "*");
<\/script></body></html>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="f" style="width:${width}px;height:${height}px;border:0;display:block"></iframe>
<script>
addEventListener("message", (event) => { if (typeof event.data === "string") document.body.setAttribute("data-result", event.data); });
document.getElementById("f").srcdoc = ${JSON.stringify(inner).replace(/<\//g, "<\\/")};
</script></body></html>`;
  writeFileSync(file, html);
  const dom = execFileSync(chrome!, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1400,1000", "--virtual-time-budget=5000", "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
  const raw = /data-result="([^"]*)"/.exec(dom)?.[1];
  if (!raw) throw new Error("Chrome returned no measurement");
  const decoded = raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return JSON.parse(decoded) as {
    cards: { id: string; box: { x: number; y: number; w: number; h: number; bottom: number; right: number }; reach: number }[];
    wall: { bottom: number };
    source: { y: number };
    viewport: number;
  };
}

const overlaps = (a: { x: number; y: number; right: number; bottom: number }, b: { x: number; y: number; right: number; bottom: number }) =>
  a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;

describe.skipIf(!chrome)("a picture wall at phone widths (headless Chrome)", () => {
  for (const [width, height] of [[466, 678], [390, 844]] as const) {
    for (const [cols, frame] of [[4, "fill"], [3, "fill"], [4, "fixed"], [3, "fixed"]] as const) {
      it(`keeps every card's text in its own cell at ${width}px with ${cols} columns (${frame} page)`, () => {
        const result = measure(width, height, cols, "editorial", frame);
        cardsStayInTheirCells(result, width);
        // The wall holds its cards, and what follows it starts below it.
        expect(Math.max(...result.cards.map((c) => c.box.bottom))).toBeLessThanOrEqual(result.wall.bottom + 1);
        expect(result.source.y).toBeGreaterThanOrEqual(result.wall.bottom - 1);
      }, 90_000);
    }
  }

  // Where the wall's area keeps a fixed height (a box inside the page; a fixed page wider than a phone), an
  // agent's box can be outgrown, but the wall's own rows still never squeeze its cards into each other.
  for (const [width, height, frame] of [[466, 678, "nested"], [390, 844, "nested"], [951, 669, "fixed"]] as const) {
    it(`keeps every card in its own cell in a fixed-height area at ${width}px (${frame})`, () => {
      cardsStayInTheirCells(measure(width, height, 4, "editorial", frame), width);
    }, 90_000);
  }

  it("still fills the row it's in on a big screen", () => {
    const result = measure(1280, 900, 4, "field");
    // Seven short cards in two rows: the wall stretches to the page's full height, not to its content.
    expect(result.wall.bottom).toBeGreaterThan(600);
    for (const card of result.cards) expect(card.reach).toBeLessThanOrEqual(card.box.bottom + 1);
  }, 90_000);
});

type Measured = ReturnType<typeof measure>;

/** Three options side by side and a row of steps, with long single words, as agents write them for a comparison. */
const SIDES = `<div class="cv-fill"><h1 class="cv-h1" data-cv-id="t">Clean first, then bleach</h1>
  <div class="cv-sides" data-cv-id="ways">
    <section data-block="side" data-cv-id="a" data-label="1 · Always first" data-title="Wash and scrub" data-points="Warm soapy water | A soft toothbrush"></section>
    <section data-block="side" data-cv-id="b" data-label="2 · Best result" data-verdict="Pick" data-title="Peroxide gel and UV" data-points="Hydrogen peroxide cream | Sunlight or a UV lamp"></section>
    <section data-block="side" data-cv-id="c" data-label="3 · Cheapest" data-title="Oxygen bleach soak" data-points="Sodium percarbonate | Overnight"></section>
  </div>
  <section class="cv-steps" data-cv-id="plan">
    <div data-block="step" data-cv-id="s1" data-when="First · $100" data-title="Advance SP" data-line="The backlit one"></div>
    <div data-block="step" data-cv-id="s2" data-when="Then · $120" data-title="Cartridges" data-line="Five loose carts"></div>
    <div data-block="step" data-cv-id="s3" data-when="Last · $80" data-title="Restoration" data-line="Peroxide and a lamp"></div>
  </section></div>`;

/** Each side's and step's box, and whether any text in it is wider than the box. */
function measureColumns(width: number, height: number) {
  const dir = mkdtempSync(join(tmpdir(), "cv-sides-"));
  const file = join(dir, "page.html");
  const inner = `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss("editorial", defaultBbTheme("light"))}</style>
<script>(${canvasKit.toString()})(window);<\/script></head><body><div id="cv-page"></div>
<script>
window.cv.morph(document.getElementById("cv-page"), ${JSON.stringify(SIDES)}, false, { fit: false });
const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }; };
const items = [...document.querySelectorAll(".cv-side, .cv-step")].map((el) => ({ id: el.dataset.cvId, box: box(el),
  spill: Math.max(0, ...[...el.querySelectorAll("*")].map((child) => child.scrollWidth - child.clientWidth)) }));
parent.postMessage(JSON.stringify({ items }), "*");
<\/script></body></html>`;
  writeFileSync(file, `<!doctype html><html><body style="margin:0"><iframe id="f" style="width:${width}px;height:${height}px;border:0;display:block"></iframe>
<script>addEventListener("message", (event) => { if (typeof event.data === "string") document.body.setAttribute("data-result", event.data); });
document.getElementById("f").srcdoc = ${JSON.stringify(inner).replace(/<\//g, "<\\/")};</script></body></html>`);
  const dom = execFileSync(chrome!, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1400,1000", "--virtual-time-budget=5000", "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
  const raw = /data-result="([^"]*)"/.exec(dom)?.[1];
  if (!raw) throw new Error("Chrome returned no measurement");
  return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")) as { items: { id: string; box: { x: number; y: number; right: number; bottom: number }; spill: number }[] };
}

describe.skipIf(!chrome)("sides and steps at phone widths (headless Chrome)", () => {
  for (const [width, height] of [[382, 560], [390, 844], [466, 678]] as const) {
    it(`stack, so no title runs into the next column, at ${width}px`, () => {
      const { items } = measureColumns(width, height);
      expect(items).toHaveLength(6);
      for (const item of items) expect(item.spill, `${item.id} at ${width}px`).toBeLessThanOrEqual(1);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        expect(overlaps(items[i]!.box, items[j]!.box), `${items[i]!.id} and ${items[j]!.id} at ${width}px`).toBe(false);
      }
    }, 90_000);
  }
});
function cardsStayInTheirCells(result: Measured, width: number) {
  expect(result.viewport).toBe(width);
  expect(result.cards).toHaveLength(LONG.length);
  for (const card of result.cards) {
    // Nothing of the card reaches past its own box: no title or line under the next row's picture.
    expect(card.reach, `${card.id} at ${width}px`).toBeLessThanOrEqual(card.box.bottom + 1);
    expect(card.box.h, `${card.id} at ${width}px`).toBeGreaterThan(0);
  }
  for (let i = 0; i < result.cards.length; i++) {
    for (let j = i + 1; j < result.cards.length; j++) {
      expect(overlaps(result.cards[i]!.box, result.cards[j]!.box), `${result.cards[i]!.id} and ${result.cards[j]!.id} at ${width}px`).toBe(false);
    }
  }
}
