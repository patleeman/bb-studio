import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { OfficeConversations } from "./conversations";

it("reuses a DM across store restarts and excludes multi-bot channels", () => {
  const db=new Database(":memory:");
  db.exec(`CREATE TABLE conversations(id TEXT PRIMARY KEY,json TEXT,project_id TEXT);
    CREATE TABLE conversation_threads(conversation_id TEXT,thread_id TEXT,bot_id TEXT,PRIMARY KEY(conversation_id,thread_id));`);
  db.prepare("INSERT INTO conversations VALUES (?,?,?)").run("channel",JSON.stringify({id:"channel",name:"Team",projectId:"p",members:[{kind:"bot",id:"a"},{kind:"bot",id:"b"}],archived:false,createdAt:1,updatedAt:1}),"p");
  const store=new OfficeConversations(db); const dm=store.dm("a","p","Alice");
  expect(dm.id).not.toBe("channel");
  expect(new OfficeConversations(db).dm("a","p","Alice").id).toBe(dm.id);
  store.attachThread(dm.id,"thread","a"); store.attachThread(dm.id,"thread","a");
  expect(db.prepare("SELECT * FROM conversation_threads").all()).toHaveLength(1);
  expect(()=>store.attachThread(dm.id,"wrong","b")).toThrow("not a member");
  db.close();
});
