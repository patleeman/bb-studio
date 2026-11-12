// Studio's rows on the side panel's New Tab page, where the running BB has
// `slots.experimental_newTabItems`: the newest of every kind in the tab kinds
// registry (src/tab-kinds.ts) in its Recent list, and the same in its search.
// The server lists what it keeps (src/newtab.ts: items, recordings, boards,
// Bots, the Bots' conversations and workers); this window adds the pages it
// opened last (src/ui/opened-tabs.ts: Memory, Library, Automations, Todos,
// the Archive, VS Code). Every row opens as a tab in that panel
// (src/ui/tab-open.ts), and carries its drag payload for a BB that lets its
// rows be dragged (`experimental_dragItem`). The slot's search runs outside
// React; an always-mounted bridge lends it Studio's RPC client and BB's
// navigation.
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo } from "react";
import type { rpcContract } from "../contract";
import { workbenchOf, type NewTabItem, type NewTabItemsRegistration } from "../kit/app/host-sdk";
import { refDragItem, type DragItem } from "../kit/app/item-drag";
import { entryFor, NEW_TAB_LIMIT, newestEntries, shownKind, titleScore, type NewTabEntry } from "../newtab";
import { itemKindOfId, kindsNamedBy, pathFor, tabKindEntry, TAB_KIND_REGISTRY, type TabKindId } from "../tab-kinds";
import { requestThreadTab } from "../kit/app/thread-panel";
import { useLive } from "./live";
import { noteOpenedTab, openedTabs, type OpenedTab } from "./opened-tabs";
import { requestPageTab } from "./page-tab-requests";
import { openFrom, routeContainer } from "./studio-open";
import { openTabRef, requestPluginTab, setTabNavigator, type OpenDeps } from "./tab-open";

type Navigate = ReturnType<typeof useBbNavigate>;

/** Rows asked of the server per query, across every kind's group (bb shows eight of each). */
export const NEW_TAB_SEARCH_LIMIT = 40;

const depsOf = (navigate: Navigate): OpenDeps => ({
  workbench: (threadId) => workbenchOf(navigate, threadId), requestThreadTab, requestPageTab, requestPluginTab, noteOpened: (ref) => noteOpenedTab(ref),
});

/** Shows a row: as a tab in the conversation's panel when there is one, else where Studio opens it. */
export async function openNewTabEntry(entry: NewTabEntry, threadId: string | null, navigate: Navigate, deps: OpenDeps = depsOf(navigate)): Promise<void> {
  const { ref } = entry;
  if (threadId && (await openTabRef(ref, entry.title, { threadId }, deps))) return;
  if ((ref.kind === "conversation" || ref.kind === "worker") && ref.id) { navigate.toThread(ref.id); return; }
  const href = pathFor(ref);
  if (!href) return;
  const item = !!ref.id && itemKindOfId(ref.id) === ref.kind;
  openFrom(routeContainer(), { href, title: entry.title }, { target: item ? "workbench" : "main" }, { toThread: (id: string) => navigate.toThread(id), openUrl: () => false });
}

/** The New Tab item for a row: its open, and its drag payload for a BB that lets rows be dragged. */
export function newTabItems(entries: readonly NewTabEntry[], threadId: string | null, navigate: Navigate): (NewTabItem & { experimental_dragItem?: DragItem })[] {
  return entries.map((entry) => {
    const drag = refDragItem(entry.ref, entry.title);
    return { id: entry.id, title: entry.title, kind: shownKind(entry), icon: entry.icon, updatedAt: entry.updatedAt, open: () => { void openNewTabEntry(entry, threadId, navigate); }, ...(drag ? { experimental_dragItem: drag } : {}) };
  });
}

/** This window's opened pages as rows: one per kind, named for the kind. */
export function openedEntries(opened: readonly OpenedTab[]): NewTabEntry[] {
  return opened.map((each) => entryFor({ kind: each.kind, id: each.id }, tabKindEntry(each.kind).name, each.at));
}

/** The opened pages a query finds, by the kind's name, newest opened first. A page never opened here is the Actions list's (bb searches action titles). */
export function openedSearch(query: string, opened: readonly OpenedTab[]): NewTabEntry[] {
  const named = new Set(kindsNamedBy(query));
  return opened.filter((each) => named.has(each.kind) || titleScore(tabKindEntry(each.kind).name, query) > 0)
    .map((each) => entryFor({ kind: each.kind, id: each.id }, tabKindEntry(each.kind).name, each.at));
}

function useStudioRecents({ threadId }: { threadId: string | null }): readonly NewTabItem[] {
  const navigate = useBbNavigate();
  const entries = useLive("newtab_recents", { threadId }, { pollMs: 60_000 }).data?.entries;
  return useMemo(() => newTabItems(newestEntries([...(entries ?? []), ...openedEntries(openedTabs())], NEW_TAB_LIMIT, threadId), threadId, navigate), [entries, threadId, navigate]);
}

let runtime: { search(query: string, threadId: string | null): Promise<readonly NewTabEntry[]>; navigate: Navigate } | null = null;
/** One server search per query, which every kind's group reads. */
let last: { query: string; threadId: string | null; entries: Promise<readonly NewTabEntry[]> } | null = null;

/** Every row a query finds: this window's opened pages, then the server's. */
async function searchAllKinds(query: string, threadId: string | null): Promise<readonly NewTabEntry[]> {
  const current = runtime;
  if (!current) return [];
  const text = query.slice(0, 200);
  if (last?.query !== text || last.threadId !== threadId) {
    const entries = current.search(text, threadId).catch(() => [] as readonly NewTabEntry[]);
    last = { query: text, threadId, entries };
  }
  return [...openedSearch(text, openedTabs()), ...(await last.entries)];
}

/** The search of one kind's group: the rows of that kind, under the kind's plural. */
function searchKind(kinds: readonly TabKindId[]) {
  return async (query: string, { signal, threadId }: { signal: AbortSignal; threadId: string | null }): Promise<readonly NewTabItem[]> => {
    const entries = (await searchAllKinds(query, threadId)).filter((entry) => kinds.includes(entry.ref.kind));
    return signal.aborted || !runtime ? [] : newTabItems(entries, threadId, runtime.navigate);
  };
}

/**
 * Studio's New Tab registrations: Recent's rows, then one search group per
 * kind Studio opens, headed by the kind's plural ("Whiteboards"), in
 * registry order. bb's own kinds are bb's.
 */
export const STUDIO_NEW_TAB_ITEMS: readonly NewTabItemsRegistration[] = [
  { id: "recent", title: "Recent", useRecents: useStudioRecents },
  ...TAB_KIND_REGISTRY.filter((entry, at, all) => entry.owner !== "bb" && all.findIndex((each) => each.plural === entry.plural) === at)
    .map((entry) => ({ id: `kind-${entry.id}`, title: entry.plural, search: searchKind(TAB_KIND_REGISTRY.filter((each) => each.owner !== "bb" && each.plural === entry.plural).map((each) => each.id)) })),
];

export function NewTabBridge() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  useEffect(() => {
    const mine = { search: async (query: string, threadId: string | null) => (await rpc.call("newtab_search", { query, threadId, limit: NEW_TAB_SEARCH_LIMIT })).entries, navigate };
    runtime = mine;
    return () => { if (runtime === mine) runtime = null; };
  }, [rpc, navigate]);
  useEffect(() => setTabNavigator(navigate), [navigate]);
  return null;
}
