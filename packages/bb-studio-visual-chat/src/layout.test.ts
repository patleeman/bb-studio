import { describe, expect, it } from "vitest";
import { cellSize, columnsFor, COLUMN_STEPS, focusOf, overlaps, packBoard, type Cell, type LayoutItem } from "./layout";
import { CANVAS_KINDS, SIZE_HINTS } from "./shared";

const item = (id: string, fields: Partial<LayoutItem> = {}): LayoutItem => ({ id, kind: "bar", size: "m", importance: 3, createdAt: 1, updatedAt: 1, ...fields });

const election: LayoutItem[] = [
  item("headline", { kind: "headline", size: "l", importance: 5, createdAt: 1 }),
  item("house", { kind: "stat", size: "s", importance: 4, createdAt: 2 }),
  item("senate", { kind: "stat", size: "s", importance: 4, createdAt: 3 }),
  item("turnout", { kind: "stat", size: "s", importance: 4, createdAt: 4 }),
  item("races", { kind: "table", size: "l", importance: 3, createdAt: 5 }),
  item("margins", { kind: "bar", size: "l", importance: 3, createdAt: 6 }),
  item("note", { kind: "caption", size: "m", importance: 2, createdAt: 7 }),
];

function valid(cells: ReadonlyMap<string, Cell>, cols: number) {
  const list = [...cells.values()];
  for (const cell of list) {
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.x + cell.w).toBeLessThanOrEqual(cols);
  }
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) expect(overlaps(list[a]!, list[b]!)).toBe(false);
}

const plain = (cells: ReadonlyMap<string, Cell>) => Object.fromEntries([...cells.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

/** A seeded random board, so the property checks are repeatable. */
function randomBoard(seed: number, count: number): LayoutItem[] {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: count }, (_, index) => item(`i${index}`, {
    kind: CANVAS_KINDS[Math.floor(next() * CANVAS_KINDS.length)]!,
    size: SIZE_HINTS[Math.floor(next() * SIZE_HINTS.length)]!,
    importance: 1 + Math.floor(next() * 5),
    createdAt: index,
    updatedAt: index + Math.floor(next() * 3),
  }));
}

describe("columns", () => {
  it("steps with the board's width", () => {
    expect(columnsFor(1400)).toBe(12);
    expect(columnsFor(900)).toBe(8);
    expect(columnsFor(500)).toBe(4);
  });

  it("widens a table to fit its columns, and leaves narrow tables to their hint", () => {
    expect(cellSize("table", "m", 12, 2).w).toBe(6);
    expect(cellSize("table", "m", 12, 5).w).toBe(7);
    expect(cellSize("table", "l", 12, 7).w).toBe(10);
    expect(cellSize("table", "s", 12, 9).w).toBe(12);
    expect(cellSize("table", "s", 8, 9).w).toBe(8);
    expect(cellSize("table", "l", 4, 9).w).toBe(4);
    expect(cellSize("bar", "m", 12, 9).w).toBe(4);
    const packed = packBoard([item("races", { kind: "table", size: "m", columns: 8 }), item("note", { kind: "caption", importance: 1 })], 12);
    expect(packed.cells.get("races")!.w).toBe(12);
    valid(packed.cells, 12);
  });

  it("never makes a cell wider than the grid", () => {
    for (const cols of COLUMN_STEPS) for (const kind of CANVAS_KINDS) for (const size of SIZE_HINTS) for (const columns of [0, 3, 20]) expect(cellSize(kind, size, cols, columns).w).toBeLessThanOrEqual(cols);
  });
});

describe("packing", () => {
  it("puts the focus top-left and makes it the biggest", () => {
    const packed = packBoard(election, 12);
    expect(packed.focusId).toBe("headline");
    expect(packed.cells.get("headline")).toMatchObject({ x: 0, y: 0 });
    const area = (cell: Cell) => cell.w * cell.h;
    const focusArea = area(packed.cells.get("headline")!);
    for (const [id, cell] of packed.cells) if (id !== "headline") expect(area(cell)).toBeLessThanOrEqual(focusArea);
    valid(packed.cells, 12);
  });

  it("picks the most recently changed item among equally important ones as the focus", () => {
    const board = [item("a", { importance: 4, updatedAt: 10 }), item("b", { importance: 4, updatedAt: 20 }), item("c", { importance: 2, updatedAt: 30 })];
    expect(focusOf(board)?.id).toBe("b");
    expect(packBoard(board, 12).cells.get("b")).toMatchObject({ x: 0, y: 0 });
  });

  it("is deterministic, whatever order the items come in", () => {
    const first = packBoard(election, 12);
    const shuffled = packBoard([...election].reverse(), 12);
    expect(plain(shuffled.cells)).toEqual(plain(first.cells));
    expect(plain(packBoard(election, 12, first.cells).cells)).toEqual(plain(packBoard(election, 12, first.cells).cells));
  });

  it("orders the rest by importance, then by when they arrived", () => {
    const packed = packBoard(election, 12);
    const position = (id: string) => { const cell = packed.cells.get(id)!; return cell.y * 100 + cell.x; };
    expect(position("house")).toBeLessThan(position("senate"));
    expect(position("senate")).toBeLessThan(position("turnout"));
    expect(position("turnout")).toBeLessThan(position("note"));
  });

  it("packs any board without overlaps at every width", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const board = randomBoard(seed, 1 + (seed % 20));
      for (const cols of COLUMN_STEPS) {
        const packed = packBoard(board, cols);
        expect(packed.cells.size).toBe(board.length);
        valid(packed.cells, cols);
        // And again with the last layout as the hint.
        valid(packBoard(board, cols, packed.cells).cells, cols);
      }
    }
  });
});

describe("stability", () => {
  it("keeps every item in place when a less important one is added", () => {
    const before = packBoard(election, 12);
    const after = packBoard([...election, item("footnote", { kind: "caption", size: "s", importance: 1, createdAt: 99, updatedAt: 99 })], 12, before.cells);
    for (const [id, cell] of before.cells) expect(after.cells.get(id)).toEqual(cell);
    valid(after.cells, 12);
  });

  it("keeps every item in place when one's data changes", () => {
    const before = packBoard(election, 12);
    const updated = election.map((each) => (each.id === "margins" ? { ...each, updatedAt: 50 } : each));
    expect(plain(packBoard(updated, 12, before.cells).cells)).toEqual(plain(before.cells));
  });

  it("only floats items up, never sideways, when one is removed", () => {
    const before = packBoard(election, 12);
    const after = packBoard(election.filter((each) => each.id !== "house"), 12, before.cells);
    for (const [id, cell] of after.cells) {
      const was = before.cells.get(id)!;
      expect(cell.x).toBe(was.x);
      expect(cell.y).toBeLessThanOrEqual(was.y);
    }
    valid(after.cells, 12);
  });

  it("moves a new focus to the top-left and keeps the board packed", () => {
    const before = packBoard(election, 12);
    const chart = item("turnout-chart", { kind: "line", size: "l", importance: 5, createdAt: 100, updatedAt: 100 });
    const after = packBoard([...election, chart], 12, before.cells);
    expect(after.focusId).toBe("turnout-chart");
    expect(after.cells.get("turnout-chart")).toMatchObject({ x: 0, y: 0 });
    valid(after.cells, 12);
  });

  it("puts a displaced important item above less important ones, not at the bottom", () => {
    const before = packBoard(election, 12);
    const chart = item("margins-chart", { kind: "bar", size: "l", importance: 5, createdAt: 100, updatedAt: 100 });
    const demoted = election.map((each) => (each.id === "headline" ? { ...each, importance: 4, updatedAt: 90 } : each));
    const after = packBoard([...demoted, chart], 12, before.cells);
    expect(after.focusId).toBe("margins-chart");
    const headline = after.cells.get("headline")!;
    for (const id of ["races", "margins", "note"]) expect(headline.y).toBeLessThanOrEqual(after.cells.get(id)!.y);
    valid(after.cells, 12);
  });

  it("re-packs for a narrow window with everything within four columns", () => {
    const wide = packBoard(election, 12);
    const narrow = packBoard(election, 4);
    valid(narrow.cells, 4);
    expect(narrow.cells.get("headline")).toMatchObject({ x: 0, y: 0, w: 4 });
    expect(narrow.rows).toBeGreaterThan(wide.rows);
  });
});
