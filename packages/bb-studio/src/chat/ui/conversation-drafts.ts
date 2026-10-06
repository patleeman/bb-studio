import { z } from "zod";
import type { ItemQuote } from "@bb-studio/kit/format";
import { quote, ref, type ItemRef } from "../schemas";

export const CHATS_PATH = "chats";
export const CHAT_ICON = "MessageSquare";
export const CONVERSATION_STARTED = "bb-studio-chat:started";
const ROOT = `/plugins/studio/${CHATS_PATH}`;
const STORE = "quotes";
/** Quote drafts never sent or whose tab was closed are dropped after this long. */
export const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000;
const savedQuote = z.object({ id: z.uuid(), item: ref, quote, createdAt: z.number() });
export type QuoteDraft = z.infer<typeof savedQuote>;

const refSegment = (item: ItemRef) => encodeURIComponent(JSON.stringify({ pluginId: item.pluginId, id: item.id }));
export const itemDraftPath = (item: ItemRef) => `${ROOT}/item/${refSegment(item)}`;
/** Picking the thread an item's chat and quotes go to. */
export const chooseThreadPath = (item: ItemRef) => `${ROOT}/choose/${refSegment(item)}`;
export const quoteDraftPath = (id: string) => `${ROOT}/quote/${id}`;

export type DraftRoute = { kind: "plain" } | { kind: "item" | "choose"; item: ItemRef } | { kind: "quote"; id: string };

export function draftRoute(subPath: string | undefined): DraftRoute | null {
  if (!subPath) return { kind: "plain" };
  if (subPath.startsWith("quote/")) {
    const id = z.uuid().safeParse(subPath.slice(6));
    return id.success ? { kind: "quote", id: id.data } : null;
  }
  const kind = subPath.startsWith("item/") ? "item" : subPath.startsWith("choose/") ? "choose" : null;
  if (!kind) return null;
  const raw = subPath.slice(kind.length + 1);
  for (const decode of [false, true]) {
    try {
      const item = ref.safeParse(JSON.parse(decode ? decodeURIComponent(raw) : raw));
      if (item.success) return { kind, item: item.data };
    } catch {}
  }
  return null;
}

export class QuoteDrafts {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly now: () => number = Date.now,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory().open("bb-studio-chat:drafts", 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
        request.onsuccess = () => {
          if (blocked) { request.result.close(); return; }
          request.result.onversionchange = () => { request.result.close(); this.db = null; };
          this.prune(request.result);
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error("Close other BB tabs and try saving the quote again.")); };
      }).catch((error: unknown) => { this.db = null; throw error; });
    }
    return this.db;
  }

  /** Best effort: later transactions on the store wait for this one. */
  private prune(db: IDBDatabase): void {
    const cutoff = this.now() - STALE_DRAFT_MS;
    try {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.onerror = event => event.preventDefault();
      const cursor = transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const createdAt = (entry.value as { createdAt?: unknown } | undefined)?.createdAt;
        if (typeof createdAt !== "number" || createdAt < cutoff) entry.delete();
        entry.continue();
      };
    } catch {}
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
    const draft = savedQuote.parse({ id: crypto.randomUUID(), item, quote: selection, createdAt: this.now() });
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
