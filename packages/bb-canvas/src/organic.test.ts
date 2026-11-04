import { describe, expect, it } from "vitest";
import { canvasFirstNote, canvasInstructions } from "./instructions";
import { ORGANIC_LOOKS } from "./looks";
import { layoutOrganic, linkEnds, organicWidths, type OrganicItem, type Placed } from "./organic";

let clock = 0;
const item = (id: string, kind: OrganicItem["kind"], size: OrganicItem["size"], importance = 3, extra: Partial<OrganicItem> = {}): OrganicItem => ({ id, kind, size, importance, createdAt: ++clock, updatedAt: clock, ...extra });

const board = () => [
  item("lead", "custom", "xl", 5),
  item("seats", "stat", "s", 4),
  item("turnout", "stat", "s", 4),
  item("map", "map", "m", 3),
  item("quote", "quote", "m", 3, { relatedTo: ["lead"] }),
  item("races", "table", "l", 3),
  item("why", "note", "s", 2, { anchor: "map", point: { x: 0.8, y: 0.3 } }),
  item("timeline", "timeline", "m", 2),
];
const heights = (items: readonly OrganicItem[]) => new Map(items.map((each, index) => [each.id, 90 + ((index * 37) % 140)]));
const overlap = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("organic layout", () => {
  it.each(ORGANIC_LOOKS)("%s: flowing items never overlap and stay on the board; the focus is the widest", (look) => {
    const items = board();
    for (const width of [1400, 900, 420]) {
      const layout = layoutOrganic(items, width, look, heights(items));
      const flow = [...layout.rects.entries()].filter(([, rect]) => !rect.floating);
      for (const [, rect] of layout.rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(width + 0.5);
      }
      for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
        // Field offsets items a little; they may touch, never stack.
        const [, a] = flow[i]!; const [, b] = flow[j]!;
        // Editorial pull quotes hang into the gutter, over a neighbor's edge by at most a gutter.
        const shrink = look === "field" ? 14 : [flow[i]![0], flow[j]![0]].includes("quote") && look === "editorial" ? 40 : 0;
        expect(overlap({ ...a, x: a.x + shrink, w: a.w - shrink * 2, y: a.y + shrink, h: a.h - shrink * 2 }, b), `${flow[i]![0]} / ${flow[j]![0]} at ${width}`).toBe(false);
      }
      expect(layout.focusId).toBe("lead");
      const lead = layout.rects.get("lead")!;
      for (const [, rect] of flow) expect(lead.w).toBeGreaterThanOrEqual(rect.w);
    }
  });

  it("puts the focus top-left in editorial and instrument, and in the middle in field notes", () => {
    const items = board();
    expect(layoutOrganic(items, 1400, "editorial", heights(items)).rects.get("lead")).toMatchObject({ x: 0, y: 0 });
    expect(layoutOrganic(items, 1400, "instrument", heights(items)).rects.get("lead")).toMatchObject({ x: 0, y: 0 });
    const tall = new Map([...heights(items), ["lead", 360]]);
    const field = layoutOrganic(items, 1400, "field", tall).rects.get("lead")!;
    expect(Math.abs(field.x + field.w / 2 - 700)).toBeLessThan(120);
    // Items orbit a tall focus: some to its left, some to its right, beside it.
    const top = [...layoutOrganic(items, 1400, "field", tall).rects.values()].filter((rect) => rect.y < field.h + 60 && !rect.floating && rect.x !== field.x);
    expect(top.some((rect) => rect.x + rect.w <= field.x + 20)).toBe(true);
    expect(top.some((rect) => rect.x >= field.x + field.w - 20)).toBe(true);
  });

  it("sizes items by content: a taller item pushes only what's below it in its lanes", () => {
    const items = board();
    const base = heights(items);
    const a = layoutOrganic(items, 1400, "editorial", base);
    const b = layoutOrganic(items, 1400, "editorial", new Map([...base, ["lead", (base.get("lead") ?? 0) + 200]]), a.rects);
    // The rail beside the lead stays put.
    expect(b.rects.get("seats")).toEqual(a.rects.get("seats"));
    expect(b.rects.get("lead")!.h).toBe(a.rects.get("lead")!.h + 200);
  });

  it("is deterministic whatever order items come in, and stable when a minor item arrives", () => {
    const items = board();
    const h = heights(items);
    const a = layoutOrganic(items, 1200, "field", h);
    const b = layoutOrganic([...items].reverse(), 1200, "field", h);
    expect([...b.rects.entries()].sort()).toEqual([...a.rects.entries()].sort());
    const more = [...items, item("extra", "stat", "s", 1)];
    const c = layoutOrganic(more, 1200, "field", new Map([...h, ["extra", 100]]), a.rects);
    for (const id of items.map((each) => each.id)) expect(c.rects.get(id), id).toEqual(a.rects.get(id));
  });

  it("floats a note beside its anchor, pointing at its point, and links related items", () => {
    const items = board();
    for (const look of ORGANIC_LOOKS) {
      const layout = layoutOrganic(items, 1400, look, heights(items));
      const note = layout.rects.get("why")!;
      const map = layout.rects.get("map")!;
      expect(note.floating).toBe(true);
      // Beside the map: touching it, or across one gutter.
      expect(note.x + note.w).toBeGreaterThanOrEqual(map.x - 40);
      expect(note.x).toBeLessThanOrEqual(map.x + map.w + 40);
      expect(layout.links).toEqual(expect.arrayContaining([{ from: "why", to: "map", kind: "anchor", point: { x: 0.8, y: 0.3 } }]));
      // A related pair gets a line unless the two already touch.
      const quote = layout.rects.get("quote")!, lead = layout.rects.get("lead")!;
      const apart = (() => { const e = linkEnds(quote, lead, null); return Math.hypot(e.x2 - e.x1, e.y2 - e.y1) >= 96; })();
      expect(layout.links.some((link) => link.from === "quote" && link.to === "lead")).toBe(apart);
      const ends = linkEnds(note, map, { x: 0.8, y: 0.3 });
      expect(ends.x2).toBe(Math.round(map.x + 0.8 * map.w));
      expect(ends.y2).toBe(Math.round(map.y + 0.3 * map.h));
    }
  });

  it("drops links to items that left, and treats an unanchored note as a normal item", () => {
    const items = [item("a", "headline", "xl", 5), item("b", "table", "xl", 4), item("c", "table", "xl", 4), item("n", "note", "s", 2, { anchor: "gone", relatedTo: ["gone", "a"] })];
    const layout = layoutOrganic(items, 1200, "editorial", new Map());
    expect(layout.rects.get("n")!.floating).toBe(false);
    expect(layout.links).toEqual([{ from: "n", to: "a", kind: "related", point: null }]);
  });

  it("gives widths before heights are known, the same the layout uses", () => {
    const items = board();
    const widths = organicWidths(items, 1400, "instrument");
    const layout = layoutOrganic(items, 1400, "instrument", new Map());
    for (const [id, rect] of layout.rects) expect(rect.w).toBe(widths.get(id));
  });
});

describe("look instructions", () => {
  it("fit the configure hook's 4,096 characters, and the first note carries the guide", () => {
    for (const look of [...ORGANIC_LOOKS, "classic" as const]) {
      expect(canvasInstructions(look).length).toBeLessThan(4096);
    }
    for (const look of ORGANIC_LOOKS) {
      const note = canvasFirstNote(look);
      expect(note).toContain("DESIGN GUIDE");
      expect(note).toContain("Rich but focused");
      expect(note).not.toContain("Keep the board small");
      expect(note.length).toBeLessThan(16_000);
    }
  });
});
