import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HUMAN_USER_ID, PLUGIN_RPC_ACTOR } from "./constants";
import { rpcContract } from "./contract";
import { addCommentMark, readBlocks, readMarkdown } from "./doc";
import { PagesService } from "./service";
import { MIGRATIONS, PageStore } from "./store";

const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
});

function setup() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const events: unknown[] = [];
  const bb = { realtime: { publish: (_channel: string, event: unknown) => events.push(event) } };
  const service = new PagesService(bb as never, store);
  services.push(service);
  const actor = { key: PLUGIN_RPC_ACTOR, name: "Agent", color: "#000" };
  return { store, service, events, actor };
}

describe("replaceMarkdown", () => {
  it("saves a named version, then replaces the page live", () => {
    const { store, service, events, actor } = setup();
    const page = service.createPage({ projectId: null, parentId: null, title: "Plan", markdown: "# Old\n\nKeep me safe.\n", actor: HUMAN_USER_ID });
    // An open editor's doc is the hub's doc, so it sees the change as it happens.
    const live = service.hub.open(page.id);
    const updates: Uint8Array[] = [];
    live.doc.on("update", (update: Uint8Array) => updates.push(update));

    const meta = service.replaceMarkdown(page.id, "# New\n\n```html\n<b>hi</b>\n```\n", "Before explore", actor);

    expect(updates.length).toBeGreaterThan(0);
    expect(readMarkdown(live.doc)).toBe("# New\n\n```html\n<b>hi</b>\n```\n");
    expect(store.get(page.id)!.markdown).toBe("# New\n\n```html\n<b>hi</b>\n```\n");
    expect(meta).toMatchObject({ id: page.id, updated_by: PLUGIN_RPC_ACTOR });
    expect(events).toContainEqual({ type: "page", pageId: page.id });

    const [snapshot] = store.snapshots(page.id);
    expect(snapshot).toMatchObject({ label: "Before explore", actor: PLUGIN_RPC_ACTOR });
    const saved = new Y.Doc();
    Y.applyUpdate(saved, new Uint8Array(store.snapshotState(snapshot!.id)!.state));
    expect(readMarkdown(saved)).toBe("# Old\n\nKeep me safe.\n");

    // The version restores what was there before.
    service.restore(snapshot!.id, HUMAN_USER_ID);
    expect(readMarkdown(live.doc)).toBe("# Old\n\nKeep me safe.\n");
  });

  it("empties a page for empty Markdown and rejects unknown pages", () => {
    const { service, actor } = setup();
    const page = service.createPage({ projectId: "proj_a", parentId: null, title: "Plan", markdown: "Text\n", actor: HUMAN_USER_ID });
    service.replaceMarkdown(page.id, "", "Cleared", actor);
    expect(readMarkdown(service.hub.open(page.id).doc).trim()).toBe("");
    expect(() => service.replaceMarkdown("pg_000000000000", "x", "v", actor)).toThrow("Page not found.");
  });

  it("validates input like create does", () => {
    const input = rpcContract.replaceMarkdown.input;
    expect(input.safeParse({ id: "pg_0123456789ab", markdown: "# Hi", snapshotName: "v1" }).success).toBe(true);
    expect(input.safeParse({ id: "pg_0123456789ab", markdown: "# Hi", snapshotName: "  " }).success).toBe(false);
    expect(input.safeParse({ id: "pg_0123456789ab", markdown: "x".repeat(200_001), snapshotName: "v1" }).success).toBe(false);
    expect(input.safeParse({ id: "nope", markdown: "", snapshotName: "v1" }).success).toBe(false);
  });
});

describe("editClientDocument", () => {
  const ids = (doc: Y.Doc) => readBlocks(doc).map((block) => block.id);

  it("rewrites only the blocks that changed, keeping the others' ids", () => {
    const { service } = setup();
    const page = service.createPage({ projectId: null, parentId: null, title: "Plan", markdown: "# Plan\n\nFirst.\n\nSecond.\n\n- [ ] Ship\n", actor: HUMAN_USER_ID });
    const doc = service.hub.open(page.id).doc;
    const [heading, first, second, check] = ids(doc);
    const expected = readMarkdown(doc, { ids: true });

    const after = service.editClientDocument(page.id, expected, "# Plan\n\nFirst, edited.\n\nNew between.\n\n- [x] Ship\n\nAt the end.\n");

    expect(readMarkdown(doc)).toBe("# Plan\n\nFirst, edited.\n\nNew between.\n\n- [x] Ship\n\nAt the end.\n");
    expect(after).toBe(readMarkdown(doc, { ids: true }));
    const now = ids(doc);
    expect(now[0]).toBe(heading);
    expect(now[1]).toBe(first);
    expect(now[2]).toBe(second);
    expect(now[3]).toBe(check);
    expect(now).toHaveLength(5);
  });

  it("deletes removed blocks, rejects stale documents, and protects commented blocks", () => {
    const { service } = setup();
    const page = service.createPage({ projectId: null, parentId: null, title: "Plan", markdown: "Keep.\n\nDrop.\n\nDiscussed.\n", actor: HUMAN_USER_ID });
    const doc = service.hub.open(page.id).doc;
    const discussed = ids(doc)[2]!;
    addCommentMark(doc, discussed, "thread-1", "Discussed", "test");
    let expected = readMarkdown(doc, { ids: true });

    expected = service.editClientDocument(page.id, expected, "Keep.\n\nDiscussed.\n");
    expect(readMarkdown(doc)).toBe("Keep.\n\nDiscussed.\n");
    expect(ids(doc)[1]).toBe(discussed);

    expect(() => service.editClientDocument(page.id, "stale", "Keep.\n")).toThrow("Page changed");
    expect(() => service.editClientDocument(page.id, expected, "Keep.\n\nDiscussed, edited.\n")).toThrow("has comments");
    expect(() => service.editClientDocument(page.id, expected, "")).toThrow("has comments");
    expect(readMarkdown(doc)).toBe("Keep.\n\nDiscussed.\n");
  });
});
