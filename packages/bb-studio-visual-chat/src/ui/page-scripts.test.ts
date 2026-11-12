// @vitest-environment jsdom
// When a page's own scripts run (a map, a chart library): once the page or its part is committed, never
// while it streams, in order, and not again for a part that a new version leaves as it was.
import { createElement } from "react";
// @ts-expect-error: react-dom ships no types here (BB provides it); only renderToStaticMarkup is used.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { canvasKit, type CanvasKit } from "./kit";
import { PageFrame } from "./page-frame";

// Page scripts run in jsdom's own global, so they report through the document: a count per id and an order.
canvasKit(window);
const cv = (window as unknown as { cv: CanvasKit }).cv;
const count = (id: string) => `var d = document.documentElement; d.setAttribute("data-runs-${id}", String(Number(d.getAttribute("data-runs-${id}") || 0) + 1));`;
const push = (what: string) => `document.documentElement.setAttribute("data-order", (document.documentElement.getAttribute("data-order") || "") + "${what};");`;
const runs = () => Object.fromEntries(Array.from(document.documentElement.attributes).filter((a) => a.name.startsWith("data-runs-")).map((a) => [a.name.slice(10), Number(a.value)]));
const order = () => (document.documentElement.getAttribute("data-order") ?? "").split(";").filter(Boolean);

/** A part that draws itself: counts each run of its script (a classic script with a const, as a map's would be). */
const scriptedPart = (id: string, label = "map") =>
  `<section data-cv-id="${id}"><div class="m">${label}</div><script>const el = document.currentScript; ${count(id)}</script></section>`;
const page = (extra = "", label = "map") => `<h1 data-cv-id="title">Stores${extra}</h1>${scriptedPart("map", label)}`;

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = `<div id="cv-page"></div>`;
  root = document.getElementById("cv-page")!;
  for (const a of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(a.name);
});

describe("a page's scripts", () => {
  it("don't run while the page streams, and run once when it's committed", () => {
    const html = page();
    cv.stream!(root, html.slice(0, html.indexOf("<script>")), false);
    cv.stream!(root, html.slice(0, html.indexOf("</script>")), false);
    cv.stream!(root, html, false);
    expect(runs().map).toBeUndefined();
    cv.stream!(root, html, true);
    expect(runs().map).toBe(1);
  });

  it("don't run again when the same page lands again with its pictures", () => {
    const html = `${page()}<div data-block="card" data-cv-id="c" data-title="Shop"></div><script>${count("page")}</script>`;
    cv.stream!(root, html, false);
    cv.stream!(root, html, true);
    const map = root.querySelector('[data-cv-id="map"]');
    cv.stream!(root, html.replace('data-title="Shop"', 'data-title="Shop" data-img="https://example.com/a.jpg"'), true);
    expect(runs()).toEqual({ map: 1, page: 1 });
    expect(root.querySelector('[data-cv-id="map"]')).toBe(map);
  });

  it("keep a part that runs its own script when a new version leaves it unchanged", () => {
    cv.morph!(root, page(), false);
    const map = root.querySelector('[data-cv-id="map"]');
    map!.setAttribute("data-live", "1"); // what the library drew stays
    cv.morph!(root, page(" near 10604"), true);
    expect(runs().map).toBe(1);
    expect(root.querySelector('[data-cv-id="map"]')).toBe(map);
    expect(root.querySelector("h1")!.textContent).toBe("Stores near 10604");
  });

  it("run a changed part's script again, and a const in it doesn't clash with the last run", () => {
    cv.morph!(root, page(), false);
    cv.morph!(root, page("", "map, zoomed"), true);
    cv.morph!(root, page("", "map, zoomed out"), true);
    expect(runs().map).toBe(3);
    expect(root.querySelector(".m")!.textContent).toBe("map, zoomed out");
  });

  it("keep a part that runs its own script on screen while a follow-up streams", () => {
    cv.morph!(root, page(), false);
    const map = root.querySelector('[data-cv-id="map"]');
    const next = page(" again", "map, new");
    cv.stream!(root, next, false);
    expect(root.querySelector('[data-cv-id="map"]')).toBe(map);
    expect(runs().map).toBe(1);
    cv.stream!(root, next, true);
    expect(runs().map).toBe(2);
    expect(root.querySelector(".m")!.textContent).toBe("map, new");
  });

  it("run in order: code after a library's script waits for it to load", () => {
    cv.morph!(root, `<div data-cv-id="m"></div><script src="https://cdn.jsdelivr.net/npm/lib.js"></script><script>${push("after")}</script>`, false);
    expect(order()).toEqual([]);
    const lib = root.querySelector<HTMLScriptElement>('script[src]')!;
    expect(lib.async).toBe(false);
    lib.dispatchEvent(new Event("load"));
    expect(order()).toEqual(["after"]);
  });

  it("stop an older run when a newer version arrives", () => {
    cv.morph!(root, `<script src="https://cdn.jsdelivr.net/npm/lib.js"></script><script>${push("old")}</script>`, false);
    const lib = root.querySelector<HTMLScriptElement>('script[src]')!;
    cv.morph!(root, `<script>${push("new")}</script>`, true);
    lib.dispatchEvent(new Event("load"));
    expect(order()).toEqual(["new"]);
  });

  it("leave data scripts alone", () => {
    cv.morph!(root, `<script type="application/json" id="d">{"a":1}</script><script>${push('" + JSON.parse(document.getElementById("d").textContent).a + "')}</script>`, false);
    expect(order()).toEqual(["1"]);
  });
});

describe("the page frame", () => {
  it("is sandboxed to scripts only: an opaque origin, no top navigation or popups", () => {
    const html: string = renderToStaticMarkup(createElement(PageFrame, { html: null, rev: 0, look: "editorial", mode: "light", title: "Board" }));
    const sandbox = /sandbox="([^"]*)"/.exec(html)?.[1];
    expect(sandbox).toBe("allow-scripts");
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
  });
});
