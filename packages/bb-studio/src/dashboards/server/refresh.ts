// When widget data refreshes. URL and script widgets refresh on their
// interval (URLs at most every 60 s, scripts every 5 min) only while a client
// has the dashboard open, which the app reports with a heartbeat; otherwise
// every 30 minutes, so the last value stays recent. Push data is never polled.
// A script runs only while its exact command is approved.
import { errorMessage } from "../../kit/format";
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

/**
 * An approval belongs to the exact command and folder, not to one widget: once
 * the user approves it, every widget on that dashboard running the same
 * command (often with a different `select`) runs too. Another dashboard asks
 * again, and so does any change to the command.
 */
export function isApproved(store: DashboardStore, dashboardId: string, widget: Widget): boolean {
  if (widget.source.kind !== "script") return false;
  return store.commandApproved(dashboardId, scriptHash(widget.source));
}

type RefreshJob = {
  dashboardId: string;
  widget: Widget;
  pending: Widget | null;
  generation: number;
  invalidated: boolean;
  done: Promise<void>;
  resolve(): void;
};

export class Refresher {
  private readonly viewers = new Map<string, Map<string, number>>();
  private readonly jobs = new Map<string, RefreshJob>();
  private readonly queue: RefreshJob[] = [];
  private active = 0;
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

  /** Source edits invalidate even a command changed away and then back while it runs. */
  invalidate(dashboardId: string, widgetIds: string[]): void {
    for (const widgetId of widgetIds) {
      const job = this.jobs.get(`${dashboardId}:${widgetId}`);
      if (job) { job.generation++; job.pending = null; job.invalidated = true; }
    }
  }

  private async run(work: { dashboardId: string; widget: Widget }[]): Promise<void> {
    if (this.deps.enabled && !this.deps.enabled()) return;
    const waiting = work.map(({ dashboardId, widget }) => {
      const key = `${dashboardId}:${widget.id}`;
      const existing = this.jobs.get(key);
      if (existing) {
        if (JSON.stringify(existing.widget.source) !== JSON.stringify(widget.source) || existing.invalidated) {
          existing.invalidated = false;
          existing.widget = widget;
          existing.pending = widget;
          existing.generation++;
        }
        return existing.done;
      }
      let resolve!: () => void;
      const done = new Promise<void>((finish) => { resolve = finish; });
      const job: RefreshJob = { dashboardId, widget, pending: widget, generation: 0, invalidated: false, done, resolve };
      this.jobs.set(key, job);
      this.queue.push(job);
      return done;
    });
    this.drain();
    await Promise.all(waiting);
  }

  private drain(): void {
    while (this.active < (this.deps.concurrency ?? 4) && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.runJob(job);
    }
  }

  private async runJob(job: RefreshJob): Promise<void> {
    try {
      while (job.pending) {
        const widget = job.pending;
        const generation = job.generation;
        job.pending = null;
        await this.refreshOne(job.dashboardId, widget, () => job.generation === generation);
      }
    } catch (error) {
      this.deps.log?.(`Dashboard ${job.dashboardId} widget ${job.widget.id}: ${errorMessage(error)}`);
    } finally {
      this.jobs.delete(`${job.dashboardId}:${job.widget.id}`);
      this.active--;
      job.resolve();
      this.drain();
    }
  }

  private async refreshOne(dashboardId: string, widget: Widget, valid: () => boolean): Promise<void> {
    const { store } = this.deps;
    if (this.deps.enabled && !this.deps.enabled()) return;
    const current = store.doc(dashboardId).widgets.find((each) => each.id === widget.id);
    if (!valid() || !current || JSON.stringify(current.source) !== JSON.stringify(widget.source)) return;
    if (current.source.kind === "script" && !isApproved(store, dashboardId, current)) return;
    // runJob owns the reservation's finally, including storage failures here.
    store.markAttempt(dashboardId, widget.id, this.now());
    try {
      const raw = widget.source.kind === "url" ? await this.deps.fetchUrl(widget.source) : await this.deps.runScript(widget.source);
      // The widget may have changed or gone while this ran.
      const current = store.doc(dashboardId).widgets.find((each) => each.id === widget.id);
      if (!valid() || !current || JSON.stringify(current.source) !== JSON.stringify(widget.source)) return;
      store.setValue(dashboardId, widget.id, keepValue(raw, widget.source.select), this.now());
      this.deps.changed(dashboardId, [widget.id]);
    } catch (error) {
      const current = store.doc(dashboardId).widgets.find((each) => each.id === widget.id);
      if (!valid() || !current || JSON.stringify(current.source) !== JSON.stringify(widget.source)) return;
      store.setError(dashboardId, widget.id, errorMessage(error), this.now());
      this.deps.changed(dashboardId, [widget.id]);
      this.deps.log?.(`Dashboard ${dashboardId} widget ${widget.id}: ${errorMessage(error)}`);
    }
  }
}
