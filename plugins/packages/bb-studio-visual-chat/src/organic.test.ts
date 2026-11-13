import { describe, expect, it } from "vitest";
import { canvasFirstNote, canvasInstructions } from "./instructions";
import { ORGANIC_LOOKS } from "./looks";
import { inferComposition, layoutOrganic, organicSizes, PATTERNS, type Frame, type OrganicItem, type Placed } from "./organic";
import { COMPOSITIONS } from "./shared";

let clock = 0;
const item = (id: string, kind: OrganicItem["kind"], size: OrganicItem["size"], importance = 3, extra: Partial<OrganicItem> = {}): OrganicItem => ({ id, kind, size, importance, createdAt: ++clock, updatedAt: clock, ...extra });

/** The user's window, a narrower one, and a phone. */
const WIDE: Frame = { width: 1736, height: 950 };
const MID: Frame = { width: 1136, height: 640 };
const PHONE: Frame = { width: 420, height: 700 };

const board = () => [
  item("lead", "line", "xl", 5),
  item("seats", "stat", "s", 4),
  item("turnout", "stat", "s", 4),
  item("map", "map", "m", 3),
  item("quote", "quote", "m", 3),
  item("races", "table", "l", 3),
  item("why", "caption", "s", 2, { pinnedTo: "map", point: { x: 1, y: 0.3 } }),
  item("timeline", "timeline", "m", 2),
];
/** Heights that roughly follow width, as measured ones do. */
const heightsFor = (items: readonly OrganicItem[], frame: Frame) => {
  const sizes = organicSizes(items, frame, "editorial");
  return new Map(items.map((each, index) => [each.id, Math.round(Math.min(sizes.get(each.id)!.room, 70 + sizes.get(each.id)!.w * 0.32 + ((index * 37) % 60)))]));
};
const overlap = (a: Placed, b: Placed, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const pairs = (rects: Map<string, Placed>) => { const list = [...rects.entries()]; return list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b] as const)); };

describe("composition", () => {
  it.each(ORGANIC_LOOKS)("%s: nothing overlaps, everything stays on the screen's width, and the hero is the biggest", (look) => {
    const items = board();
    for (const frame of [WIDE, MID, PHONE]) {
      const layout = layoutOrganic(items, frame, look, heightsFor(items, frame));
      for (const [id, rect] of layout.rects) {
        expect(rect.x, id).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, id).toBeLessThanOrEqual(frame.width + 0.5);
      }
      for (const [[ia, a], [ib, b]] of pairs(layout.rects)) expect(overlap(a, b), `${ia} / ${ib} at ${frame.width}`).toBe(false);
      expect(layout.focusId).toBe("lead");
      const lead = layout.rects.get("lead")!;
      for (const [, rect] of layout.rects) expect(lead.w * lead.h).toBeGreaterThanOrEqual(rect.w * rect.h);
    }
  });

  it("fills the screen on both axes instead of flowing from the top-left", () => {
    const items = board();
    for (const frame of [WIDE, MID]) {
      const layout = layoutOrganic(items, frame, "editorial", heightsFor(items, frame));
      const rects = [...layout.rects.values()];
      const right = Math.max(...rects.map((r) => r.x + r.w)), left = Math.min(...rects.map((r) => r.x));
      const bottom = Math.max(...rects.map((r) => r.y + r.h)), top = Math.min(...rects.map((r) => r.y));
      expect(right - left).toBeGreaterThan(frame.width * 0.85);
      expect(bottom - top).toBeGreaterThan(frame.height * 0.75);
      // Something in the right third and in the bottom third (the old layout left both empty).
      expect(rects.some((r) => r.x + r.w / 2 > frame.width * 0.66)).toBe(true);
      expect(rects.some((r) => r.y + r.h / 2 > frame.height * 0.66)).toBe(true);
    }
  });

  it("has no grid: free x positions and varied widths, at clearly different scales", () => {
    const items = [...board(), item("x1", "stat", "s", 3), item("x2", "stat", "s", 3), item("x3", "caption", "m", 2)];
    const layout = layoutOrganic(items, WIDE, "editorial", heightsFor(items, WIDE));
    const rects = [...layout.rects.values()];
    expect(new Set(rects.map((r) => r.x)).size).toBeGreaterThanOrEqual(rects.length - 2);
    // Same-scale items still differ in width (no column widths).
    const small = rects.filter((r) => r.scale === "small").map((r) => r.w);
    expect(new Set(small).size).toBeGreaterThan(1);
    // The hero is far bigger than any other piece.
    const lead = layout.rects.get("lead")!;
    for (const [id, rect] of layout.rects) if (id !== "lead") expect(rect.w, id).toBeLessThan(lead.w * 0.75);
  });

  it("composes differently per composition, and mirrors for some heroes", () => {
    const centers = new Map<string, string>();
    for (const comp of COMPOSITIONS) {
      const items = [item("hero", comp === "giant-number" ? "stat" : comp === "map" ? "map" : comp === "spine" ? "timeline" : comp === "quote" ? "quote" : "line", "xl", 5, comp === "split" ? { scale: "hero" } : {}), item("b", "bar", "m", 4, comp === "split" ? { scale: "hero" } : {}), item("c", "stat", "s", 3), item("d", "caption", "m", 2)];
      const layout = layoutOrganic(items, WIDE, "editorial", heightsFor(items, WIDE), null, comp);
      expect(layout.composition).toBe(comp);
      const hero = layout.rects.get("hero")!;
      centers.set(comp, `${Math.round((hero.x + hero.w / 2) / 100)},${Math.round((hero.y + hero.h / 2) / 100)},${Math.round(hero.w / 100)}`);
    }
    expect(new Set(centers.values()).size).toBeGreaterThanOrEqual(5);
    // The same board under two hero ids: one is the mirror of the other.
    const a = layoutOrganic([item("a", "line", "xl", 5), item("s", "stat", "s", 3)], WIDE, "editorial", new Map([["a", 400], ["s", 140]]), null, "orbit").rects.get("a")!;
    const b = layoutOrganic([item("b", "line", "xl", 5), item("s", "stat", "s", 3)], WIDE, "editorial", new Map([["b", 400], ["s", 140]]), null, "orbit").rects.get("b")!;
    expect(Math.sign(a.x + a.w / 2 - WIDE.width / 2)).not.toBe(Math.sign(b.x + b.w / 2 - WIDE.width / 2));
  });

  it("infers a composition from the hero when the agent names none", () => {
    expect(inferComposition(item("n", "stat", "s", 5))).toBe("giant-number");
    expect(inferComposition(item("m", "map", "m", 5))).toBe("map");
    expect(inferComposition(item("t", "timeline", "m", 5))).toBe("spine");
    expect(inferComposition(item("q", "quote", "m", 5))).toBe("quote");
    expect(inferComposition(item("c", "custom", "xl", 5))).toBe("orbit");
    expect(PATTERNS.spine.hero.w).toBeGreaterThan(0.9);
  });

  it("honors rough regions", () => {
    const items = [item("lead", "line", "xl", 5), item("tr", "stat", "s", 3, { region: "top-right" }), item("bl", "caption", "m", 3, { region: "bottom-left" }), item("c", "stat", "s", 2)];
    const layout = layoutOrganic(items, WIDE, "editorial", heightsFor(items, WIDE));
    const tr = layout.rects.get("tr")!, bl = layout.rects.get("bl")!;
    expect(tr.x + tr.w / 2).toBeGreaterThan(WIDE.width * 0.6);
    expect(tr.y + tr.h / 2).toBeLessThan(WIDE.height * 0.4);
    expect(bl.x + bl.w / 2).toBeLessThan(WIDE.width * 0.4);
    expect(bl.y + bl.h / 2).toBeGreaterThan(WIDE.height * 0.6);
  });

  it("pins an item next to a spot on another, on the side asked for", () => {
    const items = [item("lead", "line", "xl", 5), item("fact", "stat", "s", 3, { pinnedTo: "lead", point: { x: 1, y: 0.8 }, side: "right" }), item("other", "caption", "m", 2)];
    const layout = layoutOrganic(items, WIDE, "editorial", heightsFor(items, WIDE));
    const lead = layout.rects.get("lead")!, fact = layout.rects.get("fact")!;
    expect(fact.x).toBeGreaterThanOrEqual(lead.x + lead.w);
    expect(fact.x - (lead.x + lead.w)).toBeLessThan(60);
    const py = lead.y + 0.8 * lead.h;
    expect(py).toBeGreaterThanOrEqual(fact.y - 40);
    expect(py).toBeLessThanOrEqual(fact.y + fact.h + 40);
    // Nothing is drawn between them: the layout has no links at all.
    expect("links" in layout).toBe(false);
  });

  it("lets a hero bleed off the board's edge", () => {
    const items = [item("wide", "area", "xl", 5, { bleed: true }), item("s", "stat", "s", 3)];
    const layout = layoutOrganic(items, WIDE, "editorial", new Map([["wide", 420], ["s", 120]]), null, "close-up");
    const wide = layout.rects.get("wide")!;
    expect(wide.x < 0 || wide.x + wide.w > WIDE.width).toBe(true);
  });

  it("composes a narrow screen too: the hero on top, full width, the rest below without overlap", () => {
    const items = board();
    const layout = layoutOrganic(items, PHONE, "field", heightsFor(items, PHONE));
    const lead = layout.rects.get("lead")!;
    expect(lead.y).toBe(0);
    expect(lead.w).toBe(PHONE.width);
    for (const [, rect] of layout.rects) expect(rect.x + rect.w).toBeLessThanOrEqual(PHONE.width + 0.5);
  });

  it("is deterministic whatever order items come in, and stable when a minor item arrives", () => {
    const items = board();
    const h = heightsFor(items, WIDE);
    const a = layoutOrganic(items, WIDE, "field", h);
    const b = layoutOrganic([...items].reverse(), WIDE, "field", h);
    expect([...b.rects.entries()].sort()).toEqual([...a.rects.entries()].sort());
    const more = [...items, item("extra", "stat", "s", 1)];
    const c = layoutOrganic(more, WIDE, "field", new Map([...h, ["extra", 100]]), a.rects);
    for (const id of items.map((each) => each.id)) expect(c.rects.get(id), id).toEqual(a.rects.get(id));
  });

  it("places hand-placed items exactly (reference boards)", () => {
    const items = [item("a", "line", "xl", 5, { fixed: { x: 0.1, y: 0.2, w: 0.5 } }), item("b", "stat", "s", 3)];
    const layout = layoutOrganic(items, WIDE, "editorial", new Map([["a", 300], ["b", 120]]));
    expect(layout.rects.get("a")).toMatchObject({ x: Math.round(0.1 * WIDE.width), y: Math.round(0.2 * WIDE.height), w: Math.round(0.5 * WIDE.width) });
    expect(overlap(layout.rects.get("a")!, layout.rects.get("b")!)).toBe(false);
  });

});

describe("fitting the screen", () => {
  it("scales a sparse board up and centers it, so the screen has no dead zones", () => {
    const items = [item("n", "stat", "s", 5), item("a", "caption", "m", 3), item("b", "caption", "s", 2)];
    const layout = layoutOrganic(items, WIDE, "editorial", new Map([["n", 260], ["a", 90], ["b", 70]]));
    expect(layout.fit.scale).toBeGreaterThan(1);
    expect(layout.fit.scale).toBeLessThanOrEqual(1.4);
    const rects = [...layout.rects.values()].map((r) => ({ x: r.x * layout.fit.scale + layout.fit.x, y: r.y * layout.fit.scale + layout.fit.y, w: r.w * layout.fit.scale, h: r.h * layout.fit.scale }));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.5);
      expect(r.x + r.w).toBeLessThanOrEqual(WIDE.width + 0.5);
      expect(r.y).toBeGreaterThanOrEqual(-0.5);
      expect(r.y + r.h).toBeLessThanOrEqual(WIDE.height + 0.5);
    }
  });

  it("shrinks a board a little over the screen to fit it, and lets a much taller one scroll", () => {
    const items = board();
    const tall = new Map([...heightsFor(items, WIDE)].map(([id, h]) => [id, h * 2.2]));
    expect(layoutOrganic(items, WIDE, "editorial", tall).fit).toEqual({ scale: 1, x: 0, y: 0 });
    const narrowFit = layoutOrganic(items, PHONE, "editorial", heightsFor(items, PHONE)).fit;
    expect(narrowFit.scale).toBe(1);
  });
});

describe("pins", () => {
  it("drops a pin whose target left: the item is placed on its own", () => {
    const items = [item("a", "headline", "xl", 5), item("b", "table", "xl", 4), item("n", "caption", "s", 2, { pinnedTo: "gone" })];
    const layout = layoutOrganic(items, WIDE, "editorial", new Map());
    expect(layout.rects.has("n")).toBe(true);
    for (const [[ia, a], [ib, b]] of pairs(layout.rects)) expect(overlap(a, b), `${ia} / ${ib}`).toBe(false);
  });

  it("keeps a pinned item next to its target after the target moves", () => {
    const items = board();
    const layout = layoutOrganic(items, WIDE, "editorial", heightsFor(items, WIDE));
    const map = layout.rects.get("map")!, why = layout.rects.get("why")!;
    const gapX = Math.max(0, why.x - (map.x + map.w), map.x - (why.x + why.w));
    const gapY = Math.max(0, why.y - (map.y + map.h), map.y - (why.y + why.h));
    expect(Math.min(gapX + gapY, 200)).toBeLessThan(120);
  });
});

describe("look instructions", () => {
  it("fit the configure hook's 4,096 characters, and the first note carries the guide", () => {
    for (const look of [...ORGANIC_LOOKS, "classic" as const]) for (const provider of [null, "claude-code"]) expect(canvasInstructions(look, provider).length).toBeLessThan(4096);
    for (const look of ORGANIC_LOOKS) {
      const note = canvasFirstNote(look);
      expect(note).toContain("DESIGN GUIDE");
      expect(note).toContain("EXAMPLES");
      // The guide's embed paragraph (data-embed) took it past 16,000.
      expect(note.length).toBeLessThan(16_500);
    }
  });
});

describe("speed", () => {
  it("has the agent write the page in its reply first, then look all pictures up in one call, with no draft", () => {
    const rules = canvasInstructions("editorial");
    expect(rules).toContain("IN YOUR REPLY, as one fenced html block");
    expect(rules).toContain("BEFORE any canvas tool call");
    expect(rules).toContain("call canvas_images ONCE");
    expect(rules).toContain("No draft page");
    expect(rules).not.toContain("Draft first");
    expect(canvasFirstNote("editorial")).toContain("WORK FAST: THE PAGE FIRST, IN YOUR REPLY");
    expect(canvasFirstNote("editorial")).toContain("```html title=\"Game Boy Color\"");
  });

  it("names the exact tools to load on Claude Code, where plugin tools are deferred, and only there", () => {
    expect(canvasInstructions("field", "claude-code")).toContain("select:mcp__bb-bridge__canvas_page,mcp__bb-bridge__canvas_images,mcp__bb-bridge__canvas_patch,mcp__bb-bridge__canvas_read");
    expect(canvasFirstNote("field", "claude-code")).toContain("select:mcp__bb-bridge__canvas_page");
    expect(canvasInstructions("field", "codex")).not.toContain("mcp__bb-bridge");
  });
});
