import type Database from "better-sqlite3";
import { PERSONAL_PROJECT_ID } from "./migration";

type JsonRow = { id: string; json: string };
/** Runs after the Teams module's historical schema migrations. All metadata is
 * preserved; callers update live profile threads to the mapped permission mode. */
export function migrateTeamOffice(db: Database.Database, projectForThread: (id: string) => string | null | undefined): void {
  db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS office_team_migrations (id TEXT PRIMARY KEY)");
    if (db.prepare("SELECT 1 FROM office_team_migrations WHERE id='office-v1'").get()) return;
    db.exec(`ALTER TABLE conversations RENAME TO bot_threads;
      ALTER TABLE thread_views RENAME TO conversations;
      ALTER TABLE view_threads RENAME TO conversation_threads;
      ALTER TABLE conversation_threads RENAME COLUMN view_id TO conversation_id;
      ALTER TABLE view_entries RENAME TO conversation_entries;
      ALTER TABLE view_sends RENAME TO conversation_sends;
      ALTER TABLE conversation_sends RENAME COLUMN view_id TO conversation_id;
      ALTER TABLE bots ADD COLUMN trust TEXT NOT NULL DEFAULT 'ask' CHECK(trust IN ('ask','act'));
      ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'proj_personal';`);
    const bots = new Map<string, { projectId: string }>();
    for (const row of db.prepare("SELECT id,json FROM bots").all() as JsonRow[]) {
      const bot = JSON.parse(row.json) as Record<string, unknown>;
      const trust = bot.trust === "act" ? "act" : "ask";
      const projectId = typeof bot.projectId === "string" && bot.projectId ? bot.projectId : PERSONAL_PROJECT_ID;
      bots.set(row.id, { projectId });
      db.prepare("UPDATE bots SET trust=?,json=? WHERE id=?").run(trust, JSON.stringify({ ...bot, trust, projectId, permissionMode: trust === "ask" ? "accept-edits" : "auto" }), row.id);
    }
    for (const row of db.prepare("SELECT id,json FROM conversations").all() as JsonRow[]) {
      const conversation = JSON.parse(row.json) as { members?: { kind: string; id: string }[]; projectId?: string };
      // Explicit ownership wins; old channels use the first resolvable member.
      const projectId = conversation.projectId || conversation.members?.map(m => m.kind === "bot" ? bots.get(m.id)?.projectId : projectForThread(m.id)).find(p => p) || PERSONAL_PROJECT_ID;
      db.prepare("UPDATE conversations SET project_id=?,json=? WHERE id=?").run(projectId, JSON.stringify({ ...conversation, projectId }), row.id);
    }
    db.prepare("INSERT INTO office_team_migrations VALUES ('office-v1')").run();
  })();
}

/** Retired transcripts are accessible as historical conversation records, never
 * replayed as new bot input. Archive exact rows before dropping the old tables.
 * The caller must import channel_attention into the core Inbox first. */
export function retireRoomTables(db: Database.Database, attentionImported: (ids: readonly string[]) => boolean): void {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM office_team_migrations WHERE id='retired-rooms-v1'").get()) return;
    const pending = db.prepare("SELECT id FROM rooms WHERE id NOT IN (SELECT room_id FROM view_migrations)").all() as { id: string }[];
    if (pending.length) throw new Error(`Finish conversation migration before retiring ${pending.length} room(s).`);
    const ids = (db.prepare("SELECT id FROM channel_attention").all() as { id: string }[]).map(r => r.id);
    if (!attentionImported(ids)) throw new Error("Import every channel attention record into Inbox before retiring rooms.");
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_legacy_records (
      conversation_id TEXT NOT NULL, source_table TEXT NOT NULL, row_key TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(source_table,row_key)
    )`);
    for (const table of ["rooms", "room_messages", "room_runs", "delegations", "channel_attention"] as const) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      for (const row of rows) {
        const id = String(row.id);
        db.prepare("INSERT OR IGNORE INTO conversation_legacy_records VALUES (?,?,?,?)").run(String(row.room_id ?? row.id), table, id, JSON.stringify(row));
        const stored = db.prepare("SELECT payload FROM conversation_legacy_records WHERE source_table=? AND row_key=?").get(table,id) as { payload: string };
        if (stored.payload !== JSON.stringify(row)) throw new Error(`Archive differs for ${table}:${id}`);
      }
      db.exec(`DROP TABLE ${table}`);
    }
    db.prepare("INSERT INTO office_team_migrations VALUES ('retired-rooms-v1')").run();
  })();
}
