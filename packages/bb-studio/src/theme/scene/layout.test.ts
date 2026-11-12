// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { LAYOUT_SETTLE_MS, layoutColumn, LayoutWatch, measureLayout, openAreas, openSpot, type LayoutRect, type SceneLayout } from "./layout";

const panel = (left: number, width: number, height: number): LayoutRect => ({ left, top: 10, right: left + width, bottom: height - 12 });
const layout = (width: number, height: number, sidebar: number, side: LayoutRect | null = null): SceneLayout => ({ width, height, sidebar, panel: side });
const spot = (each: SceneLayout) => openSpot(each, 0.09 * each.width);

describe("the open areas of the window", () => {
  it("are what the sidebar, the transcript column and the side panel leave: the gutters and the bar above the cards", () => {
    const closed = layout(1600, 1000, 318);
    expect(layoutColumn(closed)).toEqual({ left: 555, top: 48, right: 1363, bottom: 988 });
    expect(openAreas(closed)).toEqual(expect.arrayContaining([
      { left: 318, top: 0, right: 555, bottom: 1000 },
      { left: 1363, top: 0, right: 1600, bottom: 1000 },
      { left: 0, top: 0, right: 1600, bottom: 48 },
      { left: 0, top: 988, right: 1600, bottom: 1000 },
    ]));
    expect(openAreas(closed)).toHaveLength(4);
    const open = layout(2200, 1200, 318, panel(1650, 540, 1200));
    expect(layoutColumn(open)).toMatchObject({ left: 580, right: 1388 });
    expect(openAreas(open)).toEqual(expect.arrayContaining([{ left: 1388, top: 0, right: 1650, bottom: 1200 }, { left: 2190, top: 0, right: 2200, bottom: 1200 }]));
  });

  it("puts the spot in the gutter right of the transcript while the panel is closed, as before", () => {
    expect(spot(layout(1600, 1000, 318))).toMatchObject({ x: 1481.5, roomy: true });
    expect(spot(layout(2200, 1200, 318))).toMatchObject({ x: 1931.5, roomy: true });
  });

  it("puts it between the transcript and an open side panel, in a wide gutter or centered in a narrow one", () => {
    expect(spot(layout(2200, 1200, 318, panel(1650, 540, 1200)))).toMatchObject({ area: { left: 1388, right: 1650 }, x: 1519, roomy: true });
    expect(spot(layout(2200, 1200, 318, panel(1290, 900, 1200)))).toMatchObject({ area: { left: 1208, right: 1290 }, x: 1249, roomy: false });
    expect(spot(layout(1600, 1000, 318, panel(1086, 504, 1000)))).toMatchObject({ area: { left: 1076, right: 1086 }, x: 1081, roomy: false });
    for (const each of [layout(2200, 1200, 318, panel(1650, 540, 1200)), layout(1600, 1000, 318, panel(1086, 504, 1000)), layout(1600, 1000, 0, panel(1086, 504, 1000))]) {
      const chosen = spot(each)!;
      expect(chosen.x).toBeGreaterThanOrEqual(layoutColumn(each).right);
      expect(chosen.x).toBeLessThanOrEqual(each.panel!.left);
    }
  });

  it("follows a collapsed sidebar: the column moves to the middle of the wider space and the spot with it", () => {
    expect(spot(layout(1600, 1000, 0))).toMatchObject({ area: { left: 1204, right: 1600 }, x: 1402, roomy: true });
    expect(spot(layout(1600, 1000, 0, panel(1086, 504, 1000)))).toMatchObject({ area: { left: 947, right: 1086 }, x: 1016.5, roomy: false });
  });

  it("keeps the spot off the window's edge in a narrow window, and has none when the column fills the space", () => {
    const narrow = spot(layout(1280, 800, 318))!;
    expect(narrow.roomy).toBe(false);
    expect(narrow.x).toBeCloseTo(1280 - (0.09 * 1280) / 2, 5);
    expect(narrow.x).toBeGreaterThan(layoutColumn(layout(1280, 800, 318)).right);
    expect(spot(layout(1100, 800, 318))).toBeNull();
  });
});

describe("the settled layout", () => {
  const sample = (width: number, sidebar: number, side: LayoutRect | null | undefined) => ({ width, height: 1000, sidebar, panel: side });

  it("takes the first measurement at once and a change only once it has held for the settle time", () => {
    const watch = new LayoutWatch();
    expect(watch.current()).toBeNull();
    expect(watch.sample(sample(1600, 318, null), 0)).toBe(true);
    expect(watch.sample(sample(1600, 318, null), 250)).toBe(false);
    const opening = [1500, 1400, 1300, 1200, 1100];
    opening.forEach((left, index) => expect(watch.sample(sample(1600, 318, panel(left, 1590 - left, 1000)), 500 + index * 100), String(left)).toBe(false));
    expect(watch.current()!.panel).toBeNull();
    expect(watch.sample(sample(1600, 318, panel(1086, 504, 1000)), 1000)).toBe(false);
    expect(watch.sample(sample(1600, 318, panel(1086, 504, 1000)), 1000 + LAYOUT_SETTLE_MS - 1)).toBe(false);
    expect(watch.sample(sample(1600, 318, panel(1086, 504, 1000)), 1000 + LAYOUT_SETTLE_MS)).toBe(true);
    expect(watch.current()).toEqual({ width: 1600, height: 1000, sidebar: 318, panel: panel(1086, 504, 1000) });
  });

  it("drops a change that goes back before it settles, and ignores sub-pixel differences", () => {
    const watch = new LayoutWatch();
    watch.sample(sample(1600, 318, null), 0);
    expect(watch.sample(sample(1600, 0, null), 100)).toBe(false);
    expect(watch.sample(sample(1600, 318.2, null), 200)).toBe(false);
    expect(watch.sample(sample(1600, 0, null), 300)).toBe(false);
    expect(watch.sample(sample(1600, 0, null), 300 + LAYOUT_SETTLE_MS - 1)).toBe(false);
    expect(watch.current()!.sidebar).toBe(318);
  });

  it("keeps the side panel's last state on a page that has no side panel", () => {
    const watch = new LayoutWatch();
    watch.sample(sample(1600, 318, panel(1086, 504, 1000)), 0);
    for (let step = 1; step <= 8; step += 1) expect(watch.sample(sample(1600, 318, undefined), step * 250)).toBe(false);
    expect(watch.current()!.panel).toEqual(panel(1086, 504, 1000));
    watch.sample(sample(1600, 318, null), 3000);
    expect(watch.sample(sample(1600, 318, null), 3250)).toBe(true);
    expect(watch.current()!.panel).toBeNull();
  });
});

describe("measuring the layout", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  const place = (element: Element, left: number, top: number, width: number, height: number) => {
    element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
  };
  const build = (html: string) => { document.body.innerHTML = html; };

  it("reads the sidebar's width and the open side panel's place, and nothing else on the page", () => {
    build('<div data-sidebar="gap"></div><main data-sidebar="inset"><div data-thread-window><div data-scroll-attached></div></div><aside data-surface-tone="sidebar"></aside></main>');
    place(document.querySelector('[data-sidebar="gap"]')!, 0, 0, 318, 1000);
    place(document.querySelector("aside")!, 1086, 10, 504, 978);
    place(document.querySelector("[data-scroll-attached]")!, 400, 48, 600, 900);
    const first = measureLayout(document);
    expect(first).toMatchObject({ sidebar: 318, panel: { left: 1086, top: 10, right: 1590, bottom: 988 } });
    expect([first.width, first.height]).toEqual([window.innerWidth, window.innerHeight]);
    place(document.querySelector("[data-scroll-attached]")!, 330, 48, 740, 900);
    place(document.querySelector("[data-thread-window]")!, 320, 48, 760, 940);
    document.querySelector("main")!.append(Object.assign(document.createElement("div"), { className: "page-card" }));
    expect(measureLayout(document)).toEqual(first);
  });

  it("reads a closed side panel as closed, a collapsed sidebar as no sidebar, and a page without a side panel as unknown", () => {
    build('<div data-sidebar="gap"></div><main data-sidebar="inset"><aside data-surface-tone="sidebar" aria-hidden="true" inert></aside></main>');
    place(document.querySelector('[data-sidebar="gap"]')!, 0, 0, 0, 1000);
    place(document.querySelector("aside")!, 1590, 10, 504, 978);
    expect(measureLayout(document)).toMatchObject({ sidebar: 0, panel: null });
    build('<div data-sidebar="gap"></div><main data-sidebar="inset"><section>Settings</section></main><aside data-surface-tone="sidebar"></aside>');
    place(document.querySelector('[data-sidebar="gap"]')!, 0, 0, 56, 1000);
    place(document.querySelector("aside")!, 900, 10, 504, 978);
    const page = measureLayout(document);
    expect(page.sidebar).toBe(56);
    expect(page.panel).toBeUndefined();
  });
});
