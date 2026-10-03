import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateTeamOffice, retireRoomTables } from "./team-migration";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE bots(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE conversations(id TEXT PRIMARY KEY,bot_id TEXT,key TEXT,thread_id TEXT,json TEXT);
    CREATE TABLE thread_views(id TEXT PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE view_threads(view_id TEXT,thread_id TEXT,bot_id TEXT);
    CREATE TABLE view_entries(id TEXT PRIMARY KEY,thread_id TEXT,created_at INTEGER,json TEXT);
    CREATE TABLE view_sends(id TEXT PRIMARY KEY,view_id TEXT,json TEXT);
    CREATE TABLE view_migrations(room_id TEXT PRIMARY KEY,completed_at INTEGER);
    CREATE TABLE rooms(id TEXT PRIMARY KEY,json TEXT);
    CREATE TABLE room_messages(id TEXT PRIMARY KEY,room_id TEXT,json TEXT);
    CREATE TABLE room_runs(id TEXT PRIMARY KEY,room_id TEXT,json TEXT);
    CREATE TABLE delegations(id TEXT PRIMARY KEY,room_id TEXT,run_id TEXT,status TEXT,json TEXT);
    CREATE TABLE channel_attention(id TEXT PRIMARY KEY,room_id TEXT,status TEXT,snoozed_until INTEGER,json TEXT);
    INSERT INTO bots VALUES ('bot','{"name":"Archivist","projectId":null,"permissionMode":"full","mission":"Keep every word"}');
    INSERT INTO conversations VALUES ('profile','bot','thread:t','t','{"keep":true}');
    INSERT INTO thread_views VALUES ('room','{"name":"History","members":[{"kind":"bot","id":"bot"}]}');
    INSERT INTO rooms VALUES ('room','{"name":"History"}');
    INSERT INTO room_messages VALUES ('message','room','{"text":"Original transcript"}');
    INSERT INTO channel_attention VALUES ('attention','room','open',NULL,'{"reason":"decision"}');`);
  const copy = new Database(db.serialize()); db.close(); return copy;
}

it("renames profile links and conversations without losing metadata and defaults trust to ask", () => {
  const db = fixture(); migrateTeamOffice(db, () => null);
  expect(db.prepare("SELECT * FROM bot_threads").all()).toHaveLength(1);
  const bot = db.prepare("SELECT trust,json FROM bots").get() as { trust:string;json:string };
  expect(bot.trust).toBe("ask");
  expect(JSON.parse(bot.json)).toMatchObject({ mission:"Keep every word",projectId:"proj_personal",permissionMode:"accept-edits" });
  expect(db.prepare("SELECT project_id FROM conversations").get()).toEqual({ project_id:"proj_personal" });
  const before=db.serialize(); migrateTeamOffice(db,()=>null); expect(db.serialize()).toEqual(before); db.close();
});

it("refuses early deletion and archives every exact row after Inbox import", () => {
  const db=fixture(); migrateTeamOffice(db,()=>null);
  expect(()=>retireRoomTables(db,()=>true)).toThrow("Finish conversation migration");
  db.exec("INSERT INTO view_migrations VALUES ('room',1)");
  expect(()=>retireRoomTables(db,()=>false)).toThrow("Import every channel attention");
  expect(db.prepare("SELECT json FROM room_messages").get()).toEqual({json:'{"text":"Original transcript"}'});
  retireRoomTables(db,ids=>ids.length===1 && ids[0]==="attention");
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='room_messages'").get()).toBeUndefined();
  const rows=db.prepare("SELECT payload FROM conversation_legacy_records").all() as {payload:string}[];
  expect(rows).toHaveLength(3); expect(rows.some(r=>r.payload.includes("Original transcript"))).toBe(true);
  const before=db.serialize(); retireRoomTables(db,()=>true); expect(db.serialize()).toEqual(before); db.close();
});
