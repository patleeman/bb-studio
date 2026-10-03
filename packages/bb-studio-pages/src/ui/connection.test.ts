// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { PageConnection } from "./connection";

class OfflineSocket {
  static OPEN = 1;
  static instances: OfflineSocket[] = [];
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: Uint8Array[] = [];
  constructor(_url: string) { OfflineSocket.instances.push(this); }
  send(data: Uint8Array) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  receive(data: Uint8Array) { this.onmessage?.({ data: data.slice().buffer }); }
}

function recovery() {
  const states = new Map<string, Uint8Array>();
  return {
    states,
    async load(key: string) { return states.get(key) ?? null; },
    async save(key: string, update: Uint8Array) {
      const doc = new Y.Doc();
      const old = states.get(key);
      if (old) Y.applyUpdate(doc, old);
      Y.applyUpdate(doc, update);
      states.set(key, Y.encodeStateAsUpdate(doc));
      doc.destroy();
    },
    async removeIfUnchanged(key: string, state: Uint8Array) {
      const saved = states.get(key);
      if (saved?.length === state.length && saved.every((value, index) => value === state[index])) states.delete(key);
    },
  };
}

describe("PageConnection recovery", () => {
  const connections: PageConnection[] = [];
  beforeEach(() => { OfflineSocket.instances = []; vi.stubGlobal("WebSocket", OfflineSocket); });
  afterEach(() => { connections.forEach(connection => connection.destroy()); connections.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  function makeConnected(connection: PageConnection) {
    const socket = OfflineSocket.instances.at(-1)!;
    socket.readyState = 1;
    socket.onopen?.();
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, 0);
    syncProtocol.writeSyncStep2(message, connection.doc);
    socket.receive(encoding.toUint8Array(message));
    return socket;
  }
  function barrier(socket: OfflineSocket) {
    const data = [...socket.sent].reverse().find(message => decoding.readVarUint(decoding.createDecoder(message)) === 2)!;
    const decoder = decoding.createDecoder(data);
    decoding.readVarUint(decoder);
    return { token: decoding.readVarString(decoder), state: decoding.readVarUint8Array(decoder) };
  }
  function ack(socket: OfflineSocket, token: string, saved = true) {
    const response = encoding.createEncoder();
    encoding.writeVarUint(response, 3);
    encoding.writeVarString(response, token);
    encoding.writeVarUint(response, saved ? 1 : 0);
    encoding.writeVarString(response, saved ? "" : "Server disk full");
    socket.receive(encoding.toUint8Array(response));
  }

  it("retains an offline edit and comment identity after destroy/reopen", async () => {
    const store = recovery();
    const first = new PageConnection("pg_offline", { recovery: store });
    connections.push(first);
    await new Promise(resolve => setTimeout(resolve, 0));
    first.doc.getText("body").insert(0, "Offline draft");
    first.doc.getMap("comments").set("comment-one", { blockId: "block-one", text: "Keep identity" });
    await new Promise(resolve => setTimeout(resolve, 0));
    first.destroy();
    const reopened = new PageConnection("pg_offline", { recovery: store });
    connections.push(reopened);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reopened.doc.getText("body").toString()).toBe("Offline draft");
    expect(reopened.doc.getMap("comments").get("comment-one")).toEqual({ blockId: "block-one", text: "Keep identity" });
    expect(reopened.ready).toBe(true);
    expect(reopened.synced).toBe(false);
    expect(reopened.serverSave).toBe("pending");
  });

  it("isolates recovery by both page and origin", async () => {
    const store = recovery();
    const first = new PageConnection("pg_origin", { recovery: store, origin: "https://one.test" });
    connections.push(first);
    await settle();
    first.doc.getText("body").insert(0, "Origin one");
    await settle();
    for (const [pageId, origin] of [["pg_other", "https://one.test"], ["pg_origin", "https://two.test"]]) {
      const other = new PageConnection(pageId!, { recovery: store, origin });
      connections.push(other);
      await settle();
      expect(other.doc.getText("body").toString()).toBe("");
    }
  });

  it("does not call socket sync durable and shows server failure until a successful barrier", async () => {
    const connection = new PageConnection("pg_failure", { recovery: recovery() });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "My edit");
    await settle();
    const socket = makeConnected(connection);
    expect(connection.status).toBe("connected");
    expect(connection.serverSave).toBe("pending");
    ack(socket, barrier(socket).token, false);
    expect(connection.serverSave).toBe("failed");
    expect(connection.serverError).toBe("Server disk full");
    expect(connection.localSave).toBe("saved");
    connection.retrySave();
    ack(socket, barrier(socket).token);
    expect(connection.serverSave).toBe("confirmed");
  });

  it("retains actual server save confirmation after disconnect and recovery cleanup", async () => {
    const store = recovery();
    const connection = new PageConnection("pg_saved_disconnect", { recovery: store });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "Already persisted");
    await settle();
    const socket = makeConnected(connection);
    ack(socket, barrier(socket).token);
    await settle();
    expect(store.states.size).toBe(0);
    socket.onclose?.({ code: 1000 });
    expect(connection.status).toBe("offline");
    expect(connection.serverSave).toBe("confirmed");
    connection.doc.getText("body").insert(0, "New offline edit ");
    expect(connection.serverSave).toBe("pending");
  });

  it("a prior ACK cannot confirm a newer deletion-only edit or erase its recovery", async () => {
    vi.useFakeTimers();
    const store = recovery();
    const connection = new PageConnection("pg_delete", { recovery: store });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "AB");
    await settle();
    const socket = makeConnected(connection);
    const old = barrier(socket);
    const clocks = Y.encodeStateVector(connection.doc);
    connection.doc.getText("body").delete(0, 1);
    expect(Y.encodeStateVector(connection.doc)).toEqual(clocks);
    await settle();
    ack(socket, old.token);
    await settle();
    expect(connection.serverSave).toBe("pending");
    expect(store.states.size).toBe(1);
    vi.advanceTimersByTime(400);
    const current = barrier(socket);
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, old.state);
    Y.applyUpdate(persisted, current.state);
    expect(persisted.getText("body").toString()).toBe("B");
    ack(socket, current.token);
    await settle();
    expect(connection.serverSave).toBe("confirmed");
    expect(store.states.size).toBe(0);
    persisted.destroy();
  });

  it("keeps quota-failed edits in memory through unmount and warns before browser exit", async () => {
    const store = recovery();
    store.save = async () => { throw new Error("QuotaExceededError"); };
    const connection = new PageConnection("pg_quota", { recovery: store });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "Quota recovery");
    await settle();
    expect(connection.localSave).toBe("failed");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    connection.destroy();
    const betweenViews = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(betweenViews);
    expect(betweenViews.defaultPrevented).toBe(true);
    const reopened = new PageConnection("pg_quota", { recovery: store });
    connections.push(reopened);
    await settle();
    expect(reopened.doc.getText("body").toString()).toBe("Quota recovery");
    expect(reopened.localSave).toBe("failed");
    store.save = recovery().save;
    reopened.retrySave();
    await settle();
    expect(reopened.localSave).toBe("saved");
    reopened.destroy();
    const afterRecovery = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterRecovery);
    expect(afterRecovery.defaultPrevented).toBe(false);
  });

  it("does not retry or restore a deleted page and retains its recovery for export", async () => {
    const store = recovery();
    const connection = new PageConnection("pg_missing", { recovery: store });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "Deleted-page recovery");
    await settle();
    const socket = makeConnected(connection);
    socket.onclose?.({ code: 4404 });
    const sent = socket.sent.length;
    connection.retrySave();
    window.dispatchEvent(new Event("online"));
    expect(connection.status).toBe("missing");
    expect(connection.ready).toBe(false);
    expect(OfflineSocket.instances).toHaveLength(1);
    expect(socket.sent).toHaveLength(sent);
    expect(connection.doc.getText("body").toString()).toBe("Deleted-page recovery");
    expect(store.states.size).toBe(1);
  });

  it("merges concurrent recovery and cannot clean up another editor's newer work", async () => {
    const store = recovery();
    const a = new PageConnection("pg_two_tabs", { recovery: store });
    connections.push(a);
    await settle();
    a.doc.getText("body").insert(0, "A");
    await settle();
    const socket = makeConnected(a);
    const previous = barrier(socket);
    const b = new PageConnection("pg_two_tabs", { recovery: store });
    connections.push(b);
    await settle();
    b.doc.getText("body").insert(1, "B");
    await settle();
    ack(socket, previous.token);
    await settle();
    expect(store.states.size).toBe(1);
    const reopened = new PageConnection("pg_two_tabs", { recovery: store });
    connections.push(reopened);
    await settle();
    expect(reopened.doc.getText("body").toString()).toBe("AB");
  });

  it("coalesces slow local writes without dropping the final snapshot on destroy", async () => {
    const store = recovery();
    const originalSave = store.save;
    let resume: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const save = vi.fn(async (key: string, state: Uint8Array) => { await gate; await originalSave(key, state); });
    store.save = save;
    const connection = new PageConnection("pg_slow", { recovery: store });
    connections.push(connection);
    await settle();
    connection.doc.getText("body").insert(0, "A");
    await settle();
    for (let index = 0; index < 30; index++) connection.doc.getText("body").insert(1 + index, "B");
    connection.destroy();
    expect(save).toHaveBeenCalledTimes(1);
    resume?.();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    const reopened = new PageConnection("pg_slow", { recovery: store });
    connections.push(reopened);
    await settle();
    expect(reopened.doc.getText("body").toString()).toBe(`A${"B".repeat(30)}`);
  });
});
