import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Inbox, type SourceEvent } from "./inbox";
const event = (key: string, projectId: string | null = null): SourceEvent => ({ key, projectId, source: "fixture", type: "request", title: key, body: "", botId: null, threadId: null, item: null, href: null, actions: [{ id: "approve", label: "Approve" }], createdAt: 1 });

describe("Inbox read model", () => {
  it("paginates tied times without duplicates, scopes counts, and persists local state", async () => {
    const db = new Database(":memory:");
    const events = [event("a"), event("b"), { ...event("c", "work"), type: "report" as const }];
    const source = { id: "fixture", list: async () => events, act: async () => {} };
    const space = (p: string | null) => p ?? "personal";
    const inbox = new Inbox(db, [source], space);
    const first = await inbox.list({ spaceId: "all" }, 2);
    const next = await inbox.list({ spaceId: "all", cursor: first.cursor! }, 2);
    expect([...first.events, ...next.events].map(e => e.key)).toEqual(["c", "b", "a"]);
    await expect(inbox.list({ spaceId: "work", cursor: first.cursor! })).rejects.toThrow("another filter");
    inbox.mark(["c"], "read"); inbox.mark(["a"], "done");
    const restarted = new Inbox(db, [source], space);
    expect(await restarted.counts(["personal", "work"])).toEqual({ bySpace: { personal: { requests: 1, unreadReports: 0 }, work: { requests: 0, unreadReports: 0 } } });
    events[2]!.createdAt = Date.now() + 1000;
    expect((await restarted.counts(["work"])).bySpace.work!.unreadReports).toBe(1);
    db.close();
  });
  it("routes only offered actions and leaves failed decisions pending", async () => {
    const db = new Database(":memory:"); let calls = 0; let fail = true;
    const inbox = new Inbox(db, [{ id: "fixture", list: async () => [event("a")], act: async () => { calls++; if (fail) throw new Error("offline"); } }], () => "personal");
    await expect(inbox.act("a", "delete")).rejects.toThrow("not available");
    expect(calls).toBe(0);
    await expect(inbox.act("a", "approve")).rejects.toThrow("offline");
    expect((await inbox.list({ spaceId: "all" })).events).toHaveLength(1);
    fail = false; await inbox.act("a", "approve");
    await expect(inbox.act("a", "approve")).rejects.toThrow("already done");
    expect(calls).toBe(2);
    expect((await inbox.list({ spaceId: "all" })).events).toHaveLength(0);
    db.close();
  });
});

it("routes a known action without depending on unrelated unavailable sources", async () => {
  const db = new Database(":memory:"); let acted = false;
  const inbox = new Inbox(db, [
    { id:"target",keyPrefix:"target:",list:async()=>[event("target:1")],act:async()=>{acted=true;} },
    { id:"offline",keyPrefix:"offline:",list:async()=>{throw new Error("offline");},act:async()=>{} },
  ],()=>"personal");
  await inbox.act("target:1","approve"); expect(acted).toBe(true);
  db.close();
});
