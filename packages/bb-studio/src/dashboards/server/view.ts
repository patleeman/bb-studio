// A dashboard as clients and agents see it: the view the app renders, and a
// readable summary for agent tools, mentions and search.
import { ago, dashboardHref, WIDGETS, type DashboardMeta, type DashboardView, type DataView, type Widget, type WidgetTypeView } from "../shared";
import { scriptHash } from "./sources";
import { isApproved } from "./refresh";
import type { DashboardRow, DashboardStore, DataRow, TypeRow } from "./store";

export function displayName(row: Pick<DashboardRow, "name">): string {
  return row.name.trim() || "Untitled dashboard";
}

export function toMeta(row: DashboardRow, widgetCount: number): DashboardMeta {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    widgetCount,
    archived: row.archived_at !== null,
  };
}

const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function typeView(row: TypeRow): WidgetTypeView {
  const options = parse(row.default_options);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    html: row.html,
    defaultOptions: options && typeof options === "object" && !Array.isArray(options) ? (options as Record<string, unknown>) : {},
    sampleData: parse(row.sample_data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A widget's data as the app shows it. */
export function dataView(store: DashboardStore, dashboardId: string, widget: Widget, row: DataRow | null): DataView {
  const base = { widgetId: widget.id, value: null, fetchedAt: null, error: null, errorAt: null };
  const source = widget.source;
  if (source.kind === "none") return { ...base, status: "none" };
  if (source.kind === "static") return { ...base, value: source.data ?? null, status: "static" };
  const value = row?.fetched_at ? parse(row.value) : null;
  const fetched = { ...base, value, fetchedAt: row?.fetched_at ?? null, error: row?.error ?? null, errorAt: row?.error_at ?? null };
  if (source.kind === "script" && !isApproved(store, dashboardId, widget)) return { ...fetched, status: "approval" };
  if (row?.error && (row.error_at ?? 0) >= (row.fetched_at ?? 0)) return { ...fetched, status: "error" };
  if (row?.fetched_at) return { ...fetched, status: "ok" };
  return { ...fetched, status: "pending" };
}

export function buildView(store: DashboardStore, row: DashboardRow): DashboardView {
  const doc = store.doc(row.id);
  const rows = new Map(store.data(row.id).map((each) => [each.widget_id, each]));
  const typeIds = new Set(doc.widgets.flatMap((widget) => (widget.type === "custom" && widget.customType ? [widget.customType] : [])));
  return {
    ...toMeta(row, doc.widgets.length),
    widgets: doc.widgets.map((widget) => ({
      ...widget,
      script: widget.source.kind === "script" ? { sha256: scriptHash(widget.source), approved: isApproved(store, row.id, widget) } : null,
    })),
    layouts: doc.layouts,
    data: doc.widgets.map((widget) => dataView(store, row.id, widget, rows.get(widget.id) ?? null)),
    widgetTypes: [...typeIds].flatMap((typeId) => { const type = store.type(typeId); return type ? [typeView(type)] : []; }),
  };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function describeSource(widget: Widget): string {
  const source = widget.source;
  switch (source.kind) {
    case "none": return "no data source";
    case "static": return "static data";
    case "push": return "push (widget_set_data)";
    case "url": return `url ${source.url} every ${source.intervalSec}s${source.select ? `, select ${source.select}` : ""}`;
    case "script": return `script \`${clip(source.command ?? "", 120)}\` every ${source.intervalSec}s${source.select ? `, select ${source.select}` : ""}`;
  }
}

function describeData(data: DataView, now: number): string {
  const value = data.value === null ? "" : clip(JSON.stringify(data.value), 160);
  switch (data.status) {
    case "none": return "";
    case "static": return `value ${value}`;
    case "approval": return `waiting for the user to approve the command in the dashboard${value ? `; last value ${value}` : ""}`;
    case "pending": return data.error ? `failed: ${data.error}` : "no data yet";
    case "error": return `last attempt failed ${data.errorAt ? ago(data.errorAt, now) : ""}: ${clip(data.error ?? "", 200)}${value ? `; last good value ${value} (${ago(data.fetchedAt ?? 0, now)})` : ""}`;
    case "ok": return `value ${value} (updated ${ago(data.fetchedAt ?? 0, now)})`;
  }
}

/** What dashboard_read and an @dashboard mention give the agent: readable lines plus ids. */
export function summary(store: DashboardStore, row: DashboardRow, now = Date.now()): string {
  const view = buildView(store, row);
  const name = displayName(row);
  const at = new Map(view.layouts.lg.map((item) => [item.i, item]));
  const lines = [
    `Dashboard "${name}" (id ${row.id}), ${view.widgets.length} widget(s), updated ${new Date(row.updated_at).toISOString()}.`,
    `Link to it as [${name.replace(/[[\]]/g, "")}](${dashboardHref(row.id)}).`,
  ];
  if (!view.widgets.length) lines.push("No widgets yet. Add some with dashboard_edit (op add).");
  else {
    lines.push("Widgets in grid order (lg grid: 12 columns; x,y then w×h):");
    view.widgets.forEach((widget, index) => {
      const place = at.get(widget.id);
      const data = describeData(view.data[index]!, now);
      const custom = widget.type === "custom" ? (widget.customType ? ` library type ${widget.customType}` : " own HTML") : "";
      lines.push(`- ${widget.id} ${widget.type}${custom}${widget.title ? ` "${widget.title}"` : ""}${place ? ` at ${place.x},${place.y} ${place.w}×${place.h}` : ""}; ${describeSource(widget)}${data ? `; ${data}` : ""}`);
    });
  }
  // Options and sources as JSON, for edits; big static data and HTML are left out.
  const compact = view.widgets.map((widget) => ({
    id: widget.id,
    type: widget.type,
    title: widget.title,
    options: widget.options,
    source: widget.source.kind === "static" && JSON.stringify(widget.source.data ?? null).length > 2000 ? { kind: "static", data: "(over 2 KB, left out)" } : widget.source,
    ...(widget.customType ? { customType: widget.customType } : {}),
    ...(widget.html ? { html: widget.html.length > 2000 ? `(${widget.html.length} characters of HTML, left out)` : widget.html } : {}),
  }));
  const json = JSON.stringify(compact);
  lines.push(json.length <= 40_000 ? `Widgets JSON: ${json}` : `Widgets JSON is ${json.length} characters; ask for one widget at a time.`);
  return lines.join("\n");
}

/** Words on a dashboard, for search and studio_read: its name, widget titles and notes. */
export function dashboardText(store: DashboardStore, row: DashboardRow): string {
  const doc = store.doc(row.id);
  const parts = [displayName(row)];
  for (const widget of doc.widgets) {
    if (widget.title) parts.push(widget.title);
    if (widget.type === "note" && typeof widget.options.markdown === "string") parts.push(widget.options.markdown);
    if (typeof widget.options.label === "string") parts.push(widget.options.label);
  }
  return parts.join("\n");
}

export function widgetLabel(widget: Widget): string {
  return widget.title || WIDGETS[widget.type].label;
}
