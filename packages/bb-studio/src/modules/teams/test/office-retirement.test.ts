import Database from "better-sqlite3";
import { expect, it } from "vitest";
import plugin from "../server";
import { setup } from "./bots-fixture";
import { ThreadProfiles } from "../thread-profiles";
import { ThreadViews } from "../thread-views";
import { migrateViews } from "../view-migration";
import { importLegacyAttention, legacyAttentionImported } from "../../../office/legacy-attention";
import { retireRoomTables } from "../../../office/team-migration";
import { OfficeConversations } from "../../../office/conversations";

it("boots and serves Talk after archiving legacy rooms and dropping their tables", async () => {
  const x = setup(), core = new Database(":memory:");
  try {
    const profiles = new ThreadProfiles(x.bb, x.store, x.runtime, () => true);
    const views = new ThreadViews(x.bb, x.store, profiles);
    await migrateViews(x.bb, x.store, x.runtime, profiles, views);
    importLegacyAttention(core, x.store.db);
    retireRoomTables(x.store.db, ids => legacyAttentionImported(core, x.store.db, ids));
    expect(x.store.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('rooms','room_messages','room_runs','delegations','channel_attention')").all()).toEqual([]);
    expect(new OfficeConversations(x.store.db).history(x.room.id)).toMatchObject([{ source: "rooms", record: { id: x.room.id } }]);
    await plugin(x.bb, core);
    expect(await x.harness.behavior.callRpc("office_talk", {})).toMatchObject({ conversations: [{ id: x.room.id, memberBotIds: [x.a.id, x.b.id] }] });
    expect(await x.harness.behavior.callRpc("list", null)).toMatchObject({ bots: [{ id: x.a.id }, { id: x.b.id }] });
  } finally { await x.close(); core.close(); }
});
