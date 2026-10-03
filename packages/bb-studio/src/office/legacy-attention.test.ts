import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { importLegacyAttention, legacyAttentionImported, legacyAttentionSource } from "./legacy-attention";

it("copies attention before retirement and preserves local resolution across replay", async () => {
  const core=new Database(":memory:"),teams=new Database(":memory:");
  teams.exec(`CREATE TABLE channel_attention(id TEXT PRIMARY KEY,room_id TEXT,status TEXT,snoozed_until INTEGER,json TEXT);
    CREATE TABLE room_messages(id TEXT PRIMARY KEY,json TEXT);
    CREATE TABLE conversations(id TEXT PRIMARY KEY,project_id TEXT,json TEXT);
    INSERT INTO channel_attention VALUES ('a','room','open',NULL,'{"reason":"blocker","createdAt":1}');
    INSERT INTO room_messages VALUES ('a','{"text":"Need a decision","botId":"bot","sourceThreadId":"thread"}');
    INSERT INTO conversations VALUES ('room','work','{"name":"Release"}');`);
  expect(legacyAttentionImported(core,teams,["a"])).toBe(false);
  importLegacyAttention(core,teams);
  expect(legacyAttentionImported(core,teams,["a"])).toBe(true);
  const source=legacyAttentionSource(core); const [event]=await source.list();
  expect(event).toMatchObject({projectId:"work",body:"Need a decision",type:"request",botId:"bot"});
  await source.act(event!,"resolve");
  importLegacyAttention(core,teams);
  expect(await legacyAttentionSource(core).list()).toEqual([]);
  teams.exec("UPDATE channel_attention SET status='snoozed' WHERE id='a'");
  expect(legacyAttentionImported(core,teams,["a"])).toBe(false);
  core.close(); teams.close();
});
