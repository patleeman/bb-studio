// Copies the old Studio Pages plugin's data into Studio, where Pages is built
// in now. Page by page, oldest first: its uploaded files (one per call, only
// the ones Studio lacks), then its saved versions (in batches by count and
// size), then the page itself with its chats, request history and checklist
// hand-offs, in batches by count and size (a larger page goes alone). Pages
// are read a batch at a time: a long-edited page's Yjs state can be large.
// Each page Studio has (copied now or before) gets a `migrated:<id>` marker,
// so a rerun only sends what's left. Malformed pages are listed, kept here
// and never sent. Then the Next row's click log from explore.db, and the
// user's settings once. The bridge never writes pages, so once every page has
// a marker or is skipped the copy is complete.
import {
  IMPORT_BATCH, IMPORT_BATCH_BYTES, NEXT_IMPORT_BATCH,
  importFileSchema, importNextSuggestionSchema, importPageSchema, importSnapshotSchema,
  type ImportFile, type ImportNextSuggestion, type ImportPage, type ImportSnapshot, type MigrationStatus, type PagesSettings,
} from "@bb-studio/kit/pages-contract";
import type Database from "better-sqlite3";

/** BB checks each statement's hash: these are the old plugin's statements, byte for byte. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS pages (
     id TEXT PRIMARY KEY,
     project_id TEXT,
     parent_id TEXT,
     title TEXT NOT NULL DEFAULT '',
     icon TEXT NOT NULL DEFAULT '',
     position REAL NOT NULL DEFAULT 0,
     state BLOB,
     markdown TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT NOT NULL DEFAULT '',
     archived_at INTEGER,
     refresh_bot_id TEXT,
     refresh_cron TEXT,
     refresh_instructions TEXT NOT NULL DEFAULT '',
     refresh_last_at INTEGER
   , template INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     state BLOB NOT NULL,
     label TEXT NOT NULL,
     actor TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS files (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS requests (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     bot_id TEXT NOT NULL,
     bot_name TEXT NOT NULL,
     thread_id TEXT,
     kind TEXT NOT NULL,
     block_id TEXT,
     comment_thread_id TEXT,
     summary TEXT NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     result TEXT,
     dedupe_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     thread_id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS checklist_handoffs (
     thread_id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL,
     block_id TEXT NOT NULL,
     title TEXT NOT NULL,
     state TEXT NOT NULL,
     note TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS pages_parent ON pages (project_id, parent_id, position)`,
  `CREATE INDEX IF NOT EXISTS snapshots_page ON snapshots (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS requests_page ON requests (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS requests_thread ON requests (thread_id, status)`,
  `CREATE INDEX IF NOT EXISTS chats_page ON chats (page_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS checklist_handoffs_page ON checklist_handoffs (page_id, created_at)`,
  // Bot workers were retired. Keep history, but never show old requests as live work.
  `UPDATE requests SET status = 'failed',
     error = COALESCE(NULLIF(error, ''), 'Bot profile automation was retired. Start a page chat to continue.'),
     updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
   WHERE status IN ('queued', 'working')`,
];

export const MIGRATED = "migrated:";
/** Set once the Next row's click log is in Studio. */
export const NEXT_MIGRATED = "migrated-next-suggestions";

type Result = { imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] };

/** What the copy needs from Studio: its `pages.*` and `explore.*` bridge methods. */
export interface StudioImport {
  missingFiles(ids: string[]): Promise<{ missing: string[] }>;
  importFile(file: ImportFile): Promise<{ ok: boolean }>;
  importSnapshots(snapshots: ImportSnapshot[]): Promise<Result>;
  importRows(pages: ImportPage[]): Promise<Result>;
  importNext(rows: ImportNextSuggestion[]): Promise<{ imported: number; existing: number }>;
  importSettings(settings: PagesSettings): Promise<{ applied: string[] }>;
}

export interface Markers {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface MigrateOptions {
  /** The old explore.db (the Next row's click log), or null when there's none. */
  explore: Database.Database | null;
  /** What the user had set in Pages' settings. */
  settings(): Promise<PagesSettings>;
}

type Row = Record<string, unknown>;

const reasonOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const issue = error.issues[0];
  return `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`;
};
const base64 = (value: unknown) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value);

/** A page row with its chats, requests and hand-offs, in the import shape, or why it can't be copied. */
export function readPage(db: Database.Database, row: Row): { item: ImportPage } | { reason: string } {
  const chats = db.prepare("SELECT thread_id, created_at FROM chats WHERE page_id = ? ORDER BY created_at, thread_id").all(row.id) as Row[];
  const requests = db.prepare("SELECT * FROM requests WHERE page_id = ? ORDER BY created_at, id").all(row.id) as Row[];
  const handoffs = db.prepare("SELECT * FROM checklist_handoffs WHERE page_id = ? ORDER BY created_at, thread_id").all(row.id) as Row[];
  const parsed = importPageSchema.safeParse({
    id: row.id, projectId: row.project_id, parentId: row.parent_id, title: row.title, icon: row.icon, position: row.position,
    state: row.state == null ? null : base64(row.state), markdown: row.markdown, createdAt: row.created_at, updatedAt: row.updated_at,
    updatedBy: row.updated_by, archivedAt: row.archived_at, template: row.template === 1,
    refresh: { botId: row.refresh_bot_id, cron: row.refresh_cron, instructions: row.refresh_instructions, lastAt: row.refresh_last_at },
    chats: chats.map((each) => ({ threadId: each.thread_id, createdAt: each.created_at })),
    requests: requests.map((each) => ({
      id: each.id, botId: each.bot_id, botName: each.bot_name, threadId: each.thread_id, kind: each.kind, blockId: each.block_id,
      commentThreadId: each.comment_thread_id, summary: each.summary, status: each.status, error: each.error, result: each.result,
      dedupeKey: each.dedupe_key, createdAt: each.created_at, updatedAt: each.updated_at,
    })),
    checklistHandoffs: handoffs.map((each) => ({
      threadId: each.thread_id, blockId: each.block_id, title: each.title, state: each.state, note: each.note, createdAt: each.created_at, updatedAt: each.updated_at,
    })),
  });
  return parsed.success ? { item: parsed.data } : { reason: reasonOf(parsed.error) };
}

/** A page's size on the wire: its Yjs state and Markdown. */
const pageSize = (item: ImportPage) => (item.state?.length ?? 0) + item.markdown.length;
const snapshotSize = (item: ImportSnapshot) => item.state.length;

/** Batches of at most IMPORT_BATCH items and IMPORT_BATCH_BYTES; a larger item goes alone. */
export function batches<T>(items: T[], size: (item: T) => number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length && (current.length >= IMPORT_BATCH || bytes + size(item) > IMPORT_BATCH_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size(item);
  }
  if (current.length) out.push(current);
  return out;
}

/** A page's files and versions, which go to Studio before the page does. Throws when Studio refuses one, so the copy retries. */
async function sendParts(db: Database.Database, studio: StudioImport, pageId: string): Promise<void> {
  const fileIds = (db.prepare("SELECT id FROM files WHERE page_id = ? ORDER BY created_at, id").all(pageId) as { id: string }[]).map((row) => row.id);
  if (fileIds.length) {
    const { missing } = await studio.missingFiles(fileIds);
    const read = db.prepare("SELECT * FROM files WHERE id = ?");
    // One file per call, read when it's sent: a file can be 15 MB.
    for (const id of missing) {
      const row = read.get(id) as Row | undefined;
      if (!row) continue;
      const parsed = importFileSchema.safeParse({ id: row.id, pageId: row.page_id, name: row.name, mime: row.mime, size: row.size, createdAt: row.created_at, data: base64(row.data) });
      if (!parsed.success) throw new Error(`File ${id} of page ${pageId} can't be copied: ${reasonOf(parsed.error)}`);
      await studio.importFile(parsed.data);
    }
  }
  const snapshots: ImportSnapshot[] = [];
  for (const row of db.prepare("SELECT * FROM snapshots WHERE page_id = ? ORDER BY created_at, rowid").all(pageId) as Row[]) {
    const parsed = importSnapshotSchema.safeParse({ id: row.id, pageId: row.page_id, state: base64(row.state), label: row.label, actor: row.actor, createdAt: row.created_at });
    // A malformed version stays behind; the page still goes.
    if (parsed.success) snapshots.push(parsed.data);
  }
  for (const batch of batches(snapshots, snapshotSize)) {
    const result = await studio.importSnapshots(batch);
    if (result.skipped.length) throw new Error(`Studio refused versions of page ${pageId}: ${result.skipped.map((each) => `${each.id} (${each.reason})`).join(", ")}`);
  }
}

/** The Next row's click log, once. */
async function sendNext(explore: Database.Database | null, studio: StudioImport, markers: Markers): Promise<void> {
  if (!explore || (await markers.get(NEXT_MIGRATED)) != null) return;
  const table = explore.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'next_suggestions'").get();
  let count = 0;
  if (table) {
    const rows = explore.prepare("SELECT * FROM next_suggestions ORDER BY shown_at, key").all() as Row[];
    const valid: ImportNextSuggestion[] = [];
    for (const row of rows) {
      const parsed = importNextSuggestionSchema.safeParse({
        key: row.key, threadId: row.thread_id, messageId: row.message_id, kind: row.kind, emoji: row.emoji, label: row.label,
        shownAt: row.shown_at, clickedAt: row.clicked_at, clicks: row.clicks,
      });
      // Malformed suggestions are only statistics; they're left out.
      if (parsed.success) valid.push(parsed.data);
    }
    for (let start = 0; start < valid.length; start += NEXT_IMPORT_BATCH) await studio.importNext(valid.slice(start, start + NEXT_IMPORT_BATCH));
    count = valid.length;
  }
  await markers.set(NEXT_MIGRATED, { at: Date.now(), count });
}

export async function migrate(db: Database.Database, studio: StudioImport, markers: Markers, options: MigrateOptions): Promise<Omit<MigrationStatus, "error">> {
  const ids = db.prepare("SELECT id FROM pages ORDER BY created_at, id").all() as { id: string }[];
  const get = db.prepare("SELECT * FROM pages WHERE id = ?");
  const skipped: { id: string; reason: string }[] = [];
  let copied = 0;
  let pending: ImportPage[] = [];
  let pendingBytes = 0;
  const flush = async () => {
    for (const batch of batches(pending, pageSize)) {
      const result = await studio.importRows(batch);
      for (const id of [...result.imported, ...result.existing]) {
        await markers.set(`${MIGRATED}${id}`, { at: Date.now() });
        copied++;
      }
      skipped.push(...result.skipped);
    }
    pending = [];
    pendingBytes = 0;
  };
  for (const { id } of ids) {
    if ((await markers.get(`${MIGRATED}${id}`)) != null) { copied++; continue; }
    const read = readPage(db, get.get(id) as Row);
    if ("reason" in read) { skipped.push({ id, reason: read.reason }); continue; }
    await sendParts(db, studio, id);
    pending.push(read.item);
    pendingBytes += pageSize(read.item);
    if (pending.length >= IMPORT_BATCH || pendingBytes >= IMPORT_BATCH_BYTES) await flush();
  }
  await flush();
  await sendNext(options.explore, studio, markers);
  await studio.importSettings(await options.settings());
  // Skipped pages can't be copied by trying again; they're listed, not waited on.
  return { complete: copied + skipped.length === ids.length, total: ids.length, copied, skipped };
}
