// Copies the old Draw plugin's drawings into Studio, where drawings are
// built in now. Rows go in batches (by count and by scene size: images make
// scenes large), with the editor's recovery-copy keys. Each drawing Studio
// has (copied now or before) gets a `migrated:<id>` marker, so a rerun only
// sends what's left. Malformed rows are listed, kept here, and never sent.
// The bridge never writes drawings, so once every row has a marker the copy
// is complete.
import { IMPORT_BATCH, IMPORT_BATCH_CHARS, importDrawingSchema, type ImportDrawing, type MigrationStatus } from "@bb-studio/kit/draw-contract";
import type Database from "better-sqlite3";

/** BB checks each statement's hash: this is the old plugin's statement, byte for byte. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS drawings (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       data TEXT NOT NULL DEFAULT '{}',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       project_id TEXT,
       updated_by TEXT,
       archived_at INTEGER,
       template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE IF NOT EXISTS drawing_recovery_copies (
       recovery_key TEXT PRIMARY KEY,
       drawing_id TEXT NOT NULL
     );`,
];

export const MIGRATED = "migrated:";

/** What the copy needs from Studio: its `drawings.importRows` method. */
export interface StudioImport {
  importRows(drawings: ImportDrawing[]): Promise<{ imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] }>;
}

export interface Markers {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

type Row = Record<string, unknown>;

/** A row in the import shape, or why it can't be copied. */
export function readDrawing(db: Database.Database, row: Row): { item: ImportDrawing } | { reason: string } {
  const keys = db.prepare("SELECT recovery_key FROM drawing_recovery_copies WHERE drawing_id = ? ORDER BY recovery_key").all(row.id) as { recovery_key: string }[];
  const parsed = importDrawingSchema.safeParse({
    id: row.id,
    name: row.name,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectId: row.project_id,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    template: row.template === 1,
    recoveryKeys: keys.map((key) => key.recovery_key),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { reason: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}` };
  }
  try {
    JSON.parse(parsed.data.data);
  } catch {
    return { reason: "Its scene isn't valid JSON." };
  }
  return { item: parsed.data };
}

/** Batches of at most IMPORT_BATCH rows and IMPORT_BATCH_CHARS of scene; a larger row goes alone. */
export function batches(items: ImportDrawing[]): ImportDrawing[][] {
  const out: ImportDrawing[][] = [];
  let current: ImportDrawing[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= IMPORT_BATCH || chars + item.data.length > IMPORT_BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.data.length;
  }
  if (current.length) out.push(current);
  return out;
}

export async function migrate(db: Database.Database, studio: StudioImport, markers: Markers): Promise<Omit<MigrationStatus, "error">> {
  const ids = db.prepare("SELECT id FROM drawings ORDER BY created_at, id").all() as { id: string }[];
  const get = db.prepare("SELECT * FROM drawings WHERE id = ?");
  const skipped: { id: string; reason: string }[] = [];
  let copied = 0;
  let pending: ImportDrawing[] = [];
  let pendingChars = 0;
  const flush = async () => {
    for (const batch of batches(pending)) {
      const result = await studio.importRows(batch);
      for (const id of [...result.imported, ...result.existing]) {
        await markers.set(`${MIGRATED}${id}`, { at: Date.now() });
        copied++;
      }
      skipped.push(...result.skipped);
    }
    pending = [];
    pendingChars = 0;
  };
  // Scenes are read a batch at a time: together they can be larger than memory wants.
  for (const { id } of ids) {
    if ((await markers.get(`${MIGRATED}${id}`)) != null) { copied++; continue; }
    const read = readDrawing(db, get.get(id) as Row);
    if ("reason" in read) { skipped.push({ id, reason: read.reason }); continue; }
    pending.push(read.item);
    pendingChars += read.item.data.length;
    if (pending.length >= IMPORT_BATCH || pendingChars >= IMPORT_BATCH_CHARS) await flush();
  }
  await flush();
  // Skipped rows can't be copied by trying again; they're listed, not waited on.
  return { complete: copied + skipped.length === ids.length, total: ids.length, copied, skipped };
}
