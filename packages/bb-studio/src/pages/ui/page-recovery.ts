import * as Y from "yjs";

export interface PageRecoveryStore {
  load(key: string): Promise<Uint8Array | null>;
  save(key: string, state: Uint8Array): Promise<void>;
  removeIfUnchanged(key: string, state: Uint8Array): Promise<void>;
}

export function sameState(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Each read/merge/write is one transaction, so two tabs cannot overwrite edits.
 * IndexedDB is origin-scoped; the key additionally contains the page and origin. */
export class IndexedPageRecovery implements PageRecoveryStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: () => IDBFactory = () => indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory().open("bb-studio-pages:recovery", 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore("pages");
        request.onerror = () => reject(request.error ?? new Error("Local recovery storage is unavailable."));
        request.onblocked = () => { blocked = true; reject(new Error("Close other BB tabs, then retry local recovery storage.")); };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.db = null; };
          resolve(db);
        };
      }).catch((error: unknown) => { this.db = null; throw error; });
    }
    return this.db;
  }

  async load(key: string): Promise<Uint8Array | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pages", "readonly");
      const request = tx.objectStore("pages").get(key);
      tx.oncomplete = () => resolve(request.result ? new Uint8Array(request.result) : null);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Could not read local page recovery."));
    });
  }

  private async change(key: string, state: Uint8Array, remove: boolean): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pages", "readwrite");
      const store = tx.objectStore("pages");
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const previous = request.result ? new Uint8Array(request.result) : null;
          if (remove) {
            // A different tab may have written newer work while the ACK traveled.
            if (previous && sameState(previous, state)) store.delete(key);
          } else {
            const doc = new Y.Doc();
            try {
              if (previous) Y.applyUpdate(doc, previous);
              Y.applyUpdate(doc, state);
              store.put(Y.encodeStateAsUpdate(doc), key);
            } finally { doc.destroy(); }
          }
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Could not save local page recovery."));
    });
  }

  save(key: string, state: Uint8Array): Promise<void> { return this.change(key, state, false); }
  removeIfUnchanged(key: string, state: Uint8Array): Promise<void> { return this.change(key, state, true); }
}

export const pageRecovery = new IndexedPageRecovery();
