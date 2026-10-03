import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { PLUGIN_ID, SYNC_PATH } from "../constants";
import { MESSAGE_PERSIST, MESSAGE_PERSIST_RESULT } from "../protocol";
import { pageRecovery, sameState, type PageRecoveryStore } from "./page-recovery";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
// If IndexedDB fails, unmounting must not discard the only in-process copy.
// This is explicitly not a substitute for durable recovery across browser exit.
type RecoveryMemory = {
  states: Map<string, Uint8Array>;
  listening: boolean;
  warn(event: BeforeUnloadEvent): void;
};
// A hot plugin reload replaces module instances, but not this window. The
// recovery bytes and their exit guard share one owner until durability succeeds.
const memoryKey = Symbol.for("bb-studio-pages:pending-recovery");
const memoryHost = globalThis as typeof globalThis & { [key: symbol]: RecoveryMemory | undefined };
const recoveryMemory = memoryHost[memoryKey] ??= {
  states: new Map(),
  listening: false,
  warn(event) { event.preventDefault(); event.returnValue = ""; },
};
const memoryRecovery = recoveryMemory.states;
function updateMemoryGuard(): void {
  if (memoryRecovery.size && !recoveryMemory.listening) {
    window.addEventListener("beforeunload", recoveryMemory.warn);
    recoveryMemory.listening = true;
  } else if (!memoryRecovery.size && recoveryMemory.listening) {
    window.removeEventListener("beforeunload", recoveryMemory.warn);
    recoveryMemory.listening = false;
  }
}
function forgetMemory(key: string, state: Uint8Array): void {
  const memory = memoryRecovery.get(key);
  if (memory && sameState(memory, state)) memoryRecovery.delete(key);
  updateMemoryGuard();
}
const RESTORE = Symbol("page-recovery");

export type ConnectionStatus = "connecting" | "connected" | "offline" | "missing";
export type LocalSaveStatus = "loading" | "saving" | "saved" | "failed";
export type ServerSaveStatus = "pending" | "confirmed" | "failed";

export class PageConnection {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  status: ConnectionStatus = "connecting";
  synced = false;
  ready = false;
  localSave: LocalSaveStatus = "loading";
  serverSave: ServerSaveStatus = "pending";
  localError: string | null = null;
  serverError: string | null = null;
  private socket: WebSocket | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private barrierTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private revision = 0;
  private acknowledged = -1;
  private sequence = 0;
  private barrier: { token: string; revision: number; state: Uint8Array } | null = null;
  private writes: Promise<void> = Promise.resolve();
  private recoveryWrite: { state: Uint8Array; revision: number } | null = null;
  private writingRecovery = false;
  private readonly listeners = new Set<() => void>();
  private readonly recovery: PageRecoveryStore;
  private readonly recoveryKey: string;

  constructor(readonly pageId: string, options: { recovery?: PageRecoveryStore; origin?: string } = {}) {
    this.recovery = options.recovery ?? pageRecovery;
    this.recoveryKey = JSON.stringify([options.origin ?? location.origin, pageId]);
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("online", this.reconnectNow);
    void this.restore();
  }

  get snapshot(): string {
    return JSON.stringify([this.status, this.synced, this.ready, this.localSave, this.serverSave, this.localError, this.serverError]);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Retry only explicit storage/network work; never recreate a deleted page. */
  retrySave(): void {
    if (this.destroyed) return;
    this.saveRecovery();
    if (this.status !== "missing") {
      this.reconnectNow();
      this.requestBarrier();
    }
  }

  exportRecovery(): void {
    const bytes = Y.encodeStateAsUpdate(this.doc);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.pageId}-recovery.yjs`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.barrierTimer) clearTimeout(this.barrierTimer);
    window.removeEventListener("online", this.reconnectNow);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.socket?.close();
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  private async restore(): Promise<void> {
    try {
      const state = await this.recovery.load(this.recoveryKey);
      if (this.destroyed) return;
      if (state) { Y.applyUpdate(this.doc, state, RESTORE); this.ready = true; }
      this.localSave = "saved";
    } catch (error) {
      if (this.destroyed) return;
      this.localSave = "failed";
      this.localError = String(error);
    }
    const memory = memoryRecovery.get(this.recoveryKey);
    if (memory) {
      Y.applyUpdate(this.doc, memory, RESTORE);
      this.ready = true;
      // It is only in memory until another transaction succeeds.
      this.saveRecovery();
    }
    this.emit();
    this.connect();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private connect(): void {
    if (this.destroyed || this.status === "missing") return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/v1/plugins/${PLUGIN_ID}/http${SYNC_PATH}?page=${encodeURIComponent(this.pageId)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.setStatus(this.ready ? "offline" : "connecting");
    socket.onopen = () => {
      if (this.destroyed || this.socket !== socket) return;
      this.attempts = 0;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      socket.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) this.sendAwareness([this.doc.clientID]);
    };
    socket.onmessage = event => {
      if (!this.destroyed && this.socket === socket) this.onMessage(new Uint8Array(event.data as ArrayBuffer));
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.barrier = null;
      awarenessProtocol.removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.doc.clientID), this);
      if (this.destroyed) return;
      if (event.code === 4404) { this.ready = false; this.setStatus("missing"); return; }
      // Losing the socket does not undo an already acknowledged disk save.
      // New doc updates, rather than connectivity, make that proof pending.
      this.setStatus("offline");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts++, 5)) + Math.random() * 250;
      this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
      this.emit();
    };
  }

  private readonly reconnectNow = () => {
    if (this.socket || this.destroyed || this.status === "missing") return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.connect();
  };

  private onMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const kind = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (encoding.length(encoder) > 1) this.socket?.send(encoding.toUint8Array(encoder));
      if (kind === syncProtocol.messageYjsSyncStep2) {
        this.synced = true;
        this.ready = true;
        this.setStatus("connected");
        this.requestBarrier();
        this.emit();
      }
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    } else if (type === MESSAGE_PERSIST_RESULT) {
      const token = decoding.readVarString(decoder);
      const saved = decoding.readVarUint(decoder) === 1;
      const error = decoding.readVarString(decoder);
      const barrier = this.barrier;
      if (!barrier || token !== barrier.token) return;
      if (!saved) {
        this.serverSave = "failed";
        this.serverError = error;
      } else {
        this.acknowledged = barrier.revision;
        this.barrier = null;
        this.serverError = null;
        this.serverSave = this.acknowledged === this.revision ? "confirmed" : "pending";
        // Cleanup is conditional and ordered after this connection's writes.
        this.writes = this.writes.then(() => this.recovery.removeIfUnchanged(this.recoveryKey, barrier.state)).catch(error => {
          this.localSave = "failed"; this.localError = String(error); this.emit();
        });
        forgetMemory(this.recoveryKey, barrier.state);
        if (this.acknowledged !== this.revision) this.scheduleBarrier();
      }
      this.emit();
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === RESTORE) return;
    this.revision++;
    this.serverSave = this.serverError ? "failed" : "pending";
    this.saveRecovery();
    if (origin !== this && this.socket?.readyState === WebSocket.OPEN && this.status !== "missing") {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    }
    this.scheduleBarrier();
    this.emit();
  };

  private saveRecovery(): void {
    const state = Y.encodeStateAsUpdate(this.doc);
    const revision = this.revision;
    // Merge in-process connections too, including storage-failure recovery.
    const previous = memoryRecovery.get(this.recoveryKey);
    if (previous) {
      const merged = new Y.Doc();
      try {
        Y.applyUpdate(merged, previous);
        Y.applyUpdate(merged, state);
        memoryRecovery.set(this.recoveryKey, Y.encodeStateAsUpdate(merged));
      } finally { merged.destroy(); }
    } else memoryRecovery.set(this.recoveryKey, state);
    updateMemoryGuard();
    this.localSave = "saving";
    // Bound the queue during slow/quota-limited storage: keep only the latest
    // full snapshot, which includes every earlier update and deletion.
    this.recoveryWrite = { state, revision };
    if (this.writingRecovery) return;
    this.writingRecovery = true;
    this.writes = this.writes.then(async () => {
      while (this.recoveryWrite) {
        const write = this.recoveryWrite;
        this.recoveryWrite = null;
        try {
          await this.recovery.save(this.recoveryKey, write.state);
          forgetMemory(this.recoveryKey, write.state);
          if (write.revision === this.revision) { this.localSave = "saved"; this.localError = null; }
        } catch (error) {
          this.localSave = "failed";
          this.localError = String(error);
        }
        if (!this.destroyed) this.emit();
      }
      this.writingRecovery = false;
    });
  }

  private scheduleBarrier(): void {
    if (this.barrierTimer || this.destroyed || this.status === "missing") return;
    this.barrierTimer = setTimeout(() => { this.barrierTimer = null; this.requestBarrier(); }, 400);
  }

  private requestBarrier(): void {
    if (this.destroyed || this.status !== "connected" || this.socket?.readyState !== WebSocket.OPEN) return;
    const state = Y.encodeStateAsUpdate(this.doc);
    const token = `${this.doc.clientID}:${++this.sequence}`;
    this.barrier = { token, revision: this.revision, state };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_PERSIST);
    encoding.writeVarString(encoder, token);
    encoding.writeVarUint8Array(encoder, state);
    this.socket.send(encoding.toUint8Array(encoder));
  }

  private readonly onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== this) this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    this.socket.send(encoding.toUint8Array(encoder));
  }
}
