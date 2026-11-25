// Columns Studio adds by checking whether they are there, not by migration
// index. BB's migrate (bb.storage.migrate) records each statement's index and
// refuses to load when a database already has that index with a different
// statement, which happens when a build from another branch appended its own
// migration at the same position. A column added here can't collide that way:
// ensureColumns runs after the migrations at every start, adds what is
// missing and leaves the rest. Each column is nullable, so adding it later is
// always safe.
import type Database from "better-sqlite3";

/** Table → [column, type] added when missing. */
export const ENSURED_COLUMNS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  // The model a Bot's Main last ran on (src/bot.ts), saved whenever Studio reads it, so a new
  // Main can start on it after the old one is deleted and can't be read any more.
  bots: [["main_provider_id", "TEXT"], ["main_model", "TEXT"], ["main_reasoning", "TEXT"]],
  // The strand an item was in before the user's (or a merge's) last move, so it can be undone (src/strands/store.ts).
  // A reply's tag (src/strands/reply.ts): needs-you or status, its ask line, who tagged it, and when the user marked it done.
  // The other strands a message is also about (a JSON array of strand ids; null: none), and a reply's quick replies (its ::next buttons, a JSON array).
  strand_items: [["prev_strand_id", "TEXT"], ["reply_tag", "TEXT"], ["reply_ask", "TEXT"], ["reply_by", "TEXT"], ["reply_resolved_at", "INTEGER"], ["also_strands", "TEXT"], ["reply_quick", "TEXT"], ["quiet", "INTEGER"], ["merge_also", "TEXT"]],
  // When an agent marked a strand done (strand_note): it folds into Earlier until its next activity (src/strands/store.ts).
  // The strand it branched from (parent_id), and "trunk" for the conversation's whole-conversation strand (kind).
  // What a merge changed, so unmerge can put it back: an item's also list (merge_also) and a strand's parent (merge_parent), each a JSON list of {from, value}.
  // A report the reply passed over quietly (quiet = 1): filed, but not what the user was following.
  strands: [["done_at", "INTEGER"], ["parent_id", "TEXT"], ["kind", "TEXT"], ["merge_parent", "TEXT"]],
};

/**
 * Tables Studio creates when missing, for the same reason: no migration
 * index to collide on. Each statement is `CREATE … IF NOT EXISTS`, so it is
 * safe to run at every start; later columns go in ENSURED_COLUMNS.
 */
export const ENSURED_TABLES: readonly string[] = [
  // A conversation's Workspace (src/workbench-agent/store.ts): its tabs, open and closed, and its state.
  `CREATE TABLE IF NOT EXISTS thread_workbench_tabs (
     thread_id TEXT NOT NULL,
     tab_id TEXT NOT NULL,
     position INTEGER,
     ref TEXT NOT NULL,
     item TEXT NOT NULL,
     title TEXT NOT NULL,
     opened_by TEXT NOT NULL,
     opened_at INTEGER NOT NULL,
     dismissed_at INTEGER,
     closed_by TEXT,
     PRIMARY KEY (thread_id, tab_id)
   )`,
  `CREATE INDEX IF NOT EXISTS thread_workbench_tabs_item ON thread_workbench_tabs (thread_id, item)`,
  `CREATE TABLE IF NOT EXISTS thread_workbench_state (
     thread_id TEXT PRIMARY KEY,
     active_tab_id TEXT,
     panel_open INTEGER,
     layout TEXT,
     version INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
];

/** Creates each missing table and index. */
export function ensureTables(db: Database.Database, tables: readonly string[] = ENSURED_TABLES): void {
  for (const statement of tables) db.exec(statement);
}

/** Adds each missing column (a table that isn't there yet is left alone); returns what it added. */
export function ensureColumns(db: Database.Database, columns: Readonly<Record<string, readonly (readonly [string, string])[]>> = ENSURED_COLUMNS): string[] {
  const added: string[] = [];
  for (const [table, wanted] of Object.entries(columns)) {
    const have = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name));
    if (!have.size) continue;
    for (const [name, type] of wanted) {
      if (have.has(name)) continue;
      db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
      added.push(`${table}.${name}`);
    }
  }
  return added;
}
