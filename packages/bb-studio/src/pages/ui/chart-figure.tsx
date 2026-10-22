// Chart and stat blocks' drawings, shared by Pages and mini apps' Kit
// (src/minis/shelf/charts.tsx), so a chart looks the same in both.
// Recharts only, no zod: the mini apps' shelf bundles this file.
import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "../../kit/ui/utils";
import { resolveChart, SERIES_COLORS, type ChartSpec, type StatItem } from "../chart-draw";

/** A chart spec, drawn with Recharts in Pages' colors. Mini apps' <Chart> uses it too. */
export function ChartFigure({ spec: input }: { spec: ChartSpec }) {
  const { spec: chart, x, series } = resolveChart(input);
  const axis = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false } as const;
  const tooltip = (
    <Tooltip
      contentStyle={{ background: "var(--popover, #111)", border: "1px solid var(--border, #333)", borderRadius: 8, fontSize: 12 }}
      formatter={(value) => `${value}${chart.unit ?? ""}`}
    />
  );
  const common = { data: chart.data, margin: { top: 8, right: 8, bottom: 0, left: -16 } };
  let body: ReactNode;
  if (chart.type === "pie") {
    const key = series[0] ?? "value";
    body = (
      <PieChart>
        <Pie data={chart.data} dataKey={key} nameKey={x} innerRadius="45%" outerRadius="80%" paddingAngle={2} isAnimationActive={false}>
          {chart.data.map((_, index) => (
            <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
          ))}
        </Pie>
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  } else {
    const Chart = chart.type === "line" ? LineChart : chart.type === "area" ? AreaChart : BarChart;
    body = (
      <Chart {...common}>
        <CartesianGrid vertical={false} strokeOpacity={0.12} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} />
        {tooltip}
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((key, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length]!;
          const stack = chart.stacked ? "stack" : undefined;
          if (chart.type === "line") return <Line key={key} dataKey={key} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />;
          if (chart.type === "area")
            return <Area key={key} dataKey={key} stroke={color} fill={color} fillOpacity={0.18} stackId={stack} isAnimationActive={false} />;
          return <Bar key={key} dataKey={key} fill={color} radius={[3, 3, 0, 0]} stackId={stack} isAnimationActive={false} />;
        })}
      </Chart>
    );
  }
  return (
    <figure className="m-0 text-muted-foreground">
      {chart.title ? <figcaption className="mb-2 text-sm font-medium text-foreground">{chart.title}</figcaption> : null}
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {body as never}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function StatsView({ items }: { items: StatItem[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr))" }}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0 rounded-md bg-background/60 px-3 py-2">
          <div className="truncate text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="truncate text-xl font-semibold tabular-nums text-foreground">{item.value}</span>
            {item.delta ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  item.trend === "up" ? "text-emerald-500" : item.trend === "down" ? "text-red-500" : "text-muted-foreground",
                )}
              >
                {item.delta}
              </span>
            ) : null}
          </div>
          {item.caption ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.caption}</div> : null}
        </div>
      ))}
    </div>
  );
}

