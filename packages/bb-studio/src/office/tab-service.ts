import type { TabTarget, Tab } from "./tabs-contract";
import type { OfficeInput } from "./contract";
import { OfficeTabs } from "./tabs";

export interface TabCatalog {
  resolve(ref: string): Promise<TabTarget | null>;
  essentials(): Promise<string[]>;
  atPath(href: string): Promise<TabTarget | null>;
  seedThreads(ids: string[]): Promise<string[]>;
  search(query: string): Promise<TabTarget[]>;
}

/** A request-scoped catalog batches provider reads. A provider failure throws,
 * so only confirmed missing targets are removed from durable storage. */
export function officeTabHandlers(store: OfficeTabs, catalog: (spaceId: string) => TabCatalog) {
  const resolved = async (spaceId: string, refs: string[], source = catalog(spaceId)) => {
    const targets = await Promise.all(refs.map(ref => source.resolve(ref)));
    store.forget(spaceId, refs.filter((_, i) => targets[i] === null));
    return targets.filter((t): t is TabTarget => t !== null).map(t => store.tab(spaceId, t));
  };
  const required = async (spaceId: string, ref: string) => {
    const tab = (await resolved(spaceId, [ref]))[0];
    if (!tab) throw new Error("That tab target no longer exists in this Space.");
    return tab;
  };
  return {
    tabs_get: async ({ spaceId }: OfficeInput<"tabs_get">) => {
      store.archiveOld(spaceId);
      const tabs = await resolved(spaceId, store.rows(spaceId).map(t => t.ref));
      return { seeded: store.seeded(spaceId), essentials: tabs.filter(t => t.zone === "essential"), pinned: tabs.filter(t => t.zone === "pinned"), today: tabs.filter(t => t.zone === "today"), folders: store.folders(spaceId) };
    },
    tabs_seed: async ({ spaceId, pinnedThreadIds }: OfficeInput<"tabs_seed">) => {
      if (!store.seeded(spaceId)) {
        const source = catalog(spaceId);
        const [essentials, threads] = await Promise.all([source.essentials(), source.seedThreads(pinnedThreadIds)]);
        const refs = [...new Set([...essentials, ...threads])];
        const live = new Set((await resolved(spaceId, refs, source)).map(t => t.ref));
        store.seed(spaceId, essentials.filter(r => live.has(r)), threads.filter(r => live.has(r)));
      }
      return { ok: true as const };
    },
    tabs_open: async (input: OfficeInput<"tabs_open">) => {
      const { spaceId } = input;
      const target = input.ref !== undefined ? await required(spaceId, input.ref) : await catalog(spaceId).atPath(input.href);
      if (!target) return { tab: null };
      store.open(spaceId, target.ref);
      return { tab: store.tab(spaceId, target) };
    },
    tabs_move: async ({ spaceId, ref, zone, folderId, index }: OfficeInput<"tabs_move">) => {
      await required(spaceId, ref);
      store.move(spaceId, ref, zone, folderId, index);
      return { ok: true as const };
    },
    tabs_archived: async ({ spaceId, query = "", limit = 40 }: OfficeInput<"tabs_archived">) => {
      const tabs = await resolved(spaceId, store.rows(spaceId).filter(t => t.zone === "archived").map(t => t.ref));
      return { tabs: tabs.filter(t => matches(t, query)).sort((a,b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || b.openedAt - a.openedAt || a.ref.localeCompare(b.ref)).slice(0, limit) };
    },
    tab_folder_create: ({ spaceId, name }: OfficeInput<"tab_folder_create">) => ({ folder: store.createFolder(spaceId, name) }),
    tab_folder_update: ({ folderId, ...patch }: OfficeInput<"tab_folder_update">) => ({ folder: store.updateFolder(folderId, patch) }),
    tab_folder_delete: ({ folderId }: OfficeInput<"tab_folder_delete">) => { store.deleteFolder(folderId); return { ok: true as const }; },
    office_search: async ({ spaceId, query, limit = 40 }: OfficeInput<"office_search">) => {
      const source = catalog(spaceId);
      const [hits, saved] = await Promise.all([source.search(query), resolved(spaceId, store.rows(spaceId).filter(t => t.zone === "archived").map(t => t.ref), source)]);
      const results = new Map<string, Tab>();
      for (const hit of hits) if (hit.kind !== "thread") results.set(hit.ref, store.tab(spaceId, hit));
      for (const tab of saved) if (tab.kind !== "thread" && matches(tab, query)) results.set(tab.ref, tab);
      return { results: [...results.values()].slice(0, limit) };
    },
  };
}
export function matches(tab: TabTarget, query: string): boolean {
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => `${tab.title ?? ""} ${tab.ref} ${tab.itemKind ?? ""}`.toLocaleLowerCase().includes(word));
}
