// The chart block's JSON, parsed and drawn (chart-figure.tsx draws it).
import { chartSpecSchema, parseJsonWith } from "../chart-spec";
import { ChartFigure } from "./chart-figure";

export { ChartFigure, StatsView } from "./chart-figure";

export const EXAMPLE_CHART = JSON.stringify({
  type: "bar",
  title: "Example",
  data: [
    { label: "Mon", Value: 4 },
    { label: "Tue", Value: 7 },
    { label: "Wed", Value: 5 },
  ],
});

/** A chart block's JSON, drawn; an error when it doesn't parse. */
export function ChartView({ spec }: { spec: string }) {
  const parsed = parseJsonWith(chartSpecSchema, spec || EXAMPLE_CHART);
  if (!parsed.ok) return <p className="text-sm text-red-500">{parsed.error}</p>;
  return <ChartFigure spec={parsed.value} />;
}

