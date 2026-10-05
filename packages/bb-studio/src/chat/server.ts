import { defineItemMention } from "@bb-studio/kit/server";
import { studioServices } from "@bb-studio/kit/server";
import { quoteMessage } from "@bb-studio/kit/format";
// bb-studio-chat server.
//
// - `viewing` asks Studio which item a path opens, so the chat knows what's
//   on screen without per-kind code.
// - `start` begins a thread about that item. Pages keeps its own page chats,
//   so a page goes through Pages' `work`; other items get a pill that our
//   mention provider resolves into a pointer note (src/context.ts).
// - Each item has a home thread for its chat and quotes (kv
//   `link:<plugin>:<id>`): the one started or picked for it, else the thread
//   that made it, as Studio records. `send` posts a quote there.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STUDIO_ITEM_AT_METHOD, STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { MENTION_PROVIDER_ID, pagesSchemas, rpcContract, schemas, type ItemRef } from "./contract";
import { itemKey, missingNote, parseItemKey, pointerNote, toViewed, withItemPill } from "./context";

const PLUGIN_ID = "studio";
const PAGES_PLUGIN_ID = "pages";
const CALL_TIMEOUT_MS = 10_000;
/** Starting a page chat creates a thread, which can take a while; don't wait forever. */
const START_TIMEOUT_MS = 60_000;

interface Link {
  /** null: unlinked on purpose, so the thread that made the item doesn't stand in. */
  threadId: string | null;
  at: number;
}

interface HomeThread {
  threadId: string;
  title: string;
  origin: "chosen" | "created";
}

export async function registerChat(bb: BbPluginApi) {
  const services = studioServices(bb.sdk);
  const itemAt = (input: { path: string } | ItemRef) =>
    bb.sdk.plugins.callRpc({
      pluginId: STUDIO_PLUGIN_ID,
      method: STUDIO_ITEM_AT_METHOD,
      input,
      outputSchema: schemas.itemAt.output,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

  const linkKey = (ref: ItemRef) => `link:${itemKey(ref)}`;
  const setLink = async (ref: ItemRef, threadId: string) => {
    const at = Date.now();
    await bb.storage.kv.set(linkKey(ref), { threadId, at } satisfies Link);
    await services.linkThread({ threadId, ref, role: "chat", state: "working", createdAt: at, updatedAt: at, metadata: {} }).catch(() => { /* Studio is optional. */ });
  };

  /** Pages records its own page chats; the newest one that still exists. */
  const lastPageChat = async (pageId: string): Promise<Link | null> => {
    try {
      const { chats } = await bb.sdk.plugins.callRpc({
        pluginId: PAGES_PLUGIN_ID,
        method: "chats",
        input: { pageId },
        outputSchema: pagesSchemas.chats,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const newest = [...chats].sort((a, b) => b.createdAt - a.createdAt)[0];
      return newest ? { threadId: newest.threadId, at: newest.createdAt } : null;
    } catch {
      return null;
    }
  };

  /** The thread's title, or null when it's gone or archived. */
  const liveThread = async (threadId: string): Promise<string | null> => {
    try {
      const thread = (await bb.sdk.threads.get({ threadId })) as { archivedAt?: number | null; title?: string | null; titleFallback?: string | null };
      if (thread.archivedAt) return null;
      return thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread";
    } catch {
      return null;
    }
  };

  const home = async (ref: ItemRef): Promise<HomeThread | null> => {
    const own = await bb.storage.kv.get<Link>(linkKey(ref));
    const pages = ref.pluginId === PAGES_PLUGIN_ID ? await lastPageChat(ref.id) : null;
    const newest = [own, pages].filter((link): link is Link => !!link).sort((a, b) => b.at - a.at)[0];
    if (newest && !newest.threadId) return null;
    if (newest?.threadId) {
      const title = await liveThread(newest.threadId);
      if (title) return { threadId: newest.threadId, title, origin: "chosen" };
    }
    const { threads } = await services.threads(ref).catch(() => ({ threads: [] }));
    for (const made of threads.filter((thread) => thread.role === "created").sort((a, b) => b.createdAt - a.createdAt)) {
      const title = await liveThread(made.threadId);
      if (title) return { threadId: made.threadId, title, origin: "created" };
    }
    return null;
  };

  bb.ui.registerMentionProvider(defineItemMention({
    id: MENTION_PROVIDER_ID,
    label: "On screen",
    // Pills come from the chat itself; each add-on's own provider finds items by name.
    search: () => [],
    async resolve(key) {
      const ref = parseItemKey(key);
      if (!ref) return { context: missingNote(key) };
      const { item, kind } = await itemAt(ref).catch(() => ({ item: null, kind: null }));
      return { context: item ? pointerNote(item, kind) : missingNote(key) };
    },
  }));

  bb.rpc.register(rpcContract, {
    "chat.importLinks": async ({ links }) => {
      let imported = 0;
      for (const link of links) {
        const own = await bb.storage.kv.get<Link>(linkKey(link.item));
        // An explicit unlink is a saved choice too. Never replace newer Studio work.
        if (own && own.at >= link.at) continue;
        await bb.storage.kv.set(linkKey(link.item), { threadId: link.threadId, at: link.at } satisfies Link);
        imported += 1;
      }
      return { imported };
    },
    "chat.viewing": async ({ path }) => {
      if (!path.startsWith("/plugins/")) return { item: null };
      const { item, kind } = await itemAt({ path }).catch(() => ({ item: null, kind: null }));
      return { item: item && !item.archived && !kind?.hasOwnChat ? toViewed(item, kind) : null };
    },
    "chat.subject": async (ref) => {
      const { item, kind } = await itemAt(ref);
      return { item: item && !item.archived ? toViewed(item, kind) : null };
    },
    "chat.start": async ({ item: ref, request }) => {
      const found = ref ? await itemAt(ref) : null;
      if (ref && (!found?.item || found.item.archived)) throw new Error("That Studio item is archived or gone.");
      if (ref?.pluginId === PAGES_PLUGIN_ID) {
        const { threadId } = await bb.sdk.plugins.callRpc({
          pluginId: PAGES_PLUGIN_ID,
          method: "work",
          input: { id: ref.id, request },
          outputSchema: pagesSchemas.work,
          signal: AbortSignal.timeout(START_TIMEOUT_MS),
        });
        await setLink(ref, threadId);
        return { threadId };
      }
      const item = found?.item ?? null;
      const input = item
        ? withItemPill(request.input, {
            pluginId: PLUGIN_ID,
            wireId: `${MENTION_PROVIDER_ID}:${itemKey(item)}`,
            label: item.title,
            icon: found?.kind?.icon ?? null,
          })
        : request.input;
      const thread = await bb.sdk.threads.spawn({ ...request, input });
      if (ref) await setLink(ref, thread.id);
      return { threadId: thread.id };
    },
    "chat.home": async (ref) => ({ thread: await home(ref) }),
    "chat.link": async ({ threadId, ...ref }) => {
      const title = await liveThread(threadId);
      if (!title) throw new Error("That thread is archived or gone.");
      await setLink(ref, threadId);
      return { thread: { threadId, title, origin: "chosen" as const } };
    },
    "chat.unlink": async (ref) => {
      await bb.storage.kv.set(linkKey(ref), { threadId: null, at: Date.now() } satisfies Link);
      return { ok: true };
    },
    "chat.send": async ({ item: ref, quote }) => {
      const thread = await home(ref);
      if (!thread) return { threadId: null };
      const found = await itemAt(ref).catch(() => null);
      // On its own line after the item's pill, so a quoted passage reads as a quote.
      const text = { type: "text" as const, text: `\n${quoteMessage(quote)}`, mentions: [] };
      const input = found?.item
        ? withItemPill([text], {
            pluginId: PLUGIN_ID,
            wireId: `${MENTION_PROVIDER_ID}:${itemKey(found.item)}`,
            label: found.item.title,
            icon: found.kind?.icon ?? null,
          })
        : [text];
      // A comment waits for the thread's current turn instead of cutting in.
      const post = (withImage: boolean) =>
        bb.sdk.threads.send({
          threadId: thread.threadId,
          input: withImage && quote.image ? [...input, { type: "image", url: quote.image }] : input,
          mode: "queue-if-active",
        });
      // The area's coordinates are in the text, so the quote still lands if
      // the thread's provider won't take the picture.
      await post(true).catch((error: unknown) => (quote.image ? post(false) : Promise.reject(error)));
      return { threadId: thread.threadId };
    },
  });
}
