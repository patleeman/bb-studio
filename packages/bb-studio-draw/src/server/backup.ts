// Studio Draw's part of `bb studio backup` / `bb studio restore`.
//
// Section layout (version 1):
//   items/<fileSafeId(drawingId)>.json   one drawing: its row fields and scene
//                                        (elements, appState, ...) without image data
//   files/<fileSafeId(drawingId)>/<n>    one image's bytes, decoded from its data URL;
//                                        the item JSON keeps the path and mime type
//
// Left out: thumbnails (rendered on request from the scene) and the
// recovery-copy keys (they only dedupe this BB's own editor drafts).
// Drawings keep no versions, so there is no history to save.
import { readFileSync, statSync } from "node:fs";
import { fileSafeId, fileSafeIdMatches, type BackupHandlers, type BackupReader, type BackupWriter } from "@bb-studio/kit/server";
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import type Database from "better-sqlite3";
import { z } from "zod";
import { isDrawingId } from "../shared";
import type { DrawingRow, DrawingStore } from "./store";

export const DRAW_BACKUP_VERSION = 1;
const MAX_ITEM_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

const fileEntry = z.object({
  /** Section-relative path of the decoded bytes. */
  path: z.string().min(1).max(500),
  /** The data URL's mime type. */
  mimeType: z.string().regex(MIME),
  /** The rest of Excalidraw's file record (id, mimeType, created, ...), minus dataURL. */
  meta: z.record(z.string(), z.unknown()),
});

const itemSchema = z.object({
  id: z.string().refine(isDrawingId, "Not a drawing id."),
  projectId: z.string().min(1).max(200).nullable(),
  name: z.string().max(10_000),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  updatedBy: z.string().max(50).nullable(),
  archivedAt: z.number().int().min(0).nullable(),
  template: z.boolean(),
  /** The saved Excalidraw scene without `files`. */
  scene: z.looseObject({ elements: z.array(z.unknown()), appState: z.record(z.string(), z.unknown()).optional() }),
  files: z.record(z.string(), fileEntry),
  /** File records that weren't data URLs, kept as they were. */
  inlineFiles: z.record(z.string(), z.unknown()),
});

export type DrawBackupItem = z.infer<typeof itemSchema>;

export interface DrawBackupDeps {
  db: Database.Database;
  store: DrawingStore;
  /** Tells editors, galleries and Studio a drawing changed (after commit). */
  changed: (id: string, updatedAt: number) => void;
}

function decodeDataUrl(value: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const header = value.slice(5, comma).split(";");
  const mimeType = header[0] || "text/plain";
  if (!MIME.test(mimeType)) return null;
  const body = value.slice(comma + 1);
  try {
    return { mimeType, bytes: header.includes("base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8") };
  } catch {
    return null;
  }
}

function sceneOf(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { elements?: unknown }).elements)) return parsed as Record<string, unknown>;
  } catch { /* stored as an empty scene below */ }
  return { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} };
}

/** Reads one item and its image files synchronously, so a restore fits in one SQLite transaction. */
function readItem(reader: BackupReader, name: string): { item: DrawBackupItem; data: string } {
  const path = reader.path(`items/${name}`);
  if (statSync(path).size > MAX_ITEM_BYTES) throw new Error("The drawing is too large to restore.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a valid drawing: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`).join("; ")}`);
  const item = parsed.data;
  if (!name.endsWith(".json") || !fileSafeIdMatches(item.id, name.slice(0, -5))) throw new Error("The file name doesn't match the drawing id.");
  const files: Record<string, unknown> = { ...item.inlineFiles };
  const prefix = `files/${fileSafeId(item.id)}/`;
  for (const [fileId, entry] of Object.entries(item.files)) {
    if (!entry.path.startsWith(prefix)) throw new Error(`Image ${fileId} points outside its drawing's folder.`);
    const filePath = reader.path(entry.path);
    if (statSync(filePath).size > MAX_FILE_BYTES) throw new Error(`Image ${fileId} is too large to restore.`);
    const bytes = readFileSync(filePath);
    files[fileId] = { ...entry.meta, dataURL: `data:${entry.mimeType};base64,${bytes.toString("base64")}` };
  }
  return { item, data: JSON.stringify({ ...item.scene, files }, null, 2) };
}

export function createDrawBackup(deps: DrawBackupDeps): BackupHandlers {
  const { db, store } = deps;
  return {
    version: DRAW_BACKUP_VERSION,

    async backup(writer: BackupWriter) {
      // One drawing in memory at a time: list ids, then load each row.
      const ids = (db.prepare("SELECT id FROM drawings ORDER BY id").all() as { id: string }[]).map((row) => row.id);
      let drawings = 0;
      let images = 0;
      const notes: string[] = [];
      for (const id of ids) {
        const row = store.get(id);
        if (!row) continue;
        let safe: string;
        try {
          safe = fileSafeId(row.id);
        } catch {
          notes.push(`Skipped drawing ${row.id}: its id can't be a file name.`);
          continue;
        }
        const scene = sceneOf(row.data);
        const sceneFiles = scene.files && typeof scene.files === "object" && !Array.isArray(scene.files) ? (scene.files as Record<string, unknown>) : {};
        delete scene.files;
        const files: DrawBackupItem["files"] = {};
        const inlineFiles: Record<string, unknown> = {};
        let n = 0;
        for (const [fileId, file] of Object.entries(sceneFiles)) {
          const record = file && typeof file === "object" && !Array.isArray(file) ? (file as Record<string, unknown>) : null;
          const decoded = record ? decodeDataUrl(record.dataURL) : null;
          if (!record || !decoded) {
            inlineFiles[fileId] = file;
            continue;
          }
          n += 1;
          const path = `files/${safe}/${n}`;
          await writer.bytesAt(path, decoded.bytes);
          const { dataURL: _dataURL, ...meta } = record;
          files[fileId] = { path, mimeType: decoded.mimeType, meta };
          images += 1;
        }
        const item: DrawBackupItem = {
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          archivedAt: row.archived_at,
          template: row.template !== 0,
          scene: scene as DrawBackupItem["scene"],
          files,
          inlineFiles,
        };
        await writer.json(`items/${safe}.json`, item);
        drawings += 1;
      }
      return { counts: { drawings, images }, notes: notes.slice(0, 50) };
    },

    async restore(reader, { dryRun, projects, tally }) {
      const names = (await reader.list("items")).filter((name) => name.endsWith(".json"));
      const touched: { id: string; updatedAt: number }[] = [];
      const upsert = db.prepare(
        `INSERT INTO drawings (id, name, data, created_at, updated_at, project_id, updated_by, archived_at, template)
         VALUES (@id, @name, @data, @created_at, @updated_at, @project_id, @updated_by, @archived_at, @template)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, created_at = excluded.created_at,
           updated_at = excluded.updated_at, project_id = excluded.project_id, updated_by = excluded.updated_by,
           archived_at = excluded.archived_at, template = excluded.template`,
      );
      const run = () => {
        for (const name of names) {
          const fallback = { id: name.replace(/\.json$/, ""), title: null };
          let read: { item: DrawBackupItem; data: string };
          try {
            read = readItem(reader, name);
          } catch (error) {
            tally.record("failed", fallback, error instanceof Error ? error.message : String(error));
            continue;
          }
          const { item, data } = read;
          const ref = { id: item.id, title: item.name || "Untitled drawing" };
          const local = store.get(item.id);
          const decision = restoreDecision(local?.updated_at ?? null, item.updatedAt);
          tally.decided(decision, ref);
          if (decision !== "create" && decision !== "update") continue;
          const mapped = mapProject(projects, item.projectId);
          // An unknown project leaves an existing drawing where it is here.
          const projectId = mapped.unmapped && local ? local.project_id : mapped.projectId;
          if (mapped.unmapped && !projectId) tally.unmapped(ref);
          if (dryRun) continue;
          const row: DrawingRow = {
            id: item.id,
            name: item.name,
            data,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
            project_id: projectId,
            updated_by: item.updatedBy,
            archived_at: item.archivedAt,
            template: item.template ? 1 : 0,
          };
          upsert.run(row);
          touched.push({ id: item.id, updatedAt: item.updatedAt });
        }
      };
      if (dryRun) run();
      else db.transaction(run).immediate();
      // Open editors reload on this notice; their next autosave sees the new
      // revision and offers a copy instead of overwriting the restored scene.
      for (const { id, updatedAt } of touched) deps.changed(id, updatedAt);
    },
  };
}
