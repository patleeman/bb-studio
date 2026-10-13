// When widget data refreshes. URL and script widgets refresh on their
// interval (URLs at most every 60 s, scripts every 5 min) only while a client
// has the dashboard open, which the app reports with a heartbeat; otherwise
// every 30 minutes, so the last value stays recent. Push data is never polled.
// A script runs only while its exact command is approved.
import { errorMessage } from "@bb-studio/kit/format";
import { LIMITS, type Widget } from "../shared";
import { keepValue, scriptHash } from "./sources";
import type { DashboardStore, DataRow } from "./store";

export interface RefresherDeps {
  store: DashboardStore;
  /** Fetches and decodes a url source (JSON or a feed). */
  fetchUrl(source: Widget["source"]): Promise<unknown>;
  /** Runs an approved script source. */
  runScript(source: Widget["source"]): Promise<unknown>;
  /** New data or errors for these widgets. */
  changed(dashboardId: string, widgetIds: string[]): void;
  now?: () => number;
  /** Off (Setup → Kinds), nothing refreshes. */
  enabled?(): boolean;
  /** Fetches and scripts running at once. */
  concurrency?: number;
  log?(message: string): void;
}

export function isApproved(store: DashboardStore, dashboardId: string, widget: Widget): boolean {
  if (widget.source.kind !== "script") return false;
  return store.approval(dashboardId, widget.id)?.sha256 === scriptHash(widget.source);
}

export class Refresher {
  private readonly viewers = new Map<string, Map<string, number>>();
  private readonly running = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: RefresherDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** A client has the dashboard open (sent every ~30 s while it's visible). */
  view(dashboardId: string, clientId: string): void {
    let clients = this.viewers.get(dashboardId);
    if (!clients) this.viewers.set(dashboardId, (clients = new Map()));
    clients.set(clientId, this.now());
  }

  /** The client closed it. */
  leave(dashboardId: string, clientId: string): void {
    this.viewers.get(dashboardId)?.delete(clientId);
  }

  viewed(dashboardId: string): boolean {
    const clients = this.viewers.get(dashboardId);
    if (!clients) return false;
    const now = this.now();
    for (const [client, at] of clients) if (now - at > LIMITS.viewerMs) clients.delete(client);
    if (!clients.size) this.viewers.delete(dashboardId);
    return clients.size > 0;
  }

  /** How long a widget waits between refreshes: its interval while viewed, else the background period. */
  interval(widget: Widget, viewed: boolean): number | null {
    const source = widget.source;
    if (source.kind !== "url" && source.kind !== "script") return null;
    if (!viewed) return LIMITS.backgroundMs;
    const floor = source.kind === "url" ? LIMITS.urlMinIntervalSec : LIMITS.scriptMinIntervalSec;
    return Math.max(floor, source.intervalSec ?? floor) * 1000;
  }

  due(dashboardId: string, widget: Widget, row: DataRow | null, viewed: boolean): boolean {
    const interval = this.interval(widget, viewed);
    if (interval === null) return false;
    if (widget.source.kind === "script" && !isApproved(this.deps.store, dashboardId, widget)) return false;
    return this.now() - (row?.attempted_at ?? 0) >= interval;
  }

  /** Refreshes whatever is due on every dashboard. Studio calls it every 15 s. */
  async tick(only?: string): Promise<void> {
    const { store } = this.deps;
    const work: { dashboardId: string; widget: Widget }[] = [];
    const dashboards = only ? [only] : store.list().map((row) => row.id);
    for (const dashboardId of dashboards) {
      const viewed = this.viewed(dashboardId);
      const rows = new Map(store.data(dashboardId).map((row) => [row.widget_id, row]));
      for (const widget of store.doc(dashboardId).widgets) {
        if (this.due(dashboardId, widget, rows.get(widget.id) ?? null, viewed)) work.push({ dashboardId, widget });
      }
    }
    await this.run(work);
  }

  /**
   * Refreshes now, from the app's Refresh button: one widget or all of a
   * dashboard's url and approved script widgets, each at most every 10 s.
   * Returns the widgets refreshed.
   */
  async refreshNow(dashboardId: string, widgetId?: string): Promise<string[]> {
    const { store } = this.deps;
    const rows = new Map(store.data(dashboardId).map((row) => [row.widget_id, row]));
    const work = store.doc(dashboardId).widgets.filter((widget) => {
      if (widgetId && widget.id !== widgetId) return false;
      if (widget.source.kind !== "url" && widget.source.kind !== "script") return false;
      if (widget.source.kind === "script" && !isApproved(store, dashboardId, widget)) return false;
      return this.now() - (rows.get(widget.id)?.attempted_at ?? 0) >= LIMITS.manualMs;
    }).map((widget) => ({ dashboardId, widget }));
    await this.run(work);
    return work.map((each) => each.widget.id);
  }

  private async run(work: { dashboardId: string; widget: Widget }[]): Promise<void> {
    if (this.deps.enabled && !this.deps.enabled()) return;
    const queue = work.filter((each) => !this.running.has(`${each.dashboardId}:${each.widget.id}`));
    const touched = new Map<string, string[]>();
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await this.refreshOne(next.dashboardId, next.widget);
        touched.set(next.dashboardId, [...(touched.get(next.dashboardId) ?? []), next.widget.id]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency ?? 4, queue.length) }, worker));
    for (const [dashboardId, ids] of touched) this.deps.changed(dashboardId, ids);
  }

  private async refreshOne(dashboardId: string, widget: Widget): Promise<void> {
    const { store } = this.deps;
    const key = `${dashboardId}:${widget.id}`;
    this.running.add(key);
    // The attempt counts before it runs, so a failure isn't retried at once.
    store.markAttempt(dashboardId, widget.id, this.now());
    try {
      const raw = widget.source.kind === "url" ? await this.deps.fetchUrl(widget.source) : await this.deps.runScript(widget.source);
      // The widget may have changed or gone while this ran.
      const current = store.doc(dashboardId).widgets.find((each) => each.id === widget.id);
      if (!current || JSON.stringify(current.source) !== JSON.stringify(widget.source)) return;
      store.setValue(dashboardId, widget.id, keepValue(raw, widget.source.select), this.now());
    } catch (error) {
      const current = store.doc(dashboardId).widgets.find((each) => each.id === widget.id);
      if (!current || JSON.stringify(current.source) !== JSON.stringify(widget.source)) return;
      store.setError(dashboardId, widget.id, errorMessage(error), this.now());
      this.deps.log?.(`Dashboard ${dashboardId} widget ${widget.id}: ${errorMessage(error)}`);
    } finally {
      this.running.delete(key);
    }
  }
}
