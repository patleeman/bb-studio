import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { PLUGIN_ID, SYNC_PATH } from "../constants";

// A y-websocket-style client for the plugin's `/sync` route (src/hub.ts). It
// reconnects with backoff and resyncs, so edits made offline merge on return.

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export type ConnectionStatus = "connecting" | "connected" | "offline" | "missing";

export class PageConnection {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  status: ConnectionStatus = "connecting";
  synced = false;
  private socket: WebSocket | null = null;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly listeners = new Set<() => void>();

  constructor(readonly pageId: string) {
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    window.addEventListener("online", this.reconnectNow);
    this.connect();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.retry) clearTimeout(this.retry);
    window.removeEventListener("online", this.reconnectNow);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.socket?.close();
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private connect(): void {
    if (this.destroyed) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/v1/plugins/${PLUGIN_ID}/http${SYNC_PATH}?page=${encodeURIComponent(this.pageId)}`,
    );
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.setStatus(this.synced ? "offline" : "connecting");

    socket.onopen = () => {
      this.attempts = 0;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      socket.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) {
        this.sendAwareness([this.doc.clientID]);
      }
    };
    socket.onmessage = (event) => this.onMessage(new Uint8Array(event.data as ArrayBuffer));
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      // Forget remote cursors; they are re-sent after reconnecting.
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID),
        this,
      );
      if (this.destroyed) return;
      if (event.code === 4404) {
        this.setStatus("missing");
        return;
      }
      this.setStatus("offline");
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++) + Math.random() * 250;
      this.retry = setTimeout(() => this.connect(), delay);
    };
  }

  private readonly reconnectNow = () => {
    if (this.socket || this.destroyed || this.status === "missing") return;
    if (this.retry) clearTimeout(this.retry);
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
        this.setStatus("connected");
        this.emit();
      }
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.socket.send(encoding.toUint8Array(encoder));
  };

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    this.socket.send(encoding.toUint8Array(encoder));
  }
}
