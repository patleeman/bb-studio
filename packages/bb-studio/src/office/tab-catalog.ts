import { itemAtPath } from "@bb-studio/kit/contract";
import { rpcErrorStatus } from "@bb-studio/kit/server";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { StudioHub } from "../hub";
import type { SearchIndex } from "../search-index";
import type { OfficeSpaceStore } from "./space-store";
import type { Inbox } from "./inbox";
import type { ModuleServices } from "../modules/services";
import { officeTeam } from "./team";
import { officeTalk } from "./talk";
import { matches, type TabCatalog } from "./tab-service";
import type { TabTarget } from "./tabs-contract";

/**
 * Reads shared across requests for a moment. Clients load the tab list in
 * bursts (each Studio change, each page open), and every load resolved every
 * tab again: a BB thread lookup per thread tab, the team, the channels and
 * the Inbox count. Bursts now share one answer; thread existence, which
 * rarely changes, is kept a little longer.
 */
const shared = new Map<string, { at: number; value: Promise<unknown> }>();
let sharing = true;
/** Tests that change data between reads turn sharing off. */
export function shareTabReads(on: boolean): void { sharing = on; shared.clear(); }
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (!sharing) return load();
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  shared.set(key, { at: Date.now(), value });
  value.catch(() => { if (shared.get(key)?.value === value) shared.delete(key); });
  return value;
}
const BURST_MS = 3_000;
const THREAD_MS = 30_000;

export function tabCatalog(spaceId: string, deps: {
  bb: BbPluginApi; hub: StudioHub; spaces: OfficeSpaceStore;
  inbox: Inbox; search: SearchIndex; modules?: ModuleServices;
}): TabCatalog {
  const { bb, hub, spaces, inbox, search, modules } = deps;
  const space = spaces.get(spaceId);
  const belongs = (projectId: string | null) => spaces.forProject(projectId).id === spaceId;
  const once = <T>(fn: () => Promise<T>) => { let promise: Promise<T> | undefined; return () => promise ??= fn(); };
  const bots = once(() => cached("team:all", BURST_MS, () => officeTeam("all", spaces, inbox, modules).then(r => r.bots)));
  const conversations = once(() => cached("talk:all", BURST_MS, async () => modules ? (await officeTalk("all", modules, spaces)).conversations : []));
  const overview = once(() => cached("overview", BURST_MS, () => hub.overview()));
  const threads = new Map<string, Promise<Awaited<ReturnType<typeof bb.sdk.threads.get>> | null>>();
  const thread = (id: string) => {
    if (!threads.has(id)) threads.set(id, cached(`thread:${id}`, THREAD_MS, () => bb.sdk.threads.get({ threadId: id }).catch(error => {
      if (rpcErrorStatus(error) === 404) return null;
      throw error;
    })));
    return threads.get(id)!;
  };
  const itemReads = new Map<string, ReturnType<StudioHub["itemsResult"]>>();
  // Items asked for in the same tick go to their provider in one read.
  const batches = new Map<string, { ids: Set<string>; run: ReturnType<StudioHub["itemsResult"]> }>();
  const readItem = (pluginId: string, id: string) => {
    let batch = batches.get(pluginId);
    if (!batch) {
      const ids = new Set<string>();
      const run = Promise.resolve().then(() => { batches.delete(pluginId); return hub.itemsResult(pluginId, [...ids]); });
      batch = { ids, run };
      batches.set(pluginId, batch);
    }
    batch.ids.add(id);
    return batch.run;
  };
  const resolve = async (ref: string): Promise<TabTarget | null> => {
    const base = { ref, title: null, icon: null, href: null };
    if (ref.startsWith("thread:")) {
      const value = await thread(ref.slice(7));
      return value && !value.deletedAt ? { ...base, kind: "thread" } : null;
    }
    if (ref === "office:home") return { ...base, kind: "home", title: "Home", icon: "studio/home", href: "/plugins/studio/office" };
    if (ref === "office:inbox") return { ...base, kind: "inbox", title: "Inbox", icon: "studio/inbox", href: "/plugins/studio/office-inbox", badge: (await cached(`counts:${spaceId}`, BURST_MS, () => inbox.counts([spaceId]))).bySpace[spaceId]?.requests ?? 0 };
    if (ref === "library") return { ...base, kind: "library", title: "Library", icon: "studio/studio", href: "/plugins/studio/studio" };
    if (ref.startsWith("library:")) {
      const kind = ref.slice(8);
      const snapshot = await overview();
      const known = snapshot.providers.flatMap(p => p.kinds).find(k => k.id === kind);
      if (!known && (!snapshot.discoveryComplete || snapshot.providers.some(p => p.state !== "ready"))) throw new Error("Wait for item providers before resolving this library view.");
      if (!known) return null;
      return { ...base, kind: "library", title: known.plural, icon: known.icon, itemKind: kind, href: `/plugins/studio/studio/${encodeURIComponent(kind)}` };
    }
    if (ref.startsWith("bot:")) {
      const bot = (await bots()).find(b => b.id === ref.slice(4));
      return bot ? { ...base, kind: "bot", title: bot.name, icon: bot.avatar, href: `/plugins/studio/office-team/${encodeURIComponent(bot.id)}`, providerId: bot.providerId, botState: bot.state } : null;
    }
    if (ref.startsWith("conversation:")) {
      const conversation = (await conversations()).find(c => c.id === ref.slice(13));
      return conversation ? { ...base, kind: "conversation", title: conversation.title, icon: "MessagesSquare", href: conversation.href, needsYou: conversation.needsYou, unread: conversation.unread } : null;
    }
    if (ref.startsWith("item:")) {
      const [, pluginId, ...parts] = ref.split(":");
      const id = parts.join(":");
      const key = `${pluginId}:${id}`;
      if (!itemReads.has(key)) itemReads.set(key, readItem(pluginId!, id));
      const result = await itemReads.get(key)!;
      if (result.status === "unavailable") throw new Error(result.error);
      const item = result.status === "ready" ? result.items.find(i => i.id === id) : undefined;
      if (!item && result.status === "ready" && !result.complete) throw new Error("Item provider returned an incomplete snapshot.");
      return item ? { ...base, kind: "item", title: item.title, icon: item.icon, href: item.href, itemKind: item.kind } : null;
    }
    return null;
  };
  return {
    resolve,
    spaceFor: async ref => {
      if (ref.startsWith("thread:")) {
        const value = await thread(ref.slice(7));
        return value ? spaces.forProject(value.projectId).id : spaceId;
      }
      if (ref.startsWith("item:")) {
        await resolve(ref);
        const result = await itemReads.get(ref.slice(5))!;
        const item = result.status === "ready" ? result.items.find(i => i.id === ref.split(":").slice(2).join(":")) : null;
        return item ? spaces.forProject(item.projectId).id : spaceId;
      }
      return spaceId;
    },
    essentials: async () => ["office:inbox", ...(await bots()).filter(b => b.spaceId === spaceId).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0,3).map(b => `bot:${b.id}`)],
    atPath: async href => {
      if (!href.startsWith("/") || href.startsWith("//")) return null;
      const path = href.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
      if (path === "/plugins/studio/office") return resolve("office:home");
      if (path === "/plugins/studio/office-inbox") return resolve("office:inbox");
      if (path === "/plugins/studio/studio") return resolve("library");
      const threadPath = path.match(/^\/threads\/([^/]+)$/);
      if (threadPath) {
        let id: string;
        try { id = decodeURIComponent(threadPath[1]!); } catch { return null; }
        return resolve(`thread:${id}`);
      }
      const library = path.match(/^\/plugins\/studio\/studio\/([^/]+)$/);
      const bot = path.match(/^\/plugins\/studio\/office-team\/([^/]+)(?:\/(?:chat|tasks|profile))?$/);
      try {
        if (library) return resolve(`library:${decodeURIComponent(library[1]!)}`);
        if (bot) return resolve(`bot:${decodeURIComponent(bot[1]!)}`);
      } catch { return null; }
      const conversation = itemAtPath(await conversations(), path);
      if (conversation) return resolve(`conversation:${conversation.id}`);
      const item = itemAtPath((await overview()).items, path);
      return item ? resolve(`item:${item.pluginId}:${item.id}`) : null;
    },
    // BB's own thread search: titles and messages, active and archived, so
    // the address bar finds any thread in this Space, not only open ones.
    searchThreads: async query => {
      if (!query.trim()) return [];
      const { active, archived } = await bb.sdk.threads.search({ query, limitPerGroup: "20" });
      return [...active.results, ...archived.results].map(result => result.thread)
        .filter(thread => !thread.deletedAt && !thread.parentThreadId && thread.visibility !== "hidden" && belongs(thread.projectId))
        .map(thread => ({ ref: `thread:${thread.id}`, kind: "thread" as const, title: thread.title || thread.titleFallback || "Untitled", icon: null, href: null, ...(thread.archivedAt ? { itemKind: "archived" } : {}) }));
    },
    reviveThread: async threadId => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.archivedAt) await bb.sdk.threads.unarchive({ threadId });
    },
    seedThreads: async ids => {
      const found: string[] = [];
      for (const id of new Set(ids)) {
        const thread = await bb.sdk.threads.get({ threadId: id }).catch(error => {
          if (rpcErrorStatus(error) === 404) return null;
          throw error;
        });
        if (thread && !thread.archivedAt && belongs(thread.projectId)) found.push(`thread:${id}`);
      }
      return found;
    },
    search: async query => {
      await search.ensure();
      // Filter in SQL per project before bounding, so other Spaces cannot crowd out results.
      const projectIds: (string | null)[] = [...space.projectIds, ...(space.isDefault ? [null] : [])];
      const hits = projectIds.flatMap(projectId => query.trim() ? search.search(query, { projectId, limit: 100 }) : search.recent(100, { projectId }))
        .sort((a,b) => b.score - a.score || b.updatedAt - a.updatedAt);
      const itemTargets = await Promise.all(hits.map(hit => resolve(`item:${hit.ref.pluginId}:${hit.ref.id}`)));
      const refs = ["library", "office:inbox", "office:home",
        ...(await bots()).filter(b => b.spaceId === spaceId).map(b => `bot:${b.id}`), ...(modules ? (await officeTalk(spaceId, modules, spaces)).conversations : []).map(c => `conversation:${c.id}`),
        ...new Set((await overview()).providers.flatMap(p => p.kinds).map(k => `library:${k.id}`))];
      const otherTargets = (await Promise.all(refs.map(resolve))).filter((t): t is TabTarget => !!t).filter(t => matches(t, query));
      return [...itemTargets.filter((t): t is TabTarget => !!t), ...otherTargets];
    },
  };
}
