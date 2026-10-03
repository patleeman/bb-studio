import type { TabTarget, Tab } from "./tabs-contract";
import type { OfficeInput } from "./contract";
import { OfficeTabs } from "./tabs";

export interface TabCatalog {
  spaceFor?(ref: string): Promise<string>;
  resolve(ref: string): Promise<TabTarget | null>;
  essentials(): Promise<string[]>;
  atPath(href: string): Promise<TabTarget | null>;
  seedThreads(ids: string[]): Promise<string[]>;
  search(query: string): Promise<TabTarget[]>;
  searchThreads(query: string): Promise<TabTarget[]>;
  /** Unarchives a BB thread opened as a tab, so it comes back to the sidebar. */
  reviveThread?(threadId: string): Promise<void>;
}

/** A request-scoped catalog batches provider reads. A provider failure throws,
 * so only confirmed missing targets are removed from durable storage. */
export function officeTabHandlers(store: OfficeTabs, catalog: (spaceId: string) => TabCatalog) {
  const targetFor = async (spaceId: string, ref: string, source = catalog(spaceId)): Promise<TabTarget | null> => {
    if (!ref.startsWith("split:")) return source.resolve(ref);
    const refs = store.split(spaceId, ref);
    if (!refs) return null;
    const members = (await Promise.all(refs.map(r => source.resolve(r)))).filter((t): t is TabTarget => t !== null);
    const surviving = store.cleanSplit(spaceId, ref, members.map(t => t.ref));
    if (!surviving) return null;
    if (surviving !== ref) return members[0]!;
    return { ref, kind: "split", title: members.map(t => t.title ?? (t.kind === "thread" ? "Thread" : "Untitled")).join(" | "), icon: "Columns2", href: null,
      members: members.map(t => { if (t.kind === "split") throw new Error("Nested splits are not supported."); return { ...t, kind: t.kind }; }) };
  };
  const resolved = async (spaceId: string, refs: string[], source = catalog(spaceId)) => {
    const targets = await Promise.all(refs.map(ref => targetFor(spaceId, ref, source)));
    store.forget(spaceId, refs.filter((_, i) => targets[i] === null));
    const unique = new Map(targets.filter((t): t is TabTarget => t !== null).map(t => [t.ref, t]));
    return [...unique.values()].map(t => store.tab(spaceId, t));
  };
  const revive = async (spaceId: string, target: TabTarget) => {
    for (const member of target.members ?? [target]) if (member.kind === "thread") await catalog(spaceId).reviveThread?.(member.ref.slice(7));
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
      let { spaceId } = input;
      const source = catalog(spaceId);
      let target = input.ref !== undefined ? await required(spaceId, input.ref) : await source.atPath(input.href);
      if (!target) return { tab: null, spaceId };
      if (input.follow && (target.kind === "thread" || target.kind === "item")) spaceId = await source.spaceFor?.(target.ref) ?? spaceId;
      const containing = store.containing(spaceId, target.ref);
      if (containing) target = await required(spaceId, `split:${containing}`);
      await revive(spaceId, target);
      store.open(spaceId, target.ref);
      return { tab: store.tab(spaceId, target), spaceId };
    },
    tabs_split_create: async ({ spaceId, refs, zone, folderId }: OfficeInput<"tabs_split_create">) => {
      const source = catalog(spaceId);
      const members = await Promise.all(refs.map(ref => source.resolve(ref)));
      if (members.some(t => !t)) throw new Error("Every split member must resolve before creating the split.");
      const ref = store.createSplit(spaceId, refs, zone, folderId);
      return { tab: await required(spaceId, ref) };
    },
    tabs_split_remove: async ({ spaceId, ref }: OfficeInput<"tabs_split_remove">) => {
      const refs = store.split(spaceId, ref);
      if (refs) {
        const source = catalog(spaceId);
        const members = await Promise.all(refs.map(r => source.resolve(r)));
        store.removeSplit(spaceId, ref, members.filter((t): t is TabTarget => !!t).map(t => t.ref));
      }
      return { ok: true as const };
    },
    tabs_move_space: async ({ spaceId, ref, toSpaceId }: OfficeInput<"tabs_move_space">) => {
      const target = await required(spaceId, ref);
      store.moveSpace(spaceId, target.ref, toSpaceId);
      return { tab: await required(toSpaceId, target.ref) };
    },
    tabs_reopen: async ({ spaceId }: OfficeInput<"tabs_reopen">) => {
      const rows = store.rows(spaceId).filter(t => t.zone === "archived").sort((a,b) => (b.archived_at ?? 0) - (a.archived_at ?? 0) || b.opened_at - a.opened_at || a.ref.localeCompare(b.ref));
      const source = catalog(spaceId);
      for (const row of rows) {
        const target = (await resolved(spaceId, [row.ref], source))[0];
        if (!target) continue;
        await revive(spaceId, target);
        store.open(spaceId, target.ref);
        return { tab: store.tab(spaceId, target) };
      }
      return { tab: null };
    },
    tabs_close_many: ({ spaceId, refs }: OfficeInput<"tabs_close_many">) => { store.closeMany(spaceId, refs); return { ok: true as const }; },
    tabs_move: async ({ spaceId, ref, zone, folderId, index }: OfficeInput<"tabs_move">) => {
      const target = await required(spaceId, ref);
      store.move(spaceId, target.ref, zone, folderId, index);
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
      const [hits, threads, saved] = await Promise.all([source.search(query), source.searchThreads(query), resolved(spaceId, store.rows(spaceId).filter(t => t.zone === "archived").map(t => t.ref), source)]);
      const results = new Map<string, Tab>();
      for (const hit of hits) if (hit.kind !== "thread") results.set(hit.ref, store.tab(spaceId, hit));
      for (const tab of saved) if (tab.kind !== "thread" && matches(tab, query)) results.set(tab.ref, tab);
      // Threads, archived ones included; their titles come from the search.
      for (const thread of threads) if (!results.has(thread.ref)) results.set(thread.ref, store.tab(spaceId, thread));
      return { results: [...results.values()].slice(0, limit) };
    },
  };
}
export function matches(tab: TabTarget, query: string): boolean {
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => `${tab.title ?? ""} ${tab.ref} ${tab.itemKind ?? ""}`.toLocaleLowerCase().includes(word));
}
