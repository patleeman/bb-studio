// One dashboard: Studio's item header over a responsive grid of widgets.
// View mode shows the widgets; Edit mode lets the user drag and resize them,
// add widgets from the picker, and open each one's settings.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout, type ResponsiveLayouts } from "react-grid-layout";
import { toast } from "sonner";
import { BAR_BUTTON, BarTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ICON_BUTTON, Icon, ItemHeader, OUTLINE_BUTTON, PRIMARY_BUTTON, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { ago, breakpointFor, BREAKPOINTS, COLS, dashboardHref, GRID_MARGIN, ROW_HEIGHT, WIDGETS, type DashboardView, type DataView, type Layouts, type Op, type VersionView, type WidgetType, type WidgetTypeView, type WidgetView } from "../shared";
import type { WidgetTheme } from "./custom-frame";
import { viewLayouts } from "../ops";
import { sampleOp } from "./samples";
import { ApprovalDialog } from "./approval-dialog";
import { ApprovalCard, SettingsSheet } from "./settings-sheet";
import { useDashboard } from "./use-dashboard";
import { Empty, WidgetBody } from "./widgets";

/** The page in Studio: header, toolbar, grid. */
export function DashboardPage({ dashboardId, backLabel, onBack, onGone }: { dashboardId: string; backLabel: string; onBack(replace?: boolean): void; /** Deleted while in a background tab. */ onGone?(): void }) {
  const state = useDashboard(dashboardId);
  const { dashboard } = state;
  useEffect(() => {
    if (dashboard !== null) return;
    // Only the page on screen goes back; one in a background tab just closes.
    if (window.location.pathname !== dashboardHref(dashboardId)) return onGone?.();
    toast.info("This dashboard was deleted.");
    onBack(true);
  }, [dashboard, dashboardId, onBack, onGone]);
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

export function DashboardBoard({ dashboard, state, leading }: {
  dashboard: DashboardView;
  state: DashboardState;
  /** Before Edit in the toolbar: the thread tab's back button and name. */
  leading?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [approvalFor, setApprovalFor] = useState<string | null>(null);
  const [library, setLibrary] = useState<WidgetTypeView[]>([]);
  const now = useMinuteClock();
  const theme = useWidgetTheme();
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });
  const shown = useMemo(() => viewLayouts(dashboard.layouts), [dashboard.layouts]);
  const [layouts, setLayouts] = useState<Layouts>(shown);
  const latest = useRef<Layouts>(shown);
  const dragging = useRef(false);
  // The server's layout wins unless the user is mid-drag.
  useEffect(() => {
    if (dragging.current) return;
    latest.current = shown;
    setLayouts(shown);
  }, [shown]);
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
      {leading}
      <button type="button" aria-pressed={editing} className={BAR_BUTTON} onClick={() => { setEditing((on) => !on); setPicking(false); }}>
        <Icon name={editing ? "Check" : "Edit"} /> {editing ? "Done" : "Edit"}
      </button>
      {editing ? <button type="button" className={BAR_BUTTON} aria-expanded={picking} onClick={() => setPicking((on) => !on)}><Icon name="Plus" /> Add widget</button> : null}
      {editing && dashboard.widgets.length ? <span className="ml-2 hidden truncate text-xs text-muted-foreground md:inline">Drag a tile by its header; resize it from the corner.</span> : null}
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
            picking ? null : (
              <div data-dashboard-empty>
                <EmptyState
                  icon="GridView"
                  title="No widgets yet"
                  actions={<button type="button" className={PRIMARY_BUTTON} onClick={() => { setEditing(true); setPicking(true); }}><Icon name="Plus" /> Add widget</button>}
                >
                  Add stat tiles, charts, tables and feeds. Or ask an agent to build it: mention this dashboard in a thread and say what to track.
                </EmptyState>
              </div>
            )
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
                    onRevoke={() => void state.revoke(widget.id)}
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
  const breakpoint = breakpointFor(width);
  const item = layouts[breakpoint].find((each) => each.i === id);
  const cols = COLS[breakpoint];
  const colWidth = (width - GRID_MARGIN * (cols + 1)) / cols;
  const w = item?.w ?? 3;
  const h = item?.h ?? 3;
  // The body sits inside the 1 px border, under the 36 px header.
  return { width: Math.max(0, Math.round(colWidth * w + GRID_MARGIN * (w - 1)) - 2), height: Math.max(0, Math.round(ROW_HEIGHT * h + GRID_MARGIN * (h - 1)) - 38) };
}

/** A tile's status in its header: "2m ago", what went wrong, or that it waits for approval. */
export function Freshness({ data, now }: { data: DataView | undefined; now: number }) {
  if (!data || data.status === "none" || data.status === "static") return null;
  if (data.status === "error") {
    const detail = data.fetchedAt ? `Last attempt failed ${data.errorAt ? ago(data.errorAt, now) : ""}: ${data.error ?? ""}. Showing data from ${ago(data.fetchedAt, now)}.` : data.error ?? undefined;
    return (
      <span className="flex min-w-0 items-center gap-1 text-red-600 dark:text-red-400" title={detail} data-tile-status="error">
        <Icon name="AlertCircle" className="size-3 shrink-0" />
        <span className="truncate">{data.fetchedAt ? `Failed · ${ago(data.fetchedAt, now)}` : "Failed"}</span>
      </span>
    );
  }
  if (data.status === "approval") return <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400" data-tile-status="approval"><Icon name="Lock" className="size-3" /> Needs approval</span>;
  // The body says what it's waiting for.
  if (data.status === "pending") return null;
  return <span className="tabular-nums" title={data.fetchedAt ? `Updated ${new Date(data.fetchedAt).toLocaleString()}` : undefined} data-tile-status="ok">{data.fetchedAt ? ago(data.fetchedAt, now) : ""}</span>;
}

/** The tile's ⋯ menu in view mode: refresh, settings, the script's approval, remove. */
function TileMenu({ name, widget, fetchable, onRefresh, onSettings, onReview, onRevoke, onRemove }: {
  name: string;
  widget: WidgetView;
  fetchable: boolean;
  onRefresh(): void;
  onSettings(): void;
  onReview(): void;
  onRevoke(): void;
  onRemove(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${name}`} title="More" className={cn(ICON_BUTTON, "size-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100")}>
          <Icon name="MoreHorizontal" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {fetchable ? <DropdownMenuItem onSelect={onRefresh}><Icon name="ArrowReloadHorizontal" /> Refresh</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onSettings}><Icon name="SlidersHorizontal" /> Settings…</DropdownMenuItem>
        {widget.script && !widget.script.approved ? <DropdownMenuItem onSelect={onReview}><Icon name="Lock" /> Review command…</DropdownMenuItem> : null}
        {widget.script?.approved ? <DropdownMenuItem onSelect={onRevoke}><Icon name="Unavailable" /> Revoke approval</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}><Icon name="Trash2" /> Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Tile({ widget, data, editing, now, theme, types, size, onSettings, onRemove, onRefresh, onReview, onRevoke }: {
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
  onRevoke?(): void;
}) {
  const info = WIDGETS[widget.type];
  const label = widget.title ?? (widget.type === "stat" && typeof widget.options.label === "string" ? widget.options.label : null);
  const name = label ?? info.label;
  const fetchable = widget.source.kind === "url" || (widget.source.kind === "script" && Boolean(widget.script?.approved));
  let body: ReactNode;
  if (data?.status === "approval" && data.value === null) {
    body = <ApprovalCard compact command={widget.source.command ?? ""} onReview={onReview} />;
  } else if (data?.status === "error" && data.value === null) {
    body = (
      <Empty icon="AlertCircle" tone="error" title="Couldn't load" action={fetchable ? <button type="button" className={cn(OUTLINE_BUTTON, "h-7 px-2.5 text-xs")} onClick={onRefresh}>Try again</button> : undefined}>
        <span role="alert" className="line-clamp-3 break-words">{data.error}</span>
      </Empty>
    );
  } else if (data?.status === "pending" && info.usesData) {
    body = widget.source.kind === "push"
      ? <Empty icon="Sent" title="No data yet">An agent sends it with <code className="font-mono text-[11px]">widget_set_data</code>.</Empty>
      : <Empty icon="Loading" spin title={widget.source.kind === "script" ? "Running the command…" : "Fetching…"} />;
  } else {
    body = <WidgetBody widget={widget} value={data?.value ?? null} width={size.width} height={size.height} theme={theme} types={types} />;
  }
  const menu = <TileMenu name={name} widget={widget} fetchable={fetchable} onRefresh={onRefresh} onSettings={onSettings} onReview={onReview} onRevoke={onRevoke ?? (() => {})} onRemove={onRemove} />;
  return (
    <section
      className={cn(
        "dashboard-tile group relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground",
        editing ? "border-dashed border-foreground/25 shadow-sm" : "border-border",
        data?.status === "error" && !editing && "border-red-500/30",
      )}
      aria-label={name}
      data-widget-type={widget.type}
    >
      {label || editing ? (
        <header className={cn("flex h-9 shrink-0 items-center gap-1.5 pl-3 pr-1.5", editing && "dashboard-drag cursor-grab active:cursor-grabbing")}>
          {editing ? <Icon name="DragDropVertical" className="-ml-1 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden /> : null}
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">{name}</h3>
          {editing ? (
            <span className="dashboard-no-drag flex items-center">
              <button type="button" aria-label={`Settings for ${name}`} title="Settings" className={cn(ICON_BUTTON, "size-6")} onClick={onSettings}><Icon name="SlidersHorizontal" className="size-3.5" /></button>
              <button type="button" aria-label={`Remove ${name}`} title="Remove" className={cn(ICON_BUTTON, "size-6 hover:text-destructive")} onClick={onRemove}><Icon name="Trash2" className="size-3.5" /></button>
            </span>
          ) : (
            <span className="dashboard-no-drag flex min-w-0 shrink items-center gap-1 text-[11px] text-muted-foreground" aria-live="polite">
              <Freshness data={data} now={now} />
              {menu}
            </span>
          )}
        </header>
      ) : (
        // Untitled tiles (a clock, a ticker) keep all their space; the menu floats.
        <span className="dashboard-no-drag absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md bg-card/90 text-[11px] text-muted-foreground">
          {data?.status === "error" || data?.status === "approval" ? <Freshness data={data} now={now} /> : null}
          {menu}
        </span>
      )}
      <div className="dashboard-no-drag relative min-h-0 flex-1">{body}</div>
    </section>
  );
}

const PICKER_GROUPS: { label: string; types: WidgetType[] }[] = [
  { label: "Numbers", types: ["stat", "progress"] },
  { label: "Charts", types: ["line", "bar", "area", "pie"] },
  { label: "Lists", types: ["table", "list", "ticker"] },
  { label: "Content", types: ["note", "embed", "image", "clock", "custom"] },
];

function PickerCard({ icon, label, description, onPick }: { icon: string; label: string; description?: string; onPick(): void }) {
  return (
    <button type="button" className="group/card flex items-start gap-2.5 rounded-lg border border-border bg-card p-2.5 text-left outline-none transition-colors hover:border-foreground/20 hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring" onClick={onPick}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover/card:text-foreground"><Icon name={icon} className="size-4" /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="line-clamp-2 block text-xs leading-snug text-muted-foreground">{description}</span> : null}
      </span>
    </button>
  );
}

export function WidgetPicker({ library, onPick, onClose }: { library: readonly WidgetTypeView[]; onPick(op: Op): void; onClose(): void }) {
  const grid = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]";
  return (
    <div role="dialog" aria-label="Add a widget" className="max-h-[55%] shrink-0 overflow-auto border-b border-border bg-background px-4 pb-4 pt-3" data-dashboard-picker>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Add a widget</h2>
        <span className="text-xs text-muted-foreground">Each starts with sample data; change it in its settings.</span>
        <button type="button" aria-label="Close" title="Close" className={ICON_BUTTON} onClick={onClose}><Icon name="X" /></button>
      </div>
      <div className="flex flex-col gap-3">
        {PICKER_GROUPS.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
            <div className={grid}>
              {group.types.map((type) => <PickerCard key={type} icon={WIDGETS[type].icon} label={WIDGETS[type].label} description={WIDGETS[type].description} onPick={() => onPick(sampleOp(type))} />)}
            </div>
          </section>
        ))}
        {library.length ? (
          <section aria-label="Your library">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your library</h3>
            <div className={grid}>
              {library.map((type) => (
                <PickerCard key={type.id} icon="Code" label={type.name} description={type.description || undefined} onPick={() => onPick({ op: "add", type: "custom", customType: type.id, title: type.name, ...(type.sampleData !== null ? { source: { kind: "static", data: type.sampleData } } : {}) })} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
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
