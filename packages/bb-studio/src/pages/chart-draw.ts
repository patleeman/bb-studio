// Charts' colors and how a spec's axes are filled in. No zod here: mini
// apps' chart lib bundles this, and the schemas are in chart-spec.ts.

export type ChartCell = string | number | null;

/** The chart block's spec (chartSpecSchema), after defaults. */
export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  x?: string;
  series?: string[];
  stacked?: boolean;
  unit?: string;
  data: Record<string, ChartCell>[];
}

export interface StatItem {
  label: string;
  value: string | number;
  delta?: string;
  trend?: "up" | "down" | "flat";
  caption?: string;
}

/** Series colors for charts: Pages' chart blocks and dashboard charts. */
export const SERIES_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#a855f7", "#ef4444"];

export interface ResolvedChart {
  spec: ChartSpec;
  x: string;
  series: string[];
}

/** Fills in `x` and `series` from the data when the spec leaves them out. */
export function resolveChart(spec: ChartSpec): ResolvedChart {
  const keys = [...new Set(spec.data.flatMap((row) => Object.keys(row)))];
  const x =
    spec.x ??
    keys.find((key) => spec.data.some((row) => typeof row[key] === "string")) ??
    keys[0] ??
    "x";
  const series =
    spec.series ??
    keys.filter((key) => key !== x && spec.data.some((row) => typeof row[key] === "number")).slice(0, 8);
  return { spec, x, series };
}

