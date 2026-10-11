// Copies the old Artifacts plugin's rows into Studio, where artifacts are
// built in now. Blobs go first, one per call, and only those Studio lacks;
// then the artifact rows and their versions' metadata, in batches. Each
// artifact Studio has (copied now or before) gets a `migrated:<id>` marker,
// so a rerun only sends what's left. Malformed rows are listed, kept here,
// and never sent. The bridge never writes artifacts, so once every row has a
// marker the copy is complete.
import { IMPORT_BATCH, importArtifactSchema, type ImportArtifact, type MigrationStatus } from "@bb-studio/kit/artifacts-contract";
import type Database from "better-sqlite3";

/** BB checks each statement's hash: this is the old plugin's statement, byte for byte. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS artifacts (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       project_id TEXT,
       source_thread_id TEXT,
       source_path TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       updated_by TEXT,
       archived_at INTEGER
     );
   CREATE UNIQUE INDEX IF NOT EXISTS artifacts_source ON artifacts (source_thread_id, source_path)
     WHERE source_thread_id IS NOT NULL AND source_path IS NOT NULL;
   CREATE TABLE IF NOT EXISTS artifact_versions (
       id TEXT PRIMARY KEY,
       artifact_id TEXT NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
       number INTEGER NOT NULL,
       name TEXT NOT NULL,
       mime TEXT NOT NULL,
       size INTEGER NOT NULL,
       sha256 TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       UNIQUE (artifact_id, number)
     );
   CREATE TABLE IF NOT EXISTS artifact_blobs (
       sha256 TEXT PRIMARY KEY,
       bytes BLOB NOT NULL
     );`,
];

export const MIGRATED = "migrated:";

/** What the copy needs from Studio: the `artifacts.*` import methods. */
export interface StudioImport {
  missingBlobs(sha256: string[]): Promise<string[]>;
  importBlob(sha256: string, bytes: Buffer): Promise<void>;
  importRows(artifacts: ImportArtifact[]): Promise<{ imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] }>;
}

export interface Markers {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

type Row = Record<string, unknown>;

/** A row and its versions in the import shape, or why it can't be copied. */
export function readArtifact(db: Database.Database, row: Row): { item: ImportArtifact } | { reason: string } {
  const versions = db.prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY number").all(row.id) as Row[];
  const parsed = importArtifactSchema.safeParse({
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    sourceThreadId: row.source_thread_id,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    versions: versions.map((version) => ({
      id: version.id, number: version.number, name: version.name, mime: version.mime, size: version.size, sha256: version.sha256, createdAt: version.created_at,
    })),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { reason: versions.length ? `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}` : "It has no versions." };
  }
  const hasBlob = db.prepare("SELECT 1 FROM artifact_blobs WHERE sha256 = ?");
  const lost = parsed.data.versions.filter((version) => !hasBlob.get(version.sha256));
  if (lost.length) return { reason: `The files of ${lost.length} of its versions are missing.` };
  return { item: parsed.data };
}

export async function migrate(db: Database.Database, studio: StudioImport, markers: Markers): Promise<Omit<MigrationStatus, "error">> {
  const rows = db.prepare("SELECT * FROM artifacts ORDER BY created_at, id").all() as Row[];
  const skipped: { id: string; reason: string }[] = [];
  const pending: ImportArtifact[] = [];
  let copied = 0;
  for (const row of rows) {
    const id = String(row.id);
    if ((await markers.get(`${MIGRATED}${id}`)) != null) { copied++; continue; }
    const read = readArtifact(db, row);
    if ("reason" in read) skipped.push({ id, reason: read.reason });
    else pending.push(read.item);
  }
  // Blobs first, so every row Studio takes has its files.
  const hashes = [...new Set(pending.flatMap((item) => item.versions.map((version) => version.sha256)))];
  const blob = db.prepare("SELECT bytes FROM artifact_blobs WHERE sha256 = ?");
  for (let offset = 0; offset < hashes.length; offset += 1000) {
    for (const sha256 of await studio.missingBlobs(hashes.slice(offset, offset + 1000))) {
      await studio.importBlob(sha256, (blob.get(sha256) as { bytes: Buffer }).bytes);
    }
  }
  for (let offset = 0; offset < pending.length; offset += IMPORT_BATCH) {
    const batch = pending.slice(offset, offset + IMPORT_BATCH);
    const result = await studio.importRows(batch);
    for (const id of [...result.imported, ...result.existing]) {
      await markers.set(`${MIGRATED}${id}`, { at: Date.now() });
      copied++;
    }
    skipped.push(...result.skipped);
  }
  // Skipped rows can't be copied by trying again; they're listed, not waited on.
  return { complete: copied + skipped.length === rows.length, total: rows.length, copied, skipped };
}
