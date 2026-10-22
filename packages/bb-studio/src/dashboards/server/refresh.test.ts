import { describe, expect, it } from "vitest";
import { applyOps } from "../ops";
import { EMPTY_LAYOUTS, type Source } from "../shared";
import { memoryStore } from "../test/host";
import { Refresher } from "./refresh";
import { scriptHash } from "./sources";

function setup(sources: Source[]) {
  let clock = 10_000_000_000;
  const { store } = memoryStore(() => clock);
  const row = store.create({ name: "Ops", by: "user" });
  let n = 0;
  const { doc } = applyOps({ widgets: [], layouts: EMPTY_LAYOUTS }, sources.map((source) => ({ op: "add" as const, type: "stat" as const, source })), { newId: () => `w${++n}`, hasType: () => false });
  store.write(row.id, doc, "user", "seed");
  const fetched: string[] = [];
  const ran: string[] = [];
  const changed: string[][] = [];
  const refresher = new Refresher({
    store,
    now: () => clock,
    fetchUrl: async (source) => { fetched.push(source.url!); return { value: fetched.length }; },
    runScript: async (source) => { ran.push(source.command!); return 7; },
    changed: (_id, ids) => changed.push(ids),
  });
  return { store, row, refresher, fetched, ran, changed, advance: (ms: number) => { clock += ms; }, widgets: doc.widgets };
}

describe("refresh gating", () => {
  it("refreshes a URL on its interval only while someone views the dashboard", async () => {
    const t = setup([{ kind: "url", url: "https://example.com/a.json", intervalSec: 60 }]);
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(1);
    // Not viewed: the next one waits 30 minutes.
    t.advance(5 * 60_000);
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(1);
    // Viewed: every 60 s.
    t.refresher.view(t.row.id, "client-1");
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(2);
    t.advance(30_000);
    t.refresher.view(t.row.id, "client-1");
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(2);
    t.advance(31_000);
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(3);
    // The viewer's heartbeat lapses after 75 s.
    t.advance(120_000);
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(3);
    t.advance(30 * 60_000);
    await t.refresher.tick();
    expect(t.fetched).toHaveLength(4);
    expect(t.store.dataFor(t.row.id, t.widgets[0]!.id)).toMatchObject({ value: JSON.stringify({ value: 4 }), error: null });
  });

  it("never polls push or static widgets", async () => {
    const t = setup([{ kind: "push" }, { kind: "static", data: 1 }]);
    t.refresher.view(t.row.id, "c");
    await t.refresher.tick();
    t.advance(60 * 60_000);
    await t.refresher.tick();
    expect(t.fetched).toEqual([]);
    expect(t.ran).toEqual([]);
  });

  it("runs a script only while its exact command is approved, at most every 5 minutes", async () => {
    const t = setup([{ kind: "script", command: "echo 7", intervalSec: 300 }]);
    const widget = t.widgets[0]!;
    t.refresher.view(t.row.id, "c");
    await t.refresher.tick();
    expect(t.ran).toEqual([]);
    t.store.approve(t.row.id, widget.id, scriptHash(widget.source), "echo 7", null);
    await t.refresher.tick();
    expect(t.ran).toEqual(["echo 7"]);
    t.advance(60_000);
    t.refresher.view(t.row.id, "c");
    await t.refresher.tick();
    expect(t.ran).toHaveLength(1);
    t.advance(240_000);
    t.refresher.view(t.row.id, "c");
    await t.refresher.tick();
    expect(t.ran).toHaveLength(2);
    // An edited command is a new command: it waits for a new approval.
    const edited = applyOps(t.store.doc(t.row.id), [{ op: "update", widgetId: widget.id, source: { kind: "script", command: "echo 8" } }], { newId: () => "x", hasType: () => false }).doc;
    t.store.write(t.row.id, edited, "agent", "edit");
    t.advance(600_000);
    t.refresher.view(t.row.id, "c");
    await t.refresher.tick();
    expect(t.ran).toHaveLength(2);
  });

  it.each(["revoked", "edited", "deleted", "disabled"])("skips a queued script that is %s before its worker starts", async (change) => {
    const t = setup([{ kind: "url", url: "https://example.com/slow" }, { kind: "script", command: "echo 7" }]);
    const widget = t.widgets[1]!;
    t.store.approve(t.row.id, widget.id, scriptHash(widget.source), "echo 7", null);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let enabled = true;
    const ran: string[] = [];
    const refresher = new Refresher({
      store: t.store, concurrency: 1, now: () => 10_000_000_000, enabled: () => enabled,
      fetchUrl: async () => { await blocked; return 1; },
      runScript: async (source) => { ran.push(source.command!); return 7; }, changed: () => {},
    });
    const refresh = refresher.tick();
    if (change === "revoked") t.store.revoke(t.row.id, widget.id);
    if (change === "disabled") enabled = false;
    if (change === "edited" || change === "deleted") {
      const op = change === "deleted" ? { op: "remove" as const, widgetId: widget.id } : { op: "update" as const, widgetId: widget.id, source: { kind: "script" as const, command: "echo 8" } };
      t.store.write(t.row.id, applyOps(t.store.doc(t.row.id), [op], { newId: () => "x", hasType: () => false }).doc, "user", "edit");
    }
    release();
    await refresh;
    expect(ran).toEqual([]);
    expect(t.store.dataFor(t.row.id, widget.id)).toBeNull();
  });

  it("keeps the last good value when a refresh fails, and records the error", async () => {
    const t = setup([{ kind: "url", url: "https://example.com/a.json" }]);
    await t.refresher.tick();
    const failing = new Refresher({ store: t.store, now: () => 1_000_000_000_000, fetchUrl: async () => { throw new Error("HTTP 500"); }, runScript: async () => null, changed: () => {} });
    await failing.tick();
    expect(t.store.dataFor(t.row.id, t.widgets[0]!.id)).toMatchObject({ value: JSON.stringify({ value: 1 }), error: "HTTP 500" });
  });

  it("limits a manual refresh to once per 10 s and skips unapproved scripts", async () => {
    const t = setup([{ kind: "url", url: "https://example.com/a.json" }, { kind: "script", command: "echo 1" }]);
    expect(await t.refresher.refreshNow(t.row.id)).toEqual([t.widgets[0]!.id]);
    expect(await t.refresher.refreshNow(t.row.id)).toEqual([]);
    t.advance(10_000);
    expect(await t.refresher.refreshNow(t.row.id)).toEqual([t.widgets[0]!.id]);
    expect(t.ran).toEqual([]);
  });

  it("refreshes nothing while the kind is off", async () => {
    const t = setup([{ kind: "url", url: "https://example.com/a.json" }]);
    const off = new Refresher({ store: t.store, fetchUrl: async () => { throw new Error("should not run"); }, runScript: async () => null, changed: () => {}, enabled: () => false });
    await off.tick();
    expect(t.store.dataFor(t.row.id, t.widgets[0]!.id)).toBeNull();
  });
});
