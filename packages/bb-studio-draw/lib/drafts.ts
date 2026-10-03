export interface DrawingDraft { id: string; drawingId: string; token: string; data: string; baseRevision: number; updatedAt: number }
export interface DraftStore {
  list(drawingId: string): Promise<DrawingDraft[]>;
  put(draft: DrawingDraft): Promise<void>;
  remove(id: string, token: string): Promise<void>;
}

/** IndexedDB is origin-scoped. Each editor owns a separate key, including across tabs. */
export function drawingDraftStore(): DraftStore {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (database) return database;
    database = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open("bb-studio-drawing-drafts", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("drafts", { keyPath: "id" });
        store.createIndex("drawingId", "drawingId");
      };
      request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      request.onerror = () => { database = null; reject(request.error ?? new Error("Local drawing storage failed.")); };
      request.onblocked = () => { blocked = true; database = null; reject(new Error("Local drawing storage is blocked by another window.")); };
    }).catch(error => { database = null; throw error; });
    return database;
  };
  const transaction = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode, { durability: "strict" });
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Local drawing storage transaction failed."));
      run(tx.objectStore("drafts"), result => { value = result; });
    });
  };
  return {
    list: drawingId => transaction("readonly", (store, result) => {
      const request = store.index("drawingId").getAll(drawingId);
      request.onsuccess = () => result((request.result as DrawingDraft[]).sort((a, b) => b.updatedAt - a.updatedAt));
    }),
    put: draft => transaction<void>("readwrite", (store, result) => { store.put(draft); result(undefined); }),
    remove: (id, token) => transaction<void>("readwrite", (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => { if (request.result?.token === token) store.delete(id); result(undefined); };
    }),
  };
}

/** Coalesces large scene writes and never lets an old server ack delete a newer draft. */
export class DrawingDraftSession {
  private latest: DrawingDraft | null = null;
  private persisted: DrawingDraft | null = null;
  private running: Promise<void> | null = null;
  private cleanup: { data: string; revision: number } | null = null;
  constructor(private readonly store: DraftStore, private readonly drawingId: string, readonly id: string, private readonly status: (error: unknown) => void, private readonly token: () => string = () => crypto.randomUUID()) {}

  stage(data: string, baseRevision: number): void {
    this.cleanup = null;
    this.latest = { id: this.id, drawingId: this.drawingId, token: this.token(), data, baseRevision, updatedAt: Date.now() };
    void this.retry();
  }

  retry(): Promise<void> {
    if (this.running) return this.running;
    if (this.cleanup) {
      const { data, revision } = this.cleanup;
      this.cleanup = null;
      return this.acknowledged(data, revision);
    }
    if (!this.latest || this.latest === this.persisted) return Promise.resolve();
    this.running = (async () => {
      try {
        while (this.latest && this.latest !== this.persisted) {
          const current = this.latest;
          await this.store.put(current);
          this.persisted = current;
          this.status(null);
        }
      } catch (error) { this.status(error); }
      finally { this.running = null; }
    })();
    return this.running;
  }

  async acknowledged(data: string, revision: number): Promise<void> {
    const current = this.latest;
    if (!current) return;
    if (current.data !== data) { this.stage(current.data, revision); return; }
    await this.running;
    if (this.latest !== current) {
      if (this.latest) this.stage(this.latest.data, revision);
      return;
    }
    const persisted = this.persisted;
    try {
      if (persisted) await this.store.remove(persisted.id, persisted.token);
      if (this.latest === current) { this.latest = null; this.persisted = null; this.cleanup = null; this.status(null); }
    } catch (error) { this.cleanup = { data, revision }; this.status(error); }
  }

  async discard(): Promise<void> {
    await this.running;
    const persisted = this.persisted;
    if (persisted) await this.store.remove(persisted.id, persisted.token);
    this.latest = null;
    this.persisted = null;
  }
}
