import { expect, test } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../migrations";
import { Store } from "../store";

test("migrates a database created before migration tracking without losing data", async () => {
  const host = createFakePluginHost({ pluginId: "bot-teams" });
  const db = host.bb.storage.database();
  for (const statement of MIGRATIONS) db.exec(statement);
  db.prepare("INSERT INTO bots(id,json) VALUES (?,?)").run("bot_0123456789abcdef", JSON.stringify({ id: "bot_0123456789abcdef", name: "Atlas" }));
  host.bb.storage.migrate(db, MIGRATIONS);
  const store = new Store(db);
  expect(store.get("bot_0123456789abcdef").name).toBe("Atlas");
  host.bb.storage.migrate(db, MIGRATIONS);
  expect(store.all()).toHaveLength(1);
  await host.harness.lifecycle.dispose();
});

test("former direct messages become threads with a profile, listed to be shown once", async () => {
  const host = createFakePluginHost({ pluginId: "bot-teams" });
  const db = host.bb.storage.database();
  const profileMigration = MIGRATIONS.findIndex(sql => sql.includes("CREATE TABLE IF NOT EXISTS profile_threads_to_show"));
  expect(profileMigration).toBeGreaterThan(0);
  for (const statement of MIGRATIONS.slice(0, profileMigration)) db.exec(statement);
  const insert = db.prepare("INSERT INTO conversations VALUES (?,?,?,?,?)");
  const conversation = (id: string, key: string, kind: string, extra = {}) =>
    insert.run(id, "bot_0123456789abcdef", key, `thr_${id}`, JSON.stringify({ id, botId: "bot_0123456789abcdef", key, threadId: `thr_${id}`, title: "Chat", kind, createdAt: 1, ...extra }));
  conversation("current", "admin", "admin");
  conversation("earlier", "history:1", "admin", { archivedAt: 2, originalKey: "admin" });
  conversation("work", "group:room", "group");
  db.exec(MIGRATIONS[profileMigration]!);
  const store = new Store(db);
  expect(store.conversations("bot_0123456789abcdef").map((c) => [c.key, c.archivedAt, c.originalKey])).toEqual([
    ["group:room", undefined, undefined],
    ["thread:thr_earlier", undefined, undefined],
    ["thread:thr_current", undefined, undefined],
  ]);
  expect(store.profileThreadsToShow().sort()).toEqual(["thr_current", "thr_earlier"]);
  await host.harness.lifecycle.dispose();
});
