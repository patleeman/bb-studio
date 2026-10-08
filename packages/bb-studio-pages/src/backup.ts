// Pages' part of `bb studio backup` / `bb studio restore` (the contract is in
// @bb-studio/kit/backup). Section layout, version 1:
//
//   items/<page id>.json                    the page row (see itemSchema)
//   files/<page id>/state.bin               the page's Yjs state; comments live in it
//   files/<page id>/page.md                 the Markdown cache
//   files/<page id>/snapshots/<id>.bin      a saved version's Yjs state
//   files/<page id>/attachments/<id>        an uploaded file's bytes
//
// Not saved: bot request history, page chats and checklist hand-offs. Each
// points at a BB thread that won't exist on another BB.
//
// Restore reads and checks every item first (async, one binary at a time),
// then applies all writes in one synchronous SQLite transaction, reading each
// binary just before it's written. A page that is open in an editor, or has
// unsaved changes, is never overwritten: it fails with a reason and a later
// run picks it up once it's closed.
import { readFileSync } from "node:fs";
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, fileSafeIdMatches, type BackupHandlers, type BackupReader, type BackupWriter } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import * as Y from "yjs";
import { z } from "zod";
import type { RealtimeEvent } from "./constants";
import { readMarkdown } from "./doc";

export const PAGES_BACKUP_VERSION = 1;
export const EXCLUDED_NOTE =
  "Not included: page request history, page chats and checklist hand-offs. They point at BB threads that won't exist on another BB.";
const OPEN_REASON = "It is open in an editor or has unsaved changes; close it and restore again.";
/** Larger binaries are refused rather than read into memory. */
const MAX_BINARY_BYTES = 512 * 1024 * 1024;

const id = z.string().refine((value) => {
  try { fileSafeId(value); return true; } catch { return false; }
}, "Not a valid id.");
const time = z.number().int().min(0);

const itemSchema = z.object({
  id,
  projectId: z.string().min(1).max(200).nullable(),
  parentId: id.nullable(),
  title: z.string().max(10_000),
  icon: z.string().max(200),
  position: z.number().finite(),
  createdAt: time,
  updatedAt: time,
  updatedBy: z.string().max(500),
  archivedAt: time.nullable(),
  template: z.boolean(),
  refresh: z.object({
    botId: z.string().max(500).nullable(),
    cron: z.string().max(500).nullable(),
    instructions: z.string().max(100_000),
    lastAt: time.nullable(),
  }),
  hasState: z.boolean(),
  hasMarkdown: z.boolean(),
  snapshots: z.array(z.object({ id, label: z.string().max(10_000), actor: z.string().max(500), createdAt: time })).max(100_000),
  files: z.array(z.object({ id, name: z.string().max(1000), mime: z.string().max(200), size: z.number().int().min(0), createdAt: time })).max(100_000),
});
export type PageBackupItem = z.infer<typeof itemSchema>;

interface PageDbRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  icon: string;
  position: number;
  state: Buffer | null;
  markdown: string;
  created_at: number;
  updated_at: number;
  updated_by: string;
  archived_at: number | null;
  refresh_bot_id: string | null;
  refresh_cron: string | null;
  refresh_instructions: string;
  refresh_last_at: number | null;
  template: number;
}

/** The parts of the live hub restore needs. */
export interface BackupHub {
  activity(pageId: string): "closed" | "idle" | "editing";
  evict(pageId: string): void;
  flushAll(): void;
}

export interface PagesBackupDeps {
  db: Database.Database;
  hub?: BackupHub;
  /** Tells open views and Studio about restored pages. */
  publish?(event: RealtimeEvent): void;
}

const dir = (pageId: string) => `files/${fileSafeId(pageId)}`;

export function pagesBackup({ db, hub, publish }: PagesBackupDeps): BackupHandlers {
  return {
    version: PAGES_BACKUP_VERSION,

    async backup(writer: BackupWriter) {
      // Save what editors typed in the last second too.
      hub?.flushAll();
      const counts = { pages: 0, versions: 0, files: 0 };
      const ids = (db.prepare("SELECT id FROM pages ORDER BY created_at, id").all() as { id: string }[]).map((row) => row.id);
      for (const pageId of ids) {
        const row = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as PageDbRow | undefined;
        if (!row) continue;
        const snapshots = db.prepare("SELECT id, label, actor, created_at FROM snapshots WHERE page_id = ? ORDER BY created_at, rowid").all(pageId) as
          { id: string; label: string; actor: string; created_at: number }[];
        const files = db.prepare("SELECT id, name, mime, size, created_at FROM files WHERE page_id = ? ORDER BY created_at, id").all(pageId) as
          { id: string; name: string; mime: string; size: number; created_at: number }[];
        const item: PageBackupItem = {
          id: row.id,
          projectId: row.project_id,
          parentId: row.parent_id,
          title: row.title,
          icon: row.icon,
          position: row.position,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          archivedAt: row.archived_at,
          template: Boolean(row.template),
          refresh: { botId: row.refresh_bot_id, cron: row.refresh_cron, instructions: row.refresh_instructions, lastAt: row.refresh_last_at },
          hasState: Boolean(row.state?.byteLength),
          hasMarkdown: Boolean(row.markdown),
          snapshots: snapshots.map((snap) => ({ id: snap.id, label: snap.label, actor: snap.actor, createdAt: snap.created_at })),
          files: files.map((file) => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, createdAt: file.created_at })),
        };
        if (row.state?.byteLength) await writer.bytesAt(`${dir(pageId)}/state.bin`, row.state);
        if (row.markdown) await writer.bytesAt(`${dir(pageId)}/page.md`, Buffer.from(row.markdown, "utf8"));
        row.state = null;
        for (const snap of snapshots) {
          const state = db.prepare("SELECT state FROM snapshots WHERE id = ?").get(snap.id) as { state: Buffer };
          await writer.bytesAt(`${dir(pageId)}/snapshots/${fileSafeId(snap.id)}.bin`, state.state);
        }
        for (const file of files) {
          const data = db.prepare("SELECT data FROM files WHERE id = ?").get(file.id) as { data: Buffer };
          await writer.bytesAt(`${dir(pageId)}/attachments/${fileSafeId(file.id)}`, data.data);
        }
        await writer.json(`items/${fileSafeId(pageId)}.json`, item);
        counts.pages += 1;
        counts.versions += snapshots.length;
        counts.files += files.length;
      }
      return { counts, notes: [EXCLUDED_NOTE] };
    },

    async restore(reader: BackupReader, { dryRun, projects, tally }) {
      tally.note(EXCLUDED_NOTE);
      const local = db.prepare("SELECT updated_at FROM pages WHERE id = ?");
      type Planned = { item: PageBackupItem; decision: "create" | "update" | "unchanged" | "keep"; projectId: string | null; unmapped: boolean };
      const planned: Planned[] = [];

      // 1. Read and check every item. No writes.
      const names = (await reader.list("items")).filter((name) => name.endsWith(".json"));
      for (const name of names) {
        const fileId = name.slice(0, -".json".length);
        let raw: unknown;
        try {
          raw = await reader.json(`items/${name}`);
        } catch (error) {
          tally.record("failed", { id: fileId }, errorText(error));
          continue;
        }
        const parsed = itemSchema.safeParse(raw);
        if (!parsed.success) {
          const title = raw && typeof raw === "object" && typeof (raw as { title?: unknown }).title === "string" ? (raw as { title: string }).title : null;
          tally.record("failed", { id: fileId, title }, `Not a valid page: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          continue;
        }
        const item = parsed.data;
        try {
          if (!fileSafeIdMatches(item.id, fileId)) throw new Error("Its file name doesn't match its id.");
          await checkBinaries(reader, item);
        } catch (error) {
          tally.record("failed", item, errorText(error));
          continue;
        }
        const existing = local.get(item.id) as { updated_at: number } | undefined;
        const mapped = mapProject(projects, item.projectId);
        planned.push({ item, decision: restoreDecision(existing?.updated_at ?? null, item.updatedAt), ...mapped });
      }

      // 2. Decide, then write everything in one transaction.
      const exists = db.prepare("SELECT 1 FROM pages WHERE id = ?");
      const restoredIds = new Set(planned.filter((plan) => plan.decision === "create").map((plan) => plan.item.id));
      const blocked = new Set<string>();
      for (const plan of planned) {
        if (plan.decision === "update" && hub?.activity(plan.item.id) === "editing") blocked.add(plan.item.id);
      }
      // A page whose parent won't be here becomes top-level.
      const parentOf = (item: PageBackupItem) =>
        item.parentId && (restoredIds.has(item.parentId) || exists.get(item.parentId)) ? item.parentId : null;

      const insertPage = db.prepare(`INSERT INTO pages (id, project_id, parent_id, title, icon, position, state, markdown, created_at, updated_at, updated_by,
          archived_at, refresh_bot_id, refresh_cron, refresh_instructions, refresh_last_at, template)
        VALUES (@id, @projectId, @parentId, @title, @icon, @position, @state, @markdown, @createdAt, @updatedAt, @updatedBy,
          @archivedAt, @refreshBotId, @refreshCron, @refreshInstructions, @refreshLastAt, @template)`);
      const updatePage = db.prepare(`UPDATE pages SET project_id = @projectId, parent_id = @parentId, title = @title, icon = @icon, position = @position,
          state = @state, markdown = @markdown, created_at = @createdAt, updated_at = @updatedAt, updated_by = @updatedBy, archived_at = @archivedAt,
          refresh_bot_id = @refreshBotId, refresh_cron = @refreshCron, refresh_instructions = @refreshInstructions, refresh_last_at = @refreshLastAt,
          template = @template
        WHERE id = @id`);
      const insertSnapshot = db.prepare("INSERT OR IGNORE INTO snapshots (id, page_id, state, label, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      const insertFile = db.prepare("INSERT OR IGNORE INTO files (id, page_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const snapshotExists = db.prepare("SELECT 1 FROM snapshots WHERE id = ?");
      const fileExists = db.prepare("SELECT 1 FROM files WHERE id = ?");
      const changed: { pageId: string; projectId: string | null }[] = [];

      const apply = (plan: Planned) => {
        const { item } = plan;
        const write = plan.decision === "create" || plan.decision === "update";
        if (write) {
          if (hub?.activity(item.id) === "idle") hub.evict(item.id);
          const state = item.hasState ? readFileSync(reader.path(`${dir(item.id)}/state.bin`)) : null;
          const markdown = item.hasMarkdown
            ? readFileSync(reader.path(`${dir(item.id)}/page.md`), "utf8")
            : state ? markdownOf(state) : "";
          (plan.decision === "create" ? insertPage : updatePage).run({
            id: item.id,
            projectId: plan.projectId,
            parentId: parentOf(item),
            title: item.title,
            icon: item.icon,
            position: item.position,
            state,
            markdown,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            updatedBy: item.updatedBy,
            archivedAt: item.archivedAt,
            refreshBotId: item.refresh.botId,
            refreshCron: item.refresh.cron,
            refreshInstructions: item.refresh.instructions,
            refreshLastAt: item.refresh.lastAt,
            template: item.template ? 1 : 0,
          });
          changed.push({ pageId: item.id, projectId: plan.projectId });
        }
        // Versions and files are additive and keyed by their own ids, so
        // missing ones are added even to a page that stays as it is.
        for (const snap of item.snapshots) {
          if (snapshotExists.get(snap.id)) continue;
          const state = readFileSync(reader.path(`${dir(item.id)}/snapshots/${fileSafeId(snap.id)}.bin`));
          insertSnapshot.run(snap.id, item.id, state, snap.label, snap.actor, snap.createdAt);
        }
        for (const file of item.files) {
          if (fileExists.get(file.id)) continue;
          const data = readFileSync(reader.path(`${dir(item.id)}/attachments/${fileSafeId(file.id)}`));
          insertFile.run(file.id, item.id, file.name, file.mime, data.byteLength, data, file.createdAt);
        }
      };

      const run = db.transaction(() => {
        for (const plan of planned) {
          if (blocked.has(plan.item.id)) continue;
          if (!dryRun) apply(plan);
        }
      });
      run();

      for (const plan of planned) {
        if (blocked.has(plan.item.id)) {
          tally.record("failed", plan.item, OPEN_REASON);
          continue;
        }
        tally.decided(plan.decision, plan.item);
        if (plan.unmapped && (plan.decision === "create" || plan.decision === "update")) tally.unmapped(plan.item);
      }

      if (!dryRun && publish && changed.length) {
        for (const projectId of new Set(changed.map((entry) => entry.projectId))) publish({ type: "tree", projectId });
        for (const entry of changed) publish({ type: "page", pageId: entry.pageId });
      }
    },
  };
}

/** Checks that every binary an item names is there, and that its page state is a Yjs update. */
async function checkBinaries(reader: BackupReader, item: PageBackupItem): Promise<void> {
  const need = async (rel: string, label: string) => {
    const size = await reader.size(rel).catch(() => null);
    if (size === null) throw new Error(`Its ${label} is missing from the backup.`);
    if (size > MAX_BINARY_BYTES) throw new Error(`Its ${label} is too large to restore.`);
  };
  if (item.hasState) {
    await need(`${dir(item.id)}/state.bin`, "content");
    try {
      markdownOf(await reader.bytes(`${dir(item.id)}/state.bin`));
    } catch {
      throw new Error("Its content isn't a valid page document.");
    }
  }
  if (item.hasMarkdown) await need(`${dir(item.id)}/page.md`, "Markdown");
  for (const snap of item.snapshots) await need(`${dir(item.id)}/snapshots/${fileSafeId(snap.id)}.bin`, `version ${snap.id}`);
  for (const file of item.files) await need(`${dir(item.id)}/attachments/${fileSafeId(file.id)}`, `file ${file.name || file.id}`);
}

function markdownOf(state: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return readMarkdown(doc);
  } finally {
    doc.destroy();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
