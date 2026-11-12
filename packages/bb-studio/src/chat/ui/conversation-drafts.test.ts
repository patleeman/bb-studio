import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { draftRoute, itemDraftPath, quoteDraftPath, QuoteDrafts, STALE_DRAFT_MS } from "./conversation-drafts";

const item = { pluginId: "artifacts", id: "a/slash:percent%2F" };
const selection = { text: "Keep this", note: "Fix it", where: "top left", image: "data:image/png;base64,aGVsbG8=" };

describe("restorable conversation drafts", () => {
  it("decodes both host and companion routes without changing encoded item IDs", () => {
    const path = itemDraftPath(item).split("/chats/")[1]!;
    expect(draftRoute(path)).toEqual({ kind: "item", item });
    expect(draftRoute(decodeURIComponent(path))).toEqual({ kind: "item", item });
    expect(draftRoute("item/%invalid")).toBeNull();
    expect(draftRoute('item/{"pluginId":"","id":"a"}')).toBeNull();
    expect(draftRoute("quote/not-an-id")).toBeNull();
    expect(draftRoute(undefined)).toEqual({ kind: "plain" });
  });

  it("restores independent quotes and their image from a new store instance", async () => {
    const factory = new IDBFactory();
    const store = new QuoteDrafts(() => factory);
    const first = await store.save(item, selection);
    const second = await store.save(item, { ...selection, text: "Another selection" });
    const reloaded = new QuoteDrafts(() => factory);
    expect(first.id).not.toBe(second.id);
    expect(await reloaded.get(first.id)).toEqual(first);
    expect((await reloaded.get(second.id))?.quote.text).toBe("Another selection");
    expect(draftRoute(quoteDraftPath(first.id).split("/chats/")[1])).toEqual({ kind: "quote", id: first.id });
    await store.remove(first.id);
    expect(await reloaded.get(first.id)).toBeNull();
    expect(await reloaded.get(second.id)).toEqual(second);
  });

  it("drops stale drafts when the store opens", async () => {
    const factory = new IDBFactory();
    let now = 1_000;
    const store = new QuoteDrafts(() => factory, () => now);
    const old = await store.save(item, selection);
    now += STALE_DRAFT_MS;
    const fresh = await store.save(item, selection);
    const reloaded = new QuoteDrafts(() => factory, () => now + 1);
    expect(await reloaded.get(old.id)).toBeNull();
    expect(await reloaded.get(fresh.id)).toEqual(fresh);
  });

  it("doesn't discard large image selections because session storage is full", async () => {
    const store = new QuoteDrafts(() => new IDBFactory());
    const quote = { ...selection, image: `data:image/png;base64,${"a".repeat(3_900_000)}` };
    const draft = await store.save(item, quote);
    expect((await store.get(draft.id))?.quote.image).toBe(quote.image);
  });

  it("reports unavailable storage and permits retry when storage returns", async () => {
    const factory = new IDBFactory();
    let available = false;
    const store = new QuoteDrafts(() => { if (!available) throw new Error("Storage unavailable"); return factory; });
    await expect(store.save(item, selection)).rejects.toThrow("Storage unavailable");
    available = true;
    const draft = await store.save(item, selection);
    expect(await store.get(draft.id)).toEqual(draft);
  });

  it("rejects invalid quote data before persisting it", async () => {
    const store = new QuoteDrafts(() => new IDBFactory());
    await expect(store.save(item, { ...selection, image: "https://example.com/not-a-crop" })).rejects.toThrow();
  });
});
