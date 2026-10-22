// `@studio/kit/charts` for mini apps (shelf/charts-1.js): <Chart> takes the
// Pages chart block's JSON and <Stats> its stat rows, drawn the same way.
// Recharts itself is on the shelf too, for anything custom. Checks are by
// hand, not zod, to keep the lib small.
import { ChartFigure, StatsView } from "../../pages/ui/chart-figure";
import { SERIES_COLORS, type ChartSpec, type StatItem } from "../../pages/chart-draw";

export { SERIES_COLORS, ChartFigure };
export type { ChartSpec, StatItem };

const TYPES = new Set(["bar", "line", "area", "pie"]);

function chartError(spec: Partial<ChartSpec>): string | null {
  if (spec.type !== undefined && !TYPES.has(spec.type)) return `type must be bar, line, area or pie`;
  if (!Array.isArray(spec.data) || spec.data.length === 0) return "data must be a non-empty list of rows";
  if (spec.data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return "each row in data must be an object";
  if (spec.series !== undefined && (!Array.isArray(spec.series) || spec.series.some((key) => typeof key !== "string"))) return "series must be a list of keys";
  return null;
}

/** `{ type: "bar" | "line" | "area" | "pie", title?, x?, series?, stacked?, unit?, data: rows }`, as props or `spec`. */
export function Chart({ spec, ...rest }: { spec?: Partial<ChartSpec> } & Partial<ChartSpec>) {
  const input = spec ?? rest;
  const error = chartError(input);
  if (error) return <p className="text-xs text-destructive-text">Chart: {error}.</p>;
  return <ChartFigure spec={{ ...input, type: input.type ?? "bar", data: input.data! }} />;
}

/** Up to six `{ label, value, delta?, trend?: "up" | "down" | "flat", caption? }`. */
export function Stats({ items }: { items: StatItem[] }) {
  if (!Array.isArray(items) || items.some((item) => !item || typeof item.label !== "string")) return <p className="text-xs text-destructive-text">Stats: pass items, each with a label and a value.</p>;
  return <StatsView items={items.slice(0, 6)} />;
}
