// "Turn into database": a page's basic table becomes a Studio table, its
// first row the column names, and the page embeds it live in its place.
import { convertCell, importGrid, type Column, type Values } from "@bb-studio/kit/tables";

type Inline = { type: string; text?: string; content?: unknown; props?: Record<string, unknown> };
type Cell = Inline[] | { type: "tableCell"; content?: Inline[] };
export type TableBlockContent = { type: "tableContent"; rows: { cells: Cell[] }[] };

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Inline[])
    .map((each) => {
      if (typeof each.text === "string") return each.text;
      if (each.type === "link") return inlineText(each.content);
      const label = each.props?.label;
      return typeof label === "string" ? label : "";
    })
    .join("");
}

/** A table block's cells as plain text, row by row. */
export function tableBlockGrid(content: TableBlockContent): string[][] {
  return content.rows.map((row) => row.cells.map((cell) => inlineText(Array.isArray(cell) ? cell : cell.content).trim()));
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** Columns and rows for a table block; columns whose every value is a number become number columns. */
export function databaseFromGrid(grid: string[][], newColumnId: () => string): { columns: Column[]; rows: Values[] } {
  const { columns, rows } = importGrid([], grid, newColumnId);
  const typed = columns.map((column): Column => {
    const values = rows.map((row) => row[column.id]).filter((cell) => cell !== "" && cell !== null && cell !== undefined);
    return values.length && values.every((cell) => typeof cell === "string" && NUMBER.test(cell.replace(/,/g, ""))) ? { ...column, type: "number" } : column;
  });
  return {
    columns: typed,
    rows: rows.map((row) =>
      Object.fromEntries(
        typed.map((column) => {
          const cell = row[column.id];
          return [column.id, column.type === "number" ? convertCell(cell, column) : (cell ?? null)];
        }),
      ),
    ),
  };
}
