import { describe, expect, it } from "vitest";
import { DrawingDraftSession, drawingDraftStore, type DraftStore, type DrawingDraft } from "./drafts";

function memoryStore() {
  const rows = new Map<string, DrawingDraft>();
  const store: DraftStore = {
    list: async drawingId => [...rows.values()].filter(row => row.drawingId === drawingId),
    put: async draft => { rows.set(draft.id, structuredClone(draft)); },
    remove: async (id, token) => { if (rows.get(id)?.token === token) rows.delete(id); },
  };
  return { rows, store };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const token = (() => { let next = 0; return () => `token-${++next}`; })();
const session = (store: DraftStore, id = "editor", status: (error: unknown) => void = () => {}) => new DrawingDraftSession(store, "drawing", id, status, token);

describe("durable drawing drafts", () => {
  it("restores the complete scene and image files after an editor reload, scoped to its drawing", async () => {
    const { store } = memoryStore();
    const data = JSON.stringify({ elements: [{ id: "shape", isDeleted: true }], files: { image: { dataURL: "x".repeat(2_000_000) } } });
    const first = session(store);
    first.stage(data, 42);
    await first.retry();
    // A new editor reads storage; nothing automatically acknowledges or sends it.
    const reloaded = session(store, "reload");
    expect(await store.list("drawing")).toEqual([expect.objectContaining({ data, baseRevision: 42 })]);
    expect(await store.list("other-drawing")).toEqual([]);
    await reloaded.retry();
    expect(await store.list("drawing")).toHaveLength(1);
  });

  it("keeps concurrent editors separate and clears only the acknowledged editor", async () => {
    const { store } = memoryStore();
    const a = session(store, "a"), b = session(store, "b");
    a.stage("a scene", 5); b.stage("b scene", 5);
    await Promise.all([a.retry(), b.retry()]);
    await a.acknowledged("a scene", 6);
    expect(await store.list("drawing")).toEqual([expect.objectContaining({ id: "b", data: "b scene" })]);
  });

  it("coalesces rapid edits during a slow disk write without losing the newest", async () => {
    const { store } = memoryStore();
    const slow = gate();
    const writes: string[] = [];
    const put = store.put;
    store.put = async draft => { writes.push(draft.data); if (writes.length === 1) await slow.promise; await put(draft); };
    const editor = session(store);
    editor.stage("first", 1); editor.stage("middle", 1); editor.stage("last", 1);
    slow.release(); await editor.retry();
    expect(writes).toEqual(["first", "last"]);
    expect((await store.list("drawing"))[0]?.data).toBe("last");
  });

  it("retains newer edits when an older network acknowledgement arrives during disk persistence", async () => {
    const { store } = memoryStore();
    const slow = gate();
    const put = store.put;
    store.put = async draft => { await slow.promise; await put(draft); };
    const editor = session(store);
    editor.stage("first", 1);
    const ack = editor.acknowledged("first", 2);
    editor.stage("second", 1);
    slow.release(); await ack; await editor.retry();
    expect(await store.list("drawing")).toEqual([expect.objectContaining({ data: "second", baseRevision: 2 })]);
    await editor.acknowledged("second", 3);
    expect(await store.list("drawing")).toEqual([]);
  });

  it("does not remove a newer draft while an acknowledgement is deleting the old token", async () => {
    const { store } = memoryStore();
    const slow = gate();
    const remove = store.remove;
    store.remove = async (id, token) => { await slow.promise; await remove(id, token); };
    const editor = session(store);
    editor.stage("first", 1); await editor.retry();
    const ack = editor.acknowledged("first", 2);
    await Promise.resolve();
    editor.stage("second", 2); await editor.retry();
    slow.release(); await ack;
    expect((await store.list("drawing"))[0]?.data).toBe("second");
  });

  it("reports quota failure, keeps the in-memory scene, and persists it on retry", async () => {
    const { store } = memoryStore();
    let quota = true;
    const errors: unknown[] = [];
    const put = store.put;
    store.put = async draft => { if (quota) throw new Error("Quota exceeded"); await put(draft); };
    const editor = session(store, "editor", error => errors.push(error));
    editor.stage("unsaved", 9); await editor.retry();
    expect(errors.at(-1)).toBeInstanceOf(Error);
    expect(await store.list("drawing")).toEqual([]);
    quota = false; await editor.retry();
    expect(errors.at(-1)).toBeNull();
    expect((await store.list("drawing"))[0]?.data).toBe("unsaved");
  });

  it("retains a recoverable draft if acknowledgement cleanup fails", async () => {
    const { store } = memoryStore();
    const errors: unknown[] = [];
    const editor = session(store, "editor", error => errors.push(error));
    editor.stage("saved remotely", 1); await editor.retry();
    const remove = store.remove;
    store.remove = async () => { throw new Error("Disk unavailable"); };
    await editor.acknowledged("saved remotely", 2);
    expect(await store.list("drawing")).toHaveLength(1);
    expect(errors.at(-1)).toBeInstanceOf(Error);
    store.remove = remove;
    await editor.retry();
    expect(errors.at(-1)).toBeNull();
    expect(await store.list("drawing")).toEqual([]);
  });

  it("rejects unavailable browser storage on each attempt instead of claiming durability", async () => {
    const store = drawingDraftStore();
    await expect(store.list("drawing")).rejects.toThrow();
    await expect(store.list("drawing")).rejects.toThrow();
  });
});
