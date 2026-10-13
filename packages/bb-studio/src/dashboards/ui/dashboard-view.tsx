// One dashboard: Studio's item header over a responsive grid of widgets.
// View mode shows the widgets; Edit mode lets the user drag and resize them,
// add widgets from the picker, and open each one's settings.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout, type ResponsiveLayouts } from "react-grid-layout";
import { toast } from "sonner";
import { BAR_BUTTON, BarTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, ICON_BUTTON, Icon, ItemHeader, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { ago, BREAKPOINTS, COLS, dashboardHref, GRID_MARGIN, ROW_HEIGHT, WIDGET_TYPES, WIDGETS, type DashboardView, type DataView, type Layouts, type Op, type VersionView, type WidgetTypeView, type WidgetView } from "../shared";
import type { WidgetTheme } from "./custom-frame";
import { sampleOp } from "./samples";
import { ApprovalDialog } from "./approval-dialog";
import { ApprovalCard, SettingsSheet } from "./settings-sheet";
import { useDashboard } from "./use-dashboard";
import { Empty, WidgetBody } from "./widgets";

/** The page in Studio: header, toolbar, grid. */
export function DashboardPage({ dashboardId, backLabel, onBack }: { dashboardId: string; backLabel: string; onBack(replace?: boolean): void }) {
  const state = useDashboard(dashboardId);
  const { dashboard } = state;
  useEffect(() => {
    if (dashboard !== null) return;
    toast.info("This dashboard was deleted.");
    onBack(true);
  }, [dashboard, onBack]);
  const name = dashboard?.name.trim() || "Untitled dashboard";
  const item = { title: name, href: dashboardHref(dashboardId) };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        thread={item}
        item={item}
        backLabel={backLabel}
        onBack={() => onBack()}
        leading={<BarTitle key={`${dashboardId}:${name}`} title={dashboard?.name ?? ""} label="Dashboard name" placeholder="Untitled dashboard" disabled={!dashboard} onRename={state.rename} />}
      />
      {dashboard ? <DashboardBoard dashboard={dashboard} state={state} /> : null}
    </div>
  );
}

type DashboardState = ReturnType<typeof useDashboard>;

/** Re-renders every 30 s, for "updated 2m ago". */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useDark(): boolean {
  const read = () => typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** BB's theme as a custom widget sees it. */
function useWidgetTheme(): WidgetTheme {
  const dark = useDark();
  return useMemo(() => {
    const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
    return {
      mode: dark ? "dark" : "light",
      colors: {
        foreground: read("--foreground", dark ? "#f4f4f5" : "#18181b"),
        background: read("--background", dark ? "#09090b" : "#ffffff"),
        muted: read("--muted-foreground", dark ? "#a1a1aa" : "#71717a"),
        border: read("--border", dark ? "#27272a" : "#e4e4e7"),
        accent: read("--primary", "#6366f1"),
        series: ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#a855f7", "#ef4444"],
      },
    };
  }, [dark]);
}

export function DashboardBoard({ dashboard, state }: { dashboard: DashboardView; state: DashboardState }) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [approvalFor, setApprovalFor] = useState<string | null>(null);
  const [library, setLibrary] = useState<WidgetTypeView[]>([]);
  const now = useMinuteClock();
  const theme = useWidgetTheme();
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });
  const [layouts, setLayouts] = useState<Layouts>(dashboard.layouts);
  const latest = useRef<Layouts>(dashboard.layouts);
  const dragging = useRef(false);
  // The server's layout wins unless the user is mid-drag.
  useEffect(() => {
    if (dragging.current) return;
    latest.current = dashboard.layouts;
    setLayouts(dashboard.layouts);
  }, [dashboard.layouts]);
  useEffect(() => {
    if (!picking && !settingsFor) return;
    void state.rpc.call("dashboards.widgetTypes", null).then(({ types }) => setLibrary(types as WidgetTypeView[])).catch(() => {});
  }, [picking, settingsFor, state.rpc]);

  const data = useMemo(() => new Map(dashboard.data.map((each) => [each.widgetId, each])), [dashboard.data]);
  const allTypes = useMemo(() => [...dashboard.widgetTypes, ...library.filter((type) => !dashboard.widgetTypes.some((each) => each.id === type.id))], [dashboard.widgetTypes, library]);
  const settingsWidget = settingsFor ? dashboard.widgets.find((widget) => widget.id === settingsFor) : undefined;
  const approvalWidget = approvalFor ? dashboard.widgets.find((widget) => widget.id === approvalFor && widget.source.kind === "script") : undefined;

  const save = useCallback(() => {
    dragging.current = false;
    // onLayoutChange runs after the drop; save once it has.
    setTimeout(() => void state.saveLayout(latest.current), 0);
  }, [state]);

  const add = async (op: Op) => {
    setPicking(false);
    const next = await state.edit([op]);
    const added = next?.widgets.find((widget) => !dashboard.widgets.some((each) => each.id === widget.id));
    if (added) setSettingsFor(added.id);
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-3 py-1.5" role="toolbar" aria-label="Dashboard">
      <button type="button" aria-pressed={editing} className={BAR_BUTTON} onClick={() => { setEditing((on) => !on); setPicking(false); }}>
        <Icon name={editing ? "Check" : "Edit"} /> {editing ? "Done" : "Edit"}
      </button>
      {editing ? <button type="button" className={BAR_BUTTON} aria-expanded={picking} onClick={() => setPicking((on) => !on)}><Icon name="Plus" /> Add widget</button> : null}
      <span className="flex-1" />
      <button type="button" aria-label="Refresh data" title="Refresh data" className={ICON_BUTTON} onClick={() => void state.refresh()}><Icon name="ArrowReloadHorizontal" /></button>
      <History dashboard={dashboard} state={state} />
    </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {toolbar}
      {picking ? <WidgetPicker library={library} onPick={(op) => void add(op)} onClose={() => setPicking(false)} /> : null}
      <div className="min-h-0 flex-1 overflow-auto" data-dashboard-grid data-editing={editing || undefined}>
        <div ref={containerRef} className="dashboard-grid min-h-full p-1">
          {!dashboard.widgets.length ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
              <p>No widgets yet. Add stats, charts, tables and feeds, or ask an agent to build this dashboard.</p>
              <button type="button" className={BAR_BUTTON} onClick={() => { setEditing(true); setPicking(true); }}><Icon name="Plus" /> Add widget</button>
            </div>
          ) : mounted ? (
            <ResponsiveGridLayout
              width={width}
              breakpoints={BREAKPOINTS}
              cols={COLS}
              layouts={layouts as ResponsiveLayouts}
              rowHeight={ROW_HEIGHT}
              margin={[GRID_MARGIN, GRID_MARGIN]}
              containerPadding={[GRID_MARGIN, GRID_MARGIN]}
              dragConfig={{ enabled: editing, handle: ".dashboard-drag", cancel: ".dashboard-no-drag" }}
              resizeConfig={{ enabled: editing, handles: ["se"] }}
              onLayoutChange={(_layout: Layout, all: ResponsiveLayouts) => {
                latest.current = { lg: (all.lg ?? latest.current.lg).map(pick), md: (all.md ?? latest.current.md).map(pick), sm: (all.sm ?? latest.current.sm).map(pick) };
              }}
              onDragStart={() => { dragging.current = true; }}
              onResizeStart={() => { dragging.current = true; }}
              onDragStop={save}
              onResizeStop={save}
            >
              {dashboard.widgets.map((widget) => (
                <div key={widget.id} data-widget-id={widget.id}>
                  <Tile
                    widget={widget}
                    data={data.get(widget.id)}
                    editing={editing}
                    now={now}
                    theme={theme}
                    types={allTypes}
                    size={sizeOf(layouts, widget.id, width)}
                    onSettings={() => setSettingsFor(widget.id)}
                    onRemove={() => void state.edit([{ op: "remove", widgetId: widget.id }])}
                    onRefresh={() => void state.refresh(widget.id)}
                    onReview={() => setApprovalFor(widget.id)}
                  />
                </div>
              ))}
            </ResponsiveGridLayout>
          ) : null}
        </div>
      </div>
      {settingsWidget ? (
        <SettingsSheet
          key={settingsWidget.id}
          widget={settingsWidget}
          library={allTypes}
          onClose={() => setSettingsFor(null)}
          onSave={async (op) => Boolean(await state.edit([op]))}
          onReview={() => setApprovalFor(settingsWidget.id)}
          onRevoke={() => void state.revoke(settingsWidget.id)}
        />
      ) : null}
      {approvalWidget ? (
        <ApprovalDialog
          key={`${approvalWidget.id}:${approvalWidget.script?.sha256}`}
          dashboardId={dashboard.id}
          widget={approvalWidget}
          rpc={state.rpc}
          onClose={() => setApprovalFor(null)}
          onApproved={() => void state.load()}
        />
      ) : null}
    </div>
  );
}

const pick = (item: { i: string; x: number; y: number; w: number; h: number }) => ({ i: item.i, x: item.x, y: item.y, w: item.w, h: item.h });

/** A tile's body size in pixels, for charts and custom widgets. */
function sizeOf(layouts: Layouts, id: string, width: number): { width: number; height: number } {
  const breakpoint = width >= BREAKPOINTS.lg ? "lg" : width >= BREAKPOINTS.md ? "md" : "sm";
  const item = layouts[breakpoint].find((each) => each.i === id);
  const cols = COLS[breakpoint];
  const colWidth = (width - GRID_MARGIN * (cols + 1)) / cols;
  const w = item?.w ?? 3;
  const h = item?.h ?? 3;
  return { width: Math.max(0, Math.round(colWidth * w + GRID_MARGIN * (w - 1))), height: Math.max(0, Math.round(ROW_HEIGHT * h + GRID_MARGIN * (h - 1)) - 34) };
}

/** "Updated 2m ago", or what went wrong. */
export function Freshness({ data, now }: { data: DataView | undefined; now: number }) {
  if (!data || data.status === "none" || data.status === "static") return null;
  if (data.status === "error") {
    return (
      <span className="flex min-w-0 items-center gap-1 text-red-600 dark:text-red-400" title={data.error ?? undefined}>
        <Icon name="AlertCircle" className="size-3 shrink-0" />
        <span className="truncate">{data.fetchedAt ? `Failed ${data.errorAt ? ago(data.errorAt, now) : ""}; showing ${ago(data.fetchedAt, now)}` : "Couldn't load"}</span>
      </span>
    );
  }
  if (data.status === "approval") return <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Icon name="Lock" className="size-3" /> Needs approval</span>;
  if (data.status === "pending") return <span>{data.error ? "Couldn't load" : "Waiting for data"}</span>;
  return <span title={data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : undefined}>Updated {data.fetchedAt ? ago(data.fetchedAt, now) : ""}</span>;
}

export function Tile({ widget, data, editing, now, theme, types, size, onSettings, onRemove, onRefresh, onReview }: {
  widget: WidgetView;
  data: DataView | undefined;
  editing: boolean;
  now: number;
  theme: WidgetTheme;
  types: readonly WidgetTypeView[];
  size: { width: number; height: number };
  onSettings(): void;
  onRemove(): void;
  onRefresh(): void;
  /** Opens the approval dialog for a script widget. */
  onReview(): void;
}) {
  const info = WIDGETS[widget.type];
  const label = widget.title ?? (widget.type === "stat" && typeof widget.options.label === "string" ? widget.options.label : null);
  const fetchable = widget.source.kind === "url" || (widget.source.kind === "script" && widget.script?.approved);
  let body: ReactNode;
  if (data?.status === "approval" && data.value === null) {
    body = <ApprovalCard compact command={widget.source.command ?? ""} onReview={onReview} />;
  } else if (data?.status === "error" && data.value === null) {
    body = <Empty><span className="text-red-600 dark:text-red-400" role="alert">{data.error}</span></Empty>;
  } else if (data?.status === "pending" && info.usesData) {
    body = <Empty>{widget.source.kind === "push" ? "No data yet. An agent sends it with widget_set_data." : "Loading…"}</Empty>;
  } else {
    body = <WidgetBody widget={widget} value={data?.value ?? null} width={size.width} height={size.height} theme={theme} types={types} />;
  }
  return (
    <section className={cn("dashboard-tile group flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground", editing && "ring-1 ring-border")} aria-label={label ?? info.label} data-widget-type={widget.type}>
      {label || editing ? (
        <header className={cn("flex h-8 shrink-0 items-center gap-1 px-2.5", editing && "dashboard-drag cursor-move")}>
          {editing ? <Icon name="DragDropVertical" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{label ?? info.label}</h3>
          {editing ? (
            <span className="dashboard-no-drag flex items-center">
              <button type="button" aria-label={`Settings for ${label ?? info.label}`} title="Settings" className={ICON_BUTTON} onClick={onSettings}><Icon name="SlidersHorizontal" /></button>
              <button type="button" aria-label={`Remove ${label ?? info.label}`} title="Remove" className={ICON_BUTTON} onClick={onRemove}><Icon name="Trash2" /></button>
            </span>
          ) : fetchable ? (
            <button type="button" aria-label={`Refresh ${label ?? info.label}`} title="Refresh" className={cn(ICON_BUTTON, "size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100")} onClick={onRefresh}><Icon name="ArrowReloadHorizontal" className="size-3.5" /></button>
          ) : null}
        </header>
      ) : null}
      <div className="dashboard-no-drag relative min-h-0 flex-1">{body}</div>
      {data && data.status !== "none" && data.status !== "static" ? (
        <footer className="flex h-6 shrink-0 items-center px-2.5 text-[11px] text-muted-foreground" aria-live="polite">
          <Freshness data={data} now={now} />
        </footer>
      ) : null}
    </section>
  );
}

export function WidgetPicker({ library, onPick, onClose }: { library: readonly WidgetTypeView[]; onPick(op: Op): void; onClose(): void }) {
  return (
    <div role="dialog" aria-label="Add a widget" className="border-b border-border bg-background px-3 py-3">
      <div className="mb-2 flex items-center">
        <h2 className="flex-1 text-sm font-semibold">Add a widget</h2>
        <button type="button" aria-label="Close" title="Close" className={ICON_BUTTON} onClick={onClose}><Icon name="X" /></button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}>
        {WIDGET_TYPES.map((type) => (
          <button key={type} type="button" className="flex items-start gap-2 rounded-md border border-border p-2 text-left hover:bg-state-hover" onClick={() => onPick(sampleOp(type))}>
            <Icon name={WIDGETS[type].icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{WIDGETS[type].label}</span>
              <span className="block text-xs text-muted-foreground">{WIDGETS[type].description}</span>
            </span>
          </button>
        ))}
      </div>
      {library.length ? (
        <>
          <h3 className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your library</h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}>
            {library.map((type) => (
              <button key={type.id} type="button" className="flex items-start gap-2 rounded-md border border-border p-2 text-left hover:bg-state-hover" onClick={() => onPick({ op: "add", type: "custom", customType: type.id, title: type.name, ...(type.sampleData !== null ? { source: { kind: "static", data: type.sampleData } } : {}) })}>
                <Icon name="Code" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{type.name}</span>
                  {type.description ? <span className="line-clamp-2 block text-xs text-muted-foreground">{type.description}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function History({ dashboard, state }: { dashboard: DashboardView; state: DashboardState }) {
  const [versions, setVersions] = useState<VersionView[] | null>(null);
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void state.rpc.call("dashboards.versions", { id: dashboard.id }).then(({ versions: list }) => setVersions(list)).catch((error) => toast.error(errorMessage(error))); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Version history" title="Version history" className={ICON_BUTTON}><Icon name="Clock" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-auto">
        <DropdownMenuLabel>Earlier versions</DropdownMenuLabel>
        {versions === null ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          : !versions.length ? <DropdownMenuItem disabled>No earlier versions yet.</DropdownMenuItem>
            : versions.map((version) => (
              <DropdownMenuItem key={version.id} onSelect={() => {
                if (!window.confirm(`Restore the dashboard as it was ${ago(version.createdAt)}? The current one is kept in history.`)) return;
                void state.rpc.call("dashboards.restoreVersion", { id: dashboard.id, versionId: version.id }).then(({ dashboard: next }) => state.apply(next as DashboardView)).catch((error) => toast.error(errorMessage(error)));
              }}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{version.label}</span>
                  <span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.actor === "agent" ? "Agent" : "You"} · {version.widgetCount} widgets</span>
                </span>
              </DropdownMenuItem>
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
