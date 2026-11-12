// Mini apps' part of `bb studio backup` / `bb studio restore`.
//
// Section layout (version 1):
//   items/<fileSafeId(id)>.json   one mini app: its row, current source,
//                                 shared state and records
//
// Left out: older versions, the event and network logs, takes, approvals
// and secrets. A restored app asks the user to approve its access again and
// to store its secrets again, so a backup file can never grant either.
import { readFileSync, statSync } from "node:fs";
import type Database from "better-sqlite3";
import { z } from "zod";
import { mapProject, restoreDecision } from "../../kit/backup";
import { fileSafeId, fileSafeIdMatches, type BackupHandlers, type BackupReader } from "../../kit/server/index";
import { isMiniId } from "../shared";
import { compile } from "./compile";
import type { MiniStore } from "./store";

export const MINI_BACKUP_VERSION = 1;
const MAX_ITEM_BYTES = 128 * 1024 * 1024;

const recordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  rev: z.number().int().min(1),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  createdBy: z.enum(["user", "agent"]),
  data: z.record(z.string(), z.unknown()),
});

const itemSchema = z.object({
  id: z.string().refine(isMiniId, "Not a mini app id."),
  projectId: z.string().min(1).max(200).nullable(),
  name: z.string().max(10_000),
  icon: z.string().max(100).nullable(),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  updatedBy: z.string().max(50),
  archivedAt: z.number().int().min(0).nullable(),
  template: z.boolean(),
  files: z.record(z.string(), z.string()),
  state: z.unknown(),
  records: z.record(z.string(), z.array(recordSchema)),
});
type BackupItem = z.infer<typeof itemSchema>;

function readJson(reader: BackupReader, rel: string): unknown {
  const path = reader.path(rel);
  if (statSync(path).size > MAX_ITEM_BYTES) throw new Error("The file is too large to restore.");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function createMiniBackup(deps: { db: Database.Database; store: MiniStore; changed(id: string): void }): BackupHandlers {
  const { db, store } = deps;
  return {
    version: MINI_BACKUP_VERSION,

    async backup(writer) {
      let minis = 0;
      let records = 0;
      const notes: string[] = [];
      for (const row of store.list({ includeArchived: true, limit: 100_000 })) {
        const grouped: BackupItem["records"] = {};
        for (const { collection, record } of store.allRecords(row.id)) {
          (grouped[collection] ??= []).push(record);
          records += 1;
        }
        const item: BackupItem = {
          id: row.id, projectId: row.project_id, name: row.name, icon: row.icon, createdAt: row.created_at, updatedAt: row.updated_at,
          updatedBy: row.updated_by, archivedAt: row.archived_at, template: row.template !== 0,
          files: store.current(row.id)?.files ?? {}, state: store.state(row.id).state, records: grouped,
        };
        await writer.json(`items/${fileSafeId(row.id)}.json`, item);
        minis += 1;
      }
      if (minis) notes.push("Mini apps' approvals and secrets aren't backed up: the user approves access and stores secrets again after a restore.");
      return { counts: { minis, records }, notes };
    },

    async restore(reader, { dryRun, projects, tally }) {
      const names = (await reader.list("items").catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
      const touched: string[] = [];
      const run = () => {
        for (const name of names) {
          let item: BackupItem;
          try {
            const parsed = itemSchema.safeParse(readJson(reader, `items/${name}`));
            if (!parsed.success) throw new Error(`Not a valid mini app: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
            item = parsed.data;
            if (!fileSafeIdMatches(item.id, name.slice(0, -5))) throw new Error("The file name doesn't match the mini app id.");
          } catch (error) {
            tally.record("failed", { id: name.replace(/\.json$/, ""), title: null }, error instanceof Error ? error.message : String(error));
            continue;
          }
          const ref = { id: item.id, title: item.name || "Untitled mini app" };
          let compiled;
          try {
            compiled = Object.keys(item.files).length ? compile(item.files) : null;
          } catch (error) {
            tally.record("failed", ref, `Its source doesn't compile: ${error instanceof Error ? error.message : String(error)}`);
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
            db.prepare("INSERT INTO minis (id, name, project_id, icon, version_id, thread_id, archived_at, template, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?)")
              .run(item.id, item.name, projectId, item.icon, item.createdAt, item.updatedAt, item.updatedBy);
          }
          if (compiled) store.addVersion(item.id, { files: item.files, manifest: compiled.manifest, modules: compiled.modules, html: compiled.html, note: "Restored", by: "user" });
          db.prepare("DELETE FROM mini_records WHERE mini_id = ?").run(item.id);
          const insert = db.prepare("INSERT INTO mini_records (mini_id, collection, id, data, rev, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
          for (const [collection, list] of Object.entries(item.records)) {
            for (const record of list) insert.run(item.id, collection, record.id, JSON.stringify(record.data), record.rev, record.createdBy, record.createdAt, record.updatedAt);
          }
          if (item.state !== undefined && item.state !== null) store.setState(item.id, item.state, "user");
          db.prepare("UPDATE minis SET name = ?, project_id = ?, icon = ?, created_at = ?, updated_at = ?, updated_by = ?, archived_at = ?, template = ? WHERE id = ?")
            .run(item.name, projectId, item.icon, item.createdAt, item.updatedAt, item.updatedBy, item.archivedAt, item.template ? 1 : 0, item.id);
          touched.push(item.id);
        }
      };
      if (dryRun) run();
      else db.transaction(run).immediate();
      for (const id of touched) deps.changed(id);
    },
  };
}
