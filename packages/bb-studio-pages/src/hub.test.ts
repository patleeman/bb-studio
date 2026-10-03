import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { applyEdits, readBlocks, readMarkdown, seedMarkdown } from "./doc";
import { MESSAGE_AWARENESS, MESSAGE_SYNC, PageHub } from "./hub";

/** A minimal y-websocket-style client wired straight to the hub. */
function client(hub: PageHub, pageId: string) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const socket = {
    send(data: Uint8Array) {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
        if (encoding.length(encoder) > 1) hub.receive(pageId, socket, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), "remote");
      }
    },
  };
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    hub.receive(pageId, socket, encoding.toUint8Array(encoder));
  });
  hub.connect(pageId, socket);
  const step1 = encoding.createEncoder();
  encoding.writeVarUint(step1, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(step1, doc);
  hub.receive(pageId, socket, encoding.toUint8Array(step1));
  return { doc, awareness, socket };
}

describe("PageHub", () => {
  it("tells the editor a durability barrier failed when server storage fails", () => {
    vi.useFakeTimers();
    let failing = true;
    const hub = new PageHub({ load: () => null, saveDelayMs: 10, save: () => { if (failing) throw new Error("disk full"); } });
    const messages: Uint8Array[] = [];
    const socket = { send: (data: Uint8Array) => messages.push(data) };
    hub.connect("pg_barrier", socket);
    const editor = new Y.Doc();
    editor.getText("body").insert(0, "Keep me");
    const request = encoding.createEncoder();
    encoding.writeVarUint(request, 2);
    encoding.writeVarString(request, "edit-one");
    encoding.writeVarUint8Array(request, Y.encodeStateAsUpdate(editor));
    hub.receive("pg_barrier", socket, encoding.toUint8Array(request));
    vi.advanceTimersByTime(10);
    const responses = messages.filter(message => decoding.readVarUint(decoding.createDecoder(message)) === 3);
    expect(responses).toHaveLength(1);
    const response = decoding.createDecoder(responses[0]!);
    decoding.readVarUint(response);
    expect(decoding.readVarString(response)).toBe("edit-one");
    expect(decoding.readVarUint(response)).toBe(0);
    failing = false;
    vi.advanceTimersByTime(1000);
    const success = decoding.createDecoder(messages.at(-1)!);
    expect(decoding.readVarUint(success)).toBe(3);
    expect(decoding.readVarString(success)).toBe("edit-one");
    expect(decoding.readVarUint(success)).toBe(1);
    hub.disposeAll();
    editor.destroy();
    vi.useRealTimers();
  });

  it("saves a deletion-only barrier before acknowledging it", () => {
    vi.useFakeTimers();
    const seed = new Y.Doc();
    seed.getText("body").insert(0, "ABC");
    let persisted = Y.encodeStateAsUpdate(seed);
    const order: string[] = [];
    const hub = new PageHub({ load: () => persisted, saveDelayMs: 10, save: (_id, doc) => { persisted = Y.encodeStateAsUpdate(doc); order.push("saved"); } });
    const socket = { send(data: Uint8Array) { if (decoding.readVarUint(decoding.createDecoder(data)) === 3) order.push("acknowledged"); } };
    hub.connect("pg_delete_barrier", socket);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, persisted);
    const clocks = Y.encodeStateVector(editor);
    editor.getText("body").delete(1, 1);
    expect(Y.encodeStateVector(editor)).toEqual(clocks);
    const request = encoding.createEncoder();
    encoding.writeVarUint(request, 2);
    encoding.writeVarString(request, "delete-one");
    encoding.writeVarUint8Array(request, Y.encodeStateAsUpdate(editor));
    hub.receive("pg_delete_barrier", socket, encoding.toUint8Array(request));
    expect(order).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(order).toEqual(["saved", "acknowledged"]);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, persisted);
    expect(reopened.getText("body").toString()).toBe("AC");
    hub.disposeAll();
    for (const doc of [seed, editor, reopened]) doc.destroy();
    vi.useRealTimers();
  });

  it("keeps dirty changes and their actors after a failed explicit save", () => {
    vi.useFakeTimers();
    const save = vi.fn().mockImplementationOnce(() => { throw new Error("disk busy"); });
    const hub = new PageHub({ load: () => null, save });
    try {
      const page = hub.open("pg_retry");
      applyEdits(page.doc, [{ op: "append", markdown: "Keep this" }], "agent:one");
      expect(() => hub.flush(page)).toThrow("disk busy");
      expect([...page.dirtyBy]).toEqual(["agent:one"]);
      hub.flush(page);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1]![2]).toEqual(["agent:one"]);
      expect(readMarkdown(save.mock.calls[1]![1])).toContain("Keep this");
      expect(page.dirtyBy.size).toBe(0);
    } finally {
      hub.disposeAll();
      vi.useRealTimers();
    }
  });

  it("retries timer save failures without throwing or unloading unsaved pages", () => {
    vi.useFakeTimers();
    let failing = true;
    let stored = "";
    const error = vi.fn();
    const hub = new PageHub({
      load: () => null,
      save: (_id, doc) => {
        if (failing) throw new Error("disk busy");
        stored = readMarkdown(doc);
      },
      saveError: error,
      saveDelayMs: 10,
      unloadDelayMs: 100,
    });
    try {
      const page = hub.open("pg_retry");
      applyEdits(page.doc, [{ op: "append", markdown: "Keep this too" }], "user");
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
      expect(error).toHaveBeenCalled();
      expect(hub.has(page.id)).toBe(true);
      expect(page.dirtyBy.size).toBe(1);
      failing = false;
      vi.advanceTimersByTime(100);
      expect(stored).toContain("Keep this too");
      expect(hub.has(page.id)).toBe(false);
    } finally {
      failing = false;
      hub.disposeAll();
      vi.useRealTimers();
    }
  });

  it("syncs editors, relays server edits and agent presence, and saves", () => {
    vi.useFakeTimers();
    const seed = new Y.Doc();
    seedMarkdown(seed, "# Hello\n\nWorld\n");
    const saves: string[][] = [];
    const hub = new PageHub({
      load: () => Y.encodeStateAsUpdate(seed),
      save: (_id, _doc, actors) => saves.push(actors),
    });

    const a = client(hub, "pg_1");
    const b = client(hub, "pg_1");
    expect(readMarkdown(a.doc)).toBe("# Hello\n\nWorld\n");

    applyEdits(a.doc, [{ op: "append", markdown: "From A" }], "local");
    expect(readMarkdown(b.doc)).toBe("# Hello\n\nWorld\n\nFrom A\n");

    const page = hub.open("pg_1");
    const [heading] = readBlocks(page.doc);
    applyEdits(page.doc, [{ op: "insert_after", block: heading!.id!, markdown: "From agent" }], "bot:bot_1");
    expect(readMarkdown(a.doc)).toBe("# Hello\n\nFrom agent\n\nWorld\n\nFrom A\n");

    hub.showPresence(page, { key: "bot:bot_1", name: "Ops Bot", color: "#7c3aed" }, heading!.id!);
    const agentState = [...b.awareness.getStates().values()].find((state) => state.user?.name === "Ops Bot");
    expect(agentState?.cursor?.anchor).toBeTruthy();

    vi.advanceTimersByTime(8000);
    expect([...b.awareness.getStates().values()].some((state) => state.user?.name === "Ops Bot")).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(saves.at(-1)?.sort()).toEqual(["bot:bot_1", "user"]);
    vi.useRealTimers();
  });

  it("reports a loaded page before its first change, with the stored content", () => {
    const seed = new Y.Doc();
    seedMarkdown(seed, "Seeded\n");
    const events: string[] = [];
    const hub = new PageHub({
      load: () => Y.encodeStateAsUpdate(seed),
      save: () => {},
      opened: (page) => events.push(`opened:${readMarkdown(page.doc).trim()}`),
      changed: () => events.push("changed"),
    });

    const editor = client(hub, "pg_1");
    applyEdits(editor.doc, [{ op: "append", markdown: "First human edit" }], "local");
    expect(events).toEqual(["opened:Seeded", "changed"]);
  });

  it("closes every editor of a deleted page", () => {
    const hub = new PageHub({ load: () => null, save: () => {} });
    const a = client(hub, "pg_1");
    const closed: number[] = [];
    Object.assign(a.socket, { close: (code: number) => closed.push(code) });
    hub.evict("pg_1");
    expect(closed).toEqual([4404]);
  });
});
