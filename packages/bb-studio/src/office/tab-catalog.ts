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

export function tabCatalog(spaceId: string, deps: {
  bb: BbPluginApi; hub: StudioHub; spaces: OfficeSpaceStore;
  inbox: Inbox; search: SearchIndex; modules?: ModuleServices;
}): TabCatalog {
  const { bb, hub, spaces, inbox, search, modules } = deps;
  const space = spaces.get(spaceId);
  const belongs = (projectId: string | null) => spaces.forProject(projectId).id === spaceId;
  const once = <T>(fn: () => Promise<T>) => { let promise: Promise<T> | undefined; return () => promise ??= fn(); };
  const bots = once(() => officeTeam(spaceId, spaces, inbox, modules).then(r => r.bots));
  const conversations = once(async () => modules ? (await officeTalk(spaceId, modules, spaces)).conversations : []);
  const overview = once(() => hub.overview());
  const itemReads = new Map<string, ReturnType<StudioHub["itemsResult"]>>();
  const resolve = async (ref: string): Promise<TabTarget | null> => {
    const base = { ref, title: null, icon: null, href: null };
    if (ref.startsWith("thread:")) return { ...base, kind: "thread" }; // Client owns thread resolution.
    if (ref === "office:home") return { ...base, kind: "home", title: "Home", icon: "studio/home", href: "/plugins/studio/office" };
    if (ref === "office:inbox") return { ...base, kind: "inbox", title: "Inbox", icon: "studio/inbox", href: "/plugins/studio/office-inbox", badge: (await inbox.counts([spaceId])).bySpace[spaceId]?.requests ?? 0 };
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
      if (!itemReads.has(key)) itemReads.set(key, hub.itemsResult(pluginId!, [id]));
      const result = await itemReads.get(key)!;
      if (result.status === "unavailable") throw new Error(result.error);
      const item = result.status === "ready" ? result.items.find(i => i.id === id) : undefined;
      if (!item && result.status === "ready" && !result.complete) throw new Error("Item provider returned an incomplete snapshot.");
      return item && belongs(item.projectId) ? { ...base, kind: "item", title: item.title, icon: item.icon, href: item.href, itemKind: item.kind } : null;
    }
    return null;
  };
  return {
    resolve,
    essentials: async () => ["office:inbox", ...(await bots()).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0,3).map(b => `bot:${b.id}`)],
    atPath: async href => {
      if (!href.startsWith("/") || href.startsWith("//")) return null;
      const path = href.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
      if (path === "/plugins/studio/office") return resolve("office:home");
      if (path === "/plugins/studio/office-inbox") return resolve("office:inbox");
      if (path === "/plugins/studio/studio") return resolve("library");
      const library = path.match(/^\/plugins\/studio\/studio\/([^/]+)$/);
      const bot = path.match(/^\/plugins\/studio\/office-team\/([^/]+)(?:\/(?:chat|tasks|profile))?$/);
      try {
        if (library) return resolve(`library:${decodeURIComponent(library[1]!)}`);
        if (bot) return resolve(`bot:${decodeURIComponent(bot[1]!)}`);
      } catch { return null; }
      const conversation = itemAtPath(await conversations(), path);
      if (conversation) return resolve(`conversation:${conversation.id}`);
      const item = itemAtPath((await overview()).items.filter(i => belongs(i.projectId)), path);
      return item ? resolve(`item:${item.pluginId}:${item.id}`) : null;
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
        ...(await bots()).map(b => `bot:${b.id}`), ...(await conversations()).map(c => `conversation:${c.id}`),
        ...new Set((await overview()).providers.flatMap(p => p.kinds).map(k => `library:${k.id}`))];
      const otherTargets = (await Promise.all(refs.map(resolve))).filter((t): t is TabTarget => !!t).filter(t => matches(t, query));
      return [...itemTargets.filter((t): t is TabTarget => !!t), ...otherTargets];
    },
  };
}
