// Copies the old Studio Design plugin's designs and saved styles into
// Studio, where designs are built in now. Designs go in batches (by count
// and by screen HTML size), each with its rounds, screens, comments and
// conversation. Each row Studio has (copied now or before) gets a
// `migrated:<id>` marker (`migrated-style:<id>` for styles), so a rerun only
// sends what's left. Malformed rows are listed, kept here, and never sent.
// The bridge never writes designs, so once every row has a marker or is
// skipped the copy is complete.
import { IMPORT_BATCH, IMPORT_BATCH_CHARS, importDesignSchema, importStyleSchema, type ImportDesign, type ImportStyle, type MigrationStatus } from "@bb-studio/kit/design-contract";
import type Database from "better-sqlite3";

/** BB checks each statement's hash: these are the old plugin's statements, byte for byte. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS designs (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       project_id TEXT,
       updated_by TEXT,
       archived_at INTEGER,
       template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE IF NOT EXISTS design_rounds (
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       round INTEGER NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       intro TEXT NOT NULL DEFAULT '',
       PRIMARY KEY (design_id, round)
     );
   CREATE TABLE IF NOT EXISTS design_screens (
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       id TEXT NOT NULL,
       round INTEGER NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       caption TEXT NOT NULL DEFAULT '',
       viewport TEXT NOT NULL DEFAULT 'desktop',
       html TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (design_id, id)
     );`,
  `ALTER TABLE designs ADD COLUMN thread_id TEXT;`,
  `CREATE TABLE IF NOT EXISTS design_comments (
       id TEXT PRIMARY KEY,
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       screen_id TEXT NOT NULL,
       selector TEXT NOT NULL,
       element_html TEXT NOT NULL DEFAULT '',
       element_text TEXT NOT NULL DEFAULT '',
       body TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       sent_at INTEGER,
       resolved_at INTEGER
     );
   CREATE INDEX IF NOT EXISTS design_comments_design ON design_comments(design_id, created_at);`,
  `ALTER TABLE design_comments ADD COLUMN step TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS design_styles (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       notes TEXT NOT NULL DEFAULT '',
       css TEXT NOT NULL,
       source_design_id TEXT,
       source_screen_id TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );`,
];

export const MIGRATED = "migrated:";
export const MIGRATED_STYLE = "migrated-style:";

type Result = { imported: string[]; existing: string[]; skipped: { id: string; reason: string }[] };

/** What the copy needs from Studio: its `designs.importRows` and `designs.importStyles` methods. */
export interface StudioImport {
  importRows(designs: ImportDesign[]): Promise<Result>;
  importStyles(styles: ImportStyle[]): Promise<Result>;
}

export interface Markers {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

type Row = Record<string, unknown>;

const reasonOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const issue = error.issues[0];
  return `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`;
};

/** A design row with its rounds, screens and comments, in the import shape, or why it can't be copied. */
export function readDesign(db: Database.Database, row: Row): { item: ImportDesign } | { reason: string } {
  const rounds = db.prepare("SELECT round, title, intro FROM design_rounds WHERE design_id = ? ORDER BY round").all(row.id) as Row[];
  const screens = db.prepare("SELECT * FROM design_screens WHERE design_id = ? ORDER BY round, id").all(row.id) as Row[];
  const comments = db.prepare("SELECT * FROM design_comments WHERE design_id = ? ORDER BY created_at, id").all(row.id) as Row[];
  const parsed = importDesignSchema.safeParse({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectId: row.project_id,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    template: row.template === 1,
    threadId: row.thread_id ?? null,
    rounds: rounds.map((each) => ({ round: each.round, title: each.title, intro: each.intro })),
    screens: screens.map((each) => ({ id: each.id, round: each.round, title: each.title, caption: each.caption, viewport: each.viewport, html: each.html, createdAt: each.created_at, updatedAt: each.updated_at })),
    comments: comments.map((each) => ({
      id: each.id, screenId: each.screen_id, step: each.step ?? "", selector: each.selector, elementHtml: each.element_html, elementText: each.element_text,
      body: each.body, createdAt: each.created_at, sentAt: each.sent_at, resolvedAt: each.resolved_at,
    })),
  });
  return parsed.success ? { item: parsed.data } : { reason: reasonOf(parsed.error) };
}

export function readStyle(row: Row): { item: ImportStyle } | { reason: string } {
  const parsed = importStyleSchema.safeParse({
    id: row.id, name: row.name, notes: row.notes, css: row.css, sourceDesignId: row.source_design_id, sourceScreenId: row.source_screen_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
  return parsed.success ? { item: parsed.data } : { reason: reasonOf(parsed.error) };
}

/** A design's size on the wire: its screens' HTML. */
const size = (item: ImportDesign) => item.screens.reduce((sum, screen) => sum + screen.html.length, 0);

/** Batches of at most IMPORT_BATCH designs and IMPORT_BATCH_CHARS of HTML; a larger design goes alone. */
export function batches(items: ImportDesign[]): ImportDesign[][] {
  const out: ImportDesign[][] = [];
  let current: ImportDesign[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length && (current.length >= IMPORT_BATCH || chars + size(item) > IMPORT_BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size(item);
  }
  if (current.length) out.push(current);
  return out;
}

export async function migrate(db: Database.Database, studio: StudioImport, markers: Markers): Promise<Omit<MigrationStatus, "error">> {
  const ids = db.prepare("SELECT id FROM designs ORDER BY created_at, id").all() as { id: string }[];
  const styleRows = db.prepare("SELECT * FROM design_styles ORDER BY created_at, id").all() as Row[];
  const get = db.prepare("SELECT * FROM designs WHERE id = ?");
  const skipped: { id: string; reason: string }[] = [];
  let copied = 0;
  let pending: ImportDesign[] = [];
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
  // Designs are read a batch at a time: their screens can be large.
  for (const { id } of ids) {
    if ((await markers.get(`${MIGRATED}${id}`)) != null) { copied++; continue; }
    const read = readDesign(db, get.get(id) as Row);
    if ("reason" in read) { skipped.push({ id, reason: read.reason }); continue; }
    pending.push(read.item);
    pendingChars += size(read.item);
    if (pending.length >= IMPORT_BATCH || pendingChars >= IMPORT_BATCH_CHARS) await flush();
  }
  await flush();

  // Saved styles: small, so in batches by count.
  const styles: ImportStyle[] = [];
  for (const row of styleRows) {
    const id = String(row.id);
    if ((await markers.get(`${MIGRATED_STYLE}${id}`)) != null) { copied++; continue; }
    const read = readStyle(row);
    if ("reason" in read) skipped.push({ id, reason: read.reason });
    else styles.push(read.item);
  }
  for (let start = 0; start < styles.length; start += IMPORT_BATCH) {
    const result = await studio.importStyles(styles.slice(start, start + IMPORT_BATCH));
    for (const id of [...result.imported, ...result.existing]) {
      await markers.set(`${MIGRATED_STYLE}${id}`, { at: Date.now() });
      copied++;
    }
    skipped.push(...result.skipped);
  }
  // Skipped rows can't be copied by trying again; they're listed, not waited on.
  const total = ids.length + styleRows.length;
  return { complete: copied + skipped.length === total, total, copied, skipped };
}
