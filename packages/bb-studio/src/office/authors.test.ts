import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { officeAuthors } from "./authors";
import { ModuleServices } from "../modules/services";
import { officeAuthorsRpc } from "./contract";

it("attributes created items to their original bot, including absorbed plugin refs and retired bot threads", async () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE item_threads (plugin_id TEXT,item_id TEXT,thread_id TEXT,role TEXT,created_at INTEGER)");
  const insert = db.prepare("INSERT INTO item_threads VALUES (?,?,?,?,?)");
  insert.run("artifacts", "art_1", "old", "created", 1);
  insert.run("studio", "art_1", "new", "created", 2);
  insert.run("pages", "pg_1", "new", "handoff", 1);
  const modules = new ModuleServices();
  modules.register("bot-teams", { office_authors: officeAuthorsRpc }, { office_authors: () => [{threadId:"old",botId:"retired_bot"},{threadId:"new",botId:"new_bot"}] });
  try {
    const authors = await officeAuthors(db, modules);
    expect(authors.item({pluginId:"studio",id:"art_1"})).toBe("retired_bot");
    expect(authors.item({pluginId:"pages",id:"pg_1"})).toBeNull();
    expect(authors.thread("old")).toBe("retired_bot");
    expect(authors.thread("human")).toBeNull();
  } finally { db.close(); }
});
