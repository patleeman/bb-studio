// Dashboards in Studio's SQLite database: the dashboards, their widgets and
// a layout per breakpoint, the custom widget library, each widget's last
// data, script approvals pinned by hash, and the last 20 versions of each
// dashboard.
import { scriptHash } from "./sources";
import { newId } from "../../kit/ids";
import type Database from "better-sqlite3";
import { BREAKPOINT_NAMES, EMPTY_LAYOUTS, jsonBytes, LIMITS, layoutItemSchema, sourceSchema, WIDGET_TYPES, type DashboardDoc, type Layouts, type Source, type Widget, type WidgetType } from "../shared";
import { z } from "zod";

/**
 * Historical dashboard schema; Studio freezes its own copy.
 * Append schema changes only at the END of MIGRATIONS in src/migrations.ts.
 */
export const DASHBOARD_TABLES =
  `CREATE TABLE dashboards (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT,
       archived_at INTEGER, template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE dashboard_widgets (
       dashboard_id TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
       type TEXT NOT NULL, title TEXT, options TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT '{"kind":"none"}',
       custom_type TEXT, html TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
       PRIMARY KEY (dashboard_id, id)
     );
   CREATE TABLE dashboard_layouts (
       dashboard_id TEXT NOT NULL, breakpoint TEXT NOT NULL, layout TEXT NOT NULL DEFAULT '[]',
       PRIMARY KEY (dashboard_id, breakpoint)
     );
   CREATE TABLE dashboard_widget_types (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', html TEXT NOT NULL,
       default_options TEXT NOT NULL DEFAULT '{}', sample_data TEXT,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
     );
   CREATE TABLE dashboard_data (
       dashboard_id TEXT NOT NULL, widget_id TEXT NOT NULL, value TEXT, fetched_at INTEGER,
       error TEXT, error_at INTEGER, attempted_at INTEGER,
       PRIMARY KEY (dashboard_id, widget_id)
     );
   CREATE TABLE dashboard_script_approvals (
       dashboard_id TEXT NOT NULL, widget_id TEXT NOT NULL, sha256 TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT,
       approved_at INTEGER NOT NULL,
       PRIMARY KEY (dashboard_id, widget_id)
     );
   CREATE TABLE dashboard_versions (
       id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id TEXT NOT NULL, created_at INTEGER NOT NULL,
       actor TEXT NOT NULL, label TEXT NOT NULL, doc TEXT NOT NULL
     );
   CREATE INDEX dashboard_versions_dashboard ON dashboard_versions (dashboard_id, id);`;

/**
 * Who proposed each script widget's command: the approval prompt names them.
 * Studio freezes this SQL in src/migrations.ts. Keyed by the
 * command's hash, so a later change by someone else replaces the row.
 */
export const DASHBOARD_PROPOSALS_TABLE =
  `CREATE TABLE dashboard_script_proposals (
       dashboard_id TEXT NOT NULL, widget_id TEXT NOT NULL, sha256 TEXT NOT NULL,
       actor TEXT NOT NULL, thread_id TEXT, proposed_at INTEGER NOT NULL,
       PRIMARY KEY (dashboard_id, widget_id)
     );`;

export type DashboardRow = {
  id: string;
  name: string;
  project_id: string | null;
  created_at: number;
  updated_at: number;
  /** "user" or "agent" */
  updated_by: string | null;
  archived_at: number | null;
  template: number;
};

type WidgetRow = {
  dashboard_id: string; id: string; position: number; type: string; title: string | null;
  options: string; source: string; custom_type: string | null; html: string | null;
  created_at: number; updated_at: number;
};

export type DataRow = {
  dashboard_id: string; widget_id: string; value: string | null; fetched_at: number | null;
  error: string | null; error_at: number | null; attempted_at: number | null;
};

export type ProposalRow = { dashboard_id: string; widget_id: string; sha256: string; actor: Actor; thread_id: string | null; proposed_at: number };

export type ApprovalRow = { dashboard_id: string; widget_id: string; sha256: string; command: string; cwd: string | null; approved_at: number };

export type TypeRow = {
  id: string; name: string; description: string; html: string; default_options: string; sample_data: string | null;
  created_at: number; updated_at: number; updated_by: string | null;
};

export type VersionRow = { id: number; dashboard_id: string; created_at: number; actor: string; label: string; doc: string };

/** Who made a change. The CLI counts as an agent. */
export type Actor = "user" | "agent";

const parseJson = <T>(text: string | null, fallback: T): T => {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const layoutArray = z.array(layoutItemSchema);

/** A stored version's document, read leniently: what doesn't parse is dropped. */
export function parseDoc(text: string): DashboardDoc & { name?: string } {
  const raw = parseJson<Record<string, unknown>>(text, {});
  const widgets: Widget[] = [];
  for (const each of Array.isArray(raw.widgets) ? raw.widgets : []) {
    const widget = each as Partial<Widget>;
    if (typeof widget.id !== "string" || !WIDGET_TYPES.includes(widget.type as WidgetType)) continue;
    const source = sourceSchema.safeParse(widget.source);
    widgets.push({
      id: widget.id,
      type: widget.type as WidgetType,
      title: typeof widget.title === "string" ? widget.title : null,
      options: widget.options && typeof widget.options === "object" && !Array.isArray(widget.options) ? widget.options : {},
      source: source.success ? source.data : { kind: "none" },
      customType: typeof widget.customType === "string" ? widget.customType : null,
      html: typeof widget.html === "string" ? widget.html : null,
    });
  }
  const layouts = { ...EMPTY_LAYOUTS } as Layouts;
  const rawLayouts = (raw.layouts ?? {}) as Record<string, unknown>;
  for (const breakpoint of BREAKPOINT_NAMES) {
    const parsed = layoutArray.safeParse(rawLayouts[breakpoint]);
    layouts[breakpoint] = parsed.success ? parsed.data : [];
  }
  return { widgets, layouts, ...(typeof raw.name === "string" ? { name: raw.name } : {}) };
}

/** Versions are kept when a change comes this long after the last one, or from someone else. */
const VERSION_GAP_MS = 60_000;

export class DashboardStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
    private readonly sourcesChanged?: (id: string, widgetIds: string[]) => void,
  ) {}

  get(id: string): DashboardRow | null {
    return (this.db.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as DashboardRow | undefined) ?? null;
  }

  list(options: { includeArchived?: boolean; limit?: number } = {}): DashboardRow[] {
    return this.db
      .prepare(`SELECT * FROM dashboards ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC LIMIT ?`)
      .all(options.limit ?? -1) as DashboardRow[];
  }

  widgetCount(id: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM dashboard_widgets WHERE dashboard_id = ?").get(id) as { n: number }).n;
  }

  create(input: { name: string; projectId?: string | null; by: Actor; doc?: DashboardDoc }): DashboardRow {
    const id = newId("dsh");
    const at = this.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO dashboards (id, name, project_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.name, input.projectId ?? null, at, at, input.by);
      this.replaceDoc(id, input.doc ?? { widgets: [], layouts: EMPTY_LAYOUTS }, at, input.by);
    })();
    return this.get(id)!;
  }

  doc(id: string): DashboardDoc {
    const rows = this.db.prepare("SELECT * FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY position").all(id) as WidgetRow[];
    const widgets: Widget[] = rows.map((row) => ({
      id: row.id,
      type: (WIDGET_TYPES.includes(row.type as WidgetType) ? row.type : "note") as WidgetType,
      title: row.title,
      options: parseJson<Record<string, unknown>>(row.options, {}),
      source: (() => { const parsed = sourceSchema.safeParse(parseJson(row.source, null)); return parsed.success ? parsed.data : ({ kind: "none" } as Source); })(),
      customType: row.custom_type,
      html: row.html,
    }));
    const layouts = { ...EMPTY_LAYOUTS } as Layouts;
    for (const row of this.db.prepare("SELECT breakpoint, layout FROM dashboard_layouts WHERE dashboard_id = ?").all(id) as { breakpoint: string; layout: string }[]) {
      if (!(BREAKPOINT_NAMES as readonly string[]).includes(row.breakpoint)) continue;
      const parsed = layoutArray.safeParse(parseJson(row.layout, []));
      layouts[row.breakpoint as keyof Layouts] = parsed.success ? parsed.data : [];
    }
    return { widgets, layouts };
  }

  /** Writes widgets and layouts as given (no version). */
  private replaceDoc(id: string, doc: DashboardDoc, at: number, by: Actor, threadId: string | null = null): void {
    const previous = new Map((this.db.prepare("SELECT * FROM dashboard_widgets WHERE dashboard_id = ?").all(id) as WidgetRow[]).map((row) => [row.id, row]));
    this.db.prepare("DELETE FROM dashboard_widgets WHERE dashboard_id = ?").run(id);
    const insert = this.db.prepare(`INSERT INTO dashboard_widgets (dashboard_id, id, position, type, title, options, source, custom_type, html, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const changedSources: string[] = [];
    doc.widgets.forEach((widget, position) => {
      const before = previous.get(widget.id);
      const options = JSON.stringify(widget.options);
      const source = JSON.stringify(widget.source);
      if (!before || before.source !== source) {
        changedSources.push(widget.id);
        this.clearData(id, widget.id);
        if (widget.source.kind === "script") this.propose(id, widget.id, scriptHash(widget.source), by, threadId);
      }
      const same = before && before.options === options && before.source === source && before.title === widget.title && before.type === widget.type && before.custom_type === widget.customType && before.html === widget.html;
      insert.run(id, widget.id, position, widget.type, widget.title, options, source, widget.customType, widget.html, before?.created_at ?? at, same ? before.updated_at : at);
    });
    const upsert = this.db.prepare("INSERT INTO dashboard_layouts (dashboard_id, breakpoint, layout) VALUES (?, ?, ?) ON CONFLICT(dashboard_id, breakpoint) DO UPDATE SET layout = excluded.layout");
    for (const breakpoint of BREAKPOINT_NAMES) upsert.run(id, breakpoint, JSON.stringify(doc.layouts[breakpoint] ?? []));
    // Data and approvals of widgets that are gone.
    const keep = new Set(doc.widgets.map((widget) => widget.id));
    for (const gone of [...previous.keys()].filter((widgetId) => !keep.has(widgetId))) {
      this.db.prepare("DELETE FROM dashboard_data WHERE dashboard_id = ? AND widget_id = ?").run(id, gone);
      this.db.prepare("DELETE FROM dashboard_script_approvals WHERE dashboard_id = ? AND widget_id = ?").run(id, gone);
      this.db.prepare("DELETE FROM dashboard_script_proposals WHERE dashboard_id = ? AND widget_id = ?").run(id, gone);
      changedSources.push(gone);
    }
    if (changedSources.length) this.sourcesChanged?.(id, changedSources);
  }

  /**
   * Saves a new document. The one it replaces becomes a version when the
   * last version is a minute old or by someone else, so a run of drags or
   * an agent's burst of edits is one step back. Returns the new revision.
   */
  write(id: string, doc: DashboardDoc, by: Actor, label: string, threadId: string | null = null): number {
    return this.db.transaction(() => {
      const row = this.get(id);
      if (!row) throw new Error("Dashboard not found.");
      const at = this.nextRevision(row);
      const last = this.db.prepare("SELECT created_at, actor FROM dashboard_versions WHERE dashboard_id = ? ORDER BY id DESC LIMIT 1").get(id) as { created_at: number; actor: string } | undefined;
      if (!last || last.actor !== by || at - last.created_at >= VERSION_GAP_MS) this.saveVersion(row, by, label);
      this.replaceDoc(id, doc, at, by, threadId);
      this.db.prepare("UPDATE dashboards SET updated_at = ?, updated_by = ? WHERE id = ?").run(at, by, id);
      return at;
    }).immediate();
  }

  /** Records the dashboard as it is now and keeps the newest 20. */
  saveVersion(row: DashboardRow, actor: Actor, label: string): void {
    const doc = this.doc(row.id);
    this.db.prepare("INSERT INTO dashboard_versions (dashboard_id, created_at, actor, label, doc) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, this.now(), actor, label, JSON.stringify({ name: row.name, ...doc }));
    this.db.prepare(`DELETE FROM dashboard_versions WHERE dashboard_id = ? AND id NOT IN
      (SELECT id FROM dashboard_versions WHERE dashboard_id = ? ORDER BY id DESC LIMIT ?)`).run(row.id, row.id, LIMITS.versions);
  }

  versions(id: string): VersionRow[] {
    return this.db.prepare("SELECT * FROM dashboard_versions WHERE dashboard_id = ? ORDER BY id DESC").all(id) as VersionRow[];
  }

  version(id: string, versionId: number): VersionRow | null {
    return (this.db.prepare("SELECT * FROM dashboard_versions WHERE dashboard_id = ? AND id = ?").get(id, versionId) as VersionRow | undefined) ?? null;
  }

  rename(id: string, name: string, by: Actor): number {
    const row = this.get(id);
    if (!row) throw new Error("Dashboard not found.");
    const at = this.nextRevision(row);
    this.db.prepare("UPDATE dashboards SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(name, at, by, id);
    return at;
  }

  setProject(id: string, projectId: string | null): void {
    this.db.prepare("UPDATE dashboards SET project_id = ? WHERE id = ?").run(projectId, id);
  }

  setArchived(id: string, archived: boolean): void {
    this.db.prepare("UPDATE dashboards SET archived_at = ? WHERE id = ?").run(archived ? this.now() : null, id);
  }

  setTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE dashboards SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }

  delete(id: string): boolean {
    return this.db.transaction(() => {
      for (const table of ["dashboard_widgets", "dashboard_layouts", "dashboard_data", "dashboard_script_approvals", "dashboard_script_proposals", "dashboard_versions"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE dashboard_id = ?`).run(id);
      }
      return this.db.prepare("DELETE FROM dashboards WHERE id = ?").run(id).changes > 0;
    })();
  }

  // -- Data ------------------------------------------------------------------

  data(id: string): DataRow[] {
    return this.db.prepare("SELECT * FROM dashboard_data WHERE dashboard_id = ?").all(id) as DataRow[];
  }

  dataFor(id: string, widgetId: string): DataRow | null {
    return (this.db.prepare("SELECT * FROM dashboard_data WHERE dashboard_id = ? AND widget_id = ?").get(id, widgetId) as DataRow | undefined) ?? null;
  }

  /** A good value: clears the error. */
  setValue(id: string, widgetId: string, value: unknown, at = this.now()): void {
    this.db.prepare(`INSERT INTO dashboard_data (dashboard_id, widget_id, value, fetched_at, error, error_at, attempted_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(dashboard_id, widget_id) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, error = NULL, error_at = NULL, attempted_at = excluded.attempted_at`)
      .run(id, widgetId, JSON.stringify(value ?? null), at, at);
  }

  /** A failed attempt: keeps the last good value. */
  setError(id: string, widgetId: string, error: string, at = this.now()): void {
    this.db.prepare(`INSERT INTO dashboard_data (dashboard_id, widget_id, error, error_at, attempted_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(dashboard_id, widget_id) DO UPDATE SET error = excluded.error, error_at = excluded.error_at, attempted_at = excluded.attempted_at`)
      .run(id, widgetId, error.slice(0, 1000), at, at);
  }

  markAttempt(id: string, widgetId: string, at = this.now()): void {
    this.db.prepare(`INSERT INTO dashboard_data (dashboard_id, widget_id, attempted_at) VALUES (?, ?, ?)
      ON CONFLICT(dashboard_id, widget_id) DO UPDATE SET attempted_at = excluded.attempted_at`).run(id, widgetId, at);
  }

  clearData(id: string, widgetId: string): void {
    this.db.prepare("DELETE FROM dashboard_data WHERE dashboard_id = ? AND widget_id = ?").run(id, widgetId);
  }

  // -- Script approvals -------------------------------------------------------

  approval(id: string, widgetId: string): ApprovalRow | null {
    return (this.db.prepare("SELECT * FROM dashboard_script_approvals WHERE dashboard_id = ? AND widget_id = ?").get(id, widgetId) as ApprovalRow | undefined) ?? null;
  }

  approve(id: string, widgetId: string, sha256: string, command: string, cwd: string | null): void {
    this.db.prepare(`INSERT INTO dashboard_script_approvals (dashboard_id, widget_id, sha256, command, cwd, approved_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(dashboard_id, widget_id) DO UPDATE SET sha256 = excluded.sha256, command = excluded.command, cwd = excluded.cwd, approved_at = excluded.approved_at`)
      .run(id, widgetId, sha256, command, cwd, this.now());
  }

  /** Whether the user approved this exact command (by hash) for any widget on the dashboard. */
  commandApproved(id: string, sha256: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM dashboard_script_approvals WHERE dashboard_id = ? AND sha256 = ? LIMIT 1").get(id, sha256);
  }

  /** Drops the widget's approval and, with `sha256`, that command's approval for every widget on the dashboard. */
  revoke(id: string, widgetId: string, sha256?: string): void {
    this.db.prepare("DELETE FROM dashboard_script_approvals WHERE dashboard_id = ? AND (widget_id = ? OR sha256 = ?)").run(id, widgetId, sha256 ?? null);
  }

  /** Records who wrote a script widget's command. */
  propose(id: string, widgetId: string, sha256: string, actor: Actor, threadId: string | null): void {
    this.db.prepare(`INSERT INTO dashboard_script_proposals (dashboard_id, widget_id, sha256, actor, thread_id, proposed_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(dashboard_id, widget_id) DO UPDATE SET sha256 = excluded.sha256, actor = excluded.actor, thread_id = excluded.thread_id, proposed_at = excluded.proposed_at`)
      .run(id, widgetId, sha256, actor, threadId, this.now());
  }

  /** Who proposed the command with this hash, if Studio knows. */
  proposal(id: string, widgetId: string, sha256: string): ProposalRow | null {
    return (this.db.prepare("SELECT * FROM dashboard_script_proposals WHERE dashboard_id = ? AND widget_id = ? AND sha256 = ?").get(id, widgetId, sha256) as ProposalRow | undefined) ?? null;
  }

  // -- Custom widget library --------------------------------------------------

  types(): TypeRow[] {
    return this.db.prepare("SELECT * FROM dashboard_widget_types ORDER BY name COLLATE NOCASE").all() as TypeRow[];
  }

  type(id: string): TypeRow | null {
    return (this.db.prepare("SELECT * FROM dashboard_widget_types WHERE id = ?").get(id) as TypeRow | undefined) ?? null;
  }

  saveType(input: { id?: string; name: string; description?: string; html: string; defaultOptions?: Record<string, unknown>; sampleData?: unknown; by: Actor }): TypeRow {
    const at = this.now();
    const existing = input.id ? this.type(input.id) : null;
    if (input.id && !existing) throw new Error(`No widget type ${input.id} in the library.`);
    if (!existing && (this.db.prepare("SELECT COUNT(*) AS n FROM dashboard_widget_types").get() as { n: number }).n >= LIMITS.libraryTypes) {
      throw new Error(`The library holds at most ${LIMITS.libraryTypes} widget types.`);
    }
    const description = input.description ?? existing?.description ?? "";
    const defaultOptions = input.defaultOptions ?? parseJson(existing?.default_options ?? null, {} as Record<string, unknown>);
    const sampleData = input.sampleData === undefined
      ? existing?.sample_data === null || !existing ? undefined : parseJson(existing.sample_data, null)
      : input.sampleData;
    if (jsonBytes(input.html) > LIMITS.htmlBytes) throw new Error(`html is over ${LIMITS.htmlBytes / 1024} KB.`);
    if (jsonBytes(defaultOptions) > LIMITS.optionsBytes) throw new Error(`defaultOptions is over ${LIMITS.optionsBytes / 1024} KB.`);
    if (sampleData !== undefined && jsonBytes(sampleData) > LIMITS.staticBytes) throw new Error(`sampleData is over ${LIMITS.staticBytes / 1024} KB.`);
    const id = existing?.id ?? newId("wt");
    this.db.prepare(`INSERT INTO dashboard_widget_types (id, name, description, html, default_options, sample_data, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, html = excluded.html,
        default_options = excluded.default_options, sample_data = excluded.sample_data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(id, input.name, description, input.html, JSON.stringify(defaultOptions), sampleData === undefined ? null : JSON.stringify(sampleData), existing?.created_at ?? at, at, input.by);
    return this.type(id)!;
  }

  /** Dashboards whose widgets use a library type. */
  typeUsers(typeId: string): string[] {
    return (this.db.prepare("SELECT DISTINCT dashboard_id FROM dashboard_widgets WHERE custom_type = ?").all(typeId) as { dashboard_id: string }[]).map((row) => row.dashboard_id);
  }

  deleteType(id: string): boolean {
    return this.db.prepare("DELETE FROM dashboard_widget_types WHERE id = ?").run(id).changes > 0;
  }

  /** Two writes in the same millisecond still get distinct revisions. */
  private nextRevision(row: DashboardRow): number {
    return Math.max(this.now(), row.updated_at + 1);
  }
}
