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
