// Dashboards' part of `bb studio backup` / `bb studio restore`.
//
// Section layout (version 1):
//   items/<fileSafeId(id)>.json   one dashboard: its row, widgets, layouts and
//                                 pushed data (the only copy of it)
//   types/<fileSafeId(id)>.json   one custom widget type from the library
//
// Left out: fetched url and script data (refetched), version history, and
// script approvals: a restored script waits for the user to approve it again,
// so a backup file can never approve a command.
import { readFileSync, statSync } from "node:fs";
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, fileSafeIdMatches, type BackupHandlers, type BackupReader } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import { z } from "zod";
import { applyOps } from "../ops";
import { isDashboardId, layoutsSchema, LIMITS, widgetSchema } from "../shared";
import type { DashboardStore } from "./store";

export const DASHBOARD_BACKUP_VERSION = 1;
const MAX_ITEM_BYTES = 64 * 1024 * 1024;

const itemSchema = z.object({
  id: z.string().refine(isDashboardId, "Not a dashboard id."),
  projectId: z.string().min(1).max(200).nullable(),
  name: z.string().max(10_000),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  updatedBy: z.string().max(50).nullable(),
  archivedAt: z.number().int().min(0).nullable(),
  template: z.boolean(),
  widgets: z.array(widgetSchema).max(LIMITS.widgets),
  layouts: layoutsSchema,
  /** Pushed data by widget id. */
  pushed: z.record(z.string(), z.object({ value: z.unknown(), fetchedAt: z.number().int().min(0) })),
});
type BackupItem = z.infer<typeof itemSchema>;

const typeSchema = z.object({
  id: z.string().regex(/^wt_[0-9a-f]{16}$/),
  name: z.string().min(1).max(LIMITS.title),
  description: z.string().max(2000),
  html: z.string().min(1).max(LIMITS.htmlBytes),
  defaultOptions: z.record(z.string(), z.unknown()),
  sampleData: z.unknown().nullable(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
});

function readJson(reader: BackupReader, rel: string): unknown {
  const path = reader.path(rel);
  if (statSync(path).size > MAX_ITEM_BYTES) throw new Error("The file is too large to restore.");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const issues = (error: z.ZodError) => error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`).join("; ");

export function createDashboardBackup(deps: { db: Database.Database; store: DashboardStore; changed(id: string): void }): BackupHandlers {
  const { db, store } = deps;
  return {
    version: DASHBOARD_BACKUP_VERSION,

    async backup(writer) {
      let dashboards = 0;
      let types = 0;
      const notes: string[] = [];
      for (const row of store.list({ includeArchived: true })) {
        let safe: string;
        try { safe = fileSafeId(row.id); } catch { notes.push(`Skipped dashboard ${row.id}: its id can't be a file name.`); continue; }
        const doc = store.doc(row.id);
        const pushed: BackupItem["pushed"] = {};
        for (const data of store.data(row.id)) {
          const widget = doc.widgets.find((each) => each.id === data.widget_id);
          if (widget?.source.kind !== "push" || data.value === null || data.fetched_at === null) continue;
          try { pushed[data.widget_id] = { value: JSON.parse(data.value), fetchedAt: data.fetched_at }; } catch { /* skipped */ }
        }
        const item: BackupItem = {
          id: row.id, projectId: row.project_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
          updatedBy: row.updated_by, archivedAt: row.archived_at, template: row.template !== 0,
          widgets: doc.widgets, layouts: doc.layouts, pushed,
        };
        await writer.json(`items/${safe}.json`, item);
        dashboards += 1;
      }
      for (const type of store.types()) {
        let parsed: unknown = {};
        try { parsed = JSON.parse(type.default_options); } catch { /* empty */ }
        let sample: unknown = null;
        try { sample = type.sample_data === null ? null : JSON.parse(type.sample_data); } catch { /* none */ }
        await writer.json(`types/${fileSafeId(type.id)}.json`, {
          id: type.id, name: type.name, description: type.description, html: type.html,
          defaultOptions: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
          sampleData: sample, createdAt: type.created_at, updatedAt: type.updated_at,
        });
        types += 1;
      }
      if (store.list({ includeArchived: true }).some((row) => store.doc(row.id).widgets.some((widget) => widget.source.kind === "script"))) {
        notes.push("Script widgets need the user's approval again after a restore.");
      }
      return { counts: { dashboards, widgetTypes: types }, notes };
    },

    async restore(reader, { dryRun, projects, tally }) {
      const typeNames = (await reader.list("types").catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
      const names = (await reader.list("items").catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
      const touched: string[] = [];
      const run = () => {
        for (const name of typeNames) {
          let type: z.infer<typeof typeSchema>;
          try {
            const parsed = typeSchema.safeParse(readJson(reader, `types/${name}`));
            if (!parsed.success) throw new Error(`Not a valid widget type: ${issues(parsed.error)}`);
            type = parsed.data;
          } catch (error) {
            tally.record("failed", { id: name.replace(/\.json$/, ""), title: null }, error instanceof Error ? error.message : String(error));
            continue;
          }
          const ref = { id: type.id, title: type.name };
          const decision = restoreDecision(store.type(type.id)?.updated_at ?? null, type.updatedAt);
          tally.decided(decision, ref);
          if (dryRun || (decision !== "create" && decision !== "update")) continue;
          db.prepare(`INSERT INTO dashboard_widget_types (id, name, description, html, default_options, sample_data, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user')
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, html = excluded.html,
              default_options = excluded.default_options, sample_data = excluded.sample_data, created_at = excluded.created_at, updated_at = excluded.updated_at`)
            .run(type.id, type.name, type.description, type.html, JSON.stringify(type.defaultOptions), type.sampleData === null ? null : JSON.stringify(type.sampleData), type.createdAt, type.updatedAt);
        }
        for (const name of names) {
          let item: BackupItem;
          try {
            const parsed = itemSchema.safeParse(readJson(reader, `items/${name}`));
            if (!parsed.success) throw new Error(`Not a valid dashboard: ${issues(parsed.error)}`);
            item = parsed.data;
            if (!fileSafeIdMatches(item.id, name.slice(0, -5))) throw new Error("The file name doesn't match the dashboard id.");
          } catch (error) {
            tally.record("failed", { id: name.replace(/\.json$/, ""), title: null }, error instanceof Error ? error.message : String(error));
            continue;
          }
          const ref = { id: item.id, title: item.name || "Untitled dashboard" };
          // Widgets go through the same checks as an edit; a bad one fails the item.
          let doc;
          try {
            doc = applyOps({ widgets: item.widgets, layouts: item.layouts }, [], { newId: () => { throw new Error("unused"); }, hasType: () => true }).doc;
          } catch (error) {
            tally.record("failed", ref, error instanceof Error ? error.message : String(error));
            continue;
          }
          const local = store.get(item.id);
          const decision = restoreDecision(local?.updated_at ?? null, item.updatedAt);
          tally.decided(decision, ref);
          if (decision !== "create" && decision !== "update") continue;
          const mapped = mapProject(projects, item.projectId);
          const projectId = mapped.unmapped && local ? local.project_id : mapped.projectId;
          if (mapped.unmapped && !projectId) tally.unmapped(ref);
          if (dryRun) continue;
          if (!local) {
            db.prepare("INSERT INTO dashboards (id, name, project_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)")
              .run(item.id, item.name, projectId, item.createdAt, item.updatedAt, item.updatedBy);
          } else {
            store.saveVersion(local, "user", "Before restore");
          }
          // Approvals never come from a backup. This BB's stay pinned to their hash, so a changed command waits for the user.
          store.write(item.id, doc, "user", "Restored");
          db.prepare("UPDATE dashboards SET name = ?, project_id = ?, created_at = ?, updated_at = ?, updated_by = ?, archived_at = ?, template = ? WHERE id = ?")
            .run(item.name, projectId, item.createdAt, item.updatedAt, item.updatedBy, item.archivedAt, item.template ? 1 : 0, item.id);
          for (const [widgetId, pushed] of Object.entries(item.pushed)) {
            if (doc.widgets.some((widget) => widget.id === widgetId && widget.source.kind === "push")) store.setValue(item.id, widgetId, pushed.value, pushed.fetchedAt);
          }
          touched.push(item.id);
        }
      };
      if (dryRun) run();
      else db.transaction(run).immediate();
      for (const id of touched) deps.changed(id);
    },
  };
}
