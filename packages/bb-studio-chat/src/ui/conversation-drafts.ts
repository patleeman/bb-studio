import { z } from "zod";
import type { ItemQuote } from "@bb-studio/kit/format";
import { quote, ref, type ItemRef } from "../contract";

export const CHATS_PATH = "chats";
export const CONVERSATION_STARTED = "bb-studio-chat:started";
const ROOT = `/plugins/studio-chat/${CHATS_PATH}`;
const STORE = "quotes";
const savedQuote = z.object({ id: z.uuid(), item: ref, quote, createdAt: z.number() });
export type QuoteDraft = z.infer<typeof savedQuote>;

export const itemDraftPath = (item: ItemRef) => `${ROOT}/item/${encodeURIComponent(JSON.stringify({ pluginId: item.pluginId, id: item.id }))}`;
export const quoteDraftPath = (id: string) => `${ROOT}/quote/${id}`;

export function draftRoute(subPath: string | undefined): { kind: "plain" } | { kind: "item"; item: ItemRef } | { kind: "quote"; id: string } | null {
  if (!subPath) return { kind: "plain" };
  if (subPath.startsWith("quote/")) {
    const id = z.uuid().safeParse(subPath.slice(6));
    return id.success ? { kind: "quote", id: id.data } : null;
  }
  if (!subPath.startsWith("item/")) return null;
  const raw = subPath.slice(5);
  for (const decode of [false, true]) {
    try {
      const item = ref.safeParse(JSON.parse(decode ? decodeURIComponent(raw) : raw));
      if (item.success) return { kind: "item", item: item.data };
    } catch {}
  }
  return null;
}

export class QuoteDrafts {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: () => IDBFactory = () => indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory().open("bb-studio-chat:drafts", 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
        request.onsuccess = () => {
          if (blocked) { request.result.close(); return; }
          request.result.onversionchange = () => { request.result.close(); this.db = null; };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error("Close other BB tabs and try saving the quote again.")); };
      }).catch((error: unknown) => { this.db = null; throw error; });
    }
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Couldn't save the quote draft."));
    });
  }

  async save(item: ItemRef, selection: ItemQuote): Promise<QuoteDraft> {
    const draft = savedQuote.parse({ id: crypto.randomUUID(), item, quote: selection, createdAt: Date.now() });
    await this.run("readwrite", store => store.put(draft));
    return draft;
  }

  async get(id: string): Promise<QuoteDraft | null> {
    const result = await this.run("readonly", store => store.get(id));
    return result === undefined ? null : savedQuote.parse(result);
  }

  async remove(id: string): Promise<void> {
    await this.run("readwrite", store => store.delete(id));
  }
}

export const quoteDrafts = new QuoteDrafts();
