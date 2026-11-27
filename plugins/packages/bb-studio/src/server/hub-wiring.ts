import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { builtinProviderContract } from "../builtin-provider";
import { BUILTIN_PLUGIN_IDS } from "../builtins";
import { ChangeLog, recordProviderChanges } from "../changes";
import { schemas, TABS_CHANNEL, type ThreadOptionView } from "../contract";
import { errorText, type StudioHub } from "../hub";
import { STUDIO_PROVIDER_CALL_METHOD, STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { ProviderComments } from "../provider-comments";
import { SearchIndex } from "../search-index";
import type { StudioServices } from "../services";
import { StarStore } from "../stars";
import { TabStore } from "../tabs";
import { TagStore } from "../tags";
import { firstThreadItemRefs, firstThreadMentionPlugins, mentionProviderLookup } from "../thread-item-refs";
import { ThreadTitles } from "../thread-titles";
import type { TriggerEngine } from "../triggers/engine";
import { WorkspacePresence } from "../workspace-presence";

export interface HubWiringDeps {
  bb: BbPluginApi;
  db: ReturnType<BbPluginApi["storage"]["database"]>;
  hub: StudioHub;
  changes: ChangeLog;
  services: StudioServices;
  triggers: TriggerEngine;
  /** Called once `studioChanged` is ready, before awaiting initial thread reconciliation. */
  onStudioChangedReady: (studioChanged: (input: { pluginId: string; ids?: string[]; removed?: string[] }) => Promise<{ ok: true }>) => void;
}

/**
 * Wires the built-in provider RPC bridge, item metadata stores (tags, stars,
 * tabs, search index, thread titles), thread lifecycle & composer-linking
 * events, and the overview/change helpers shared by Studio's RPCs and tools.
 */
export async function setupHubWiring({
  bb,
  db,
  hub,
  changes,
  services,
  triggers,
  onStudioChangedReady,
}: HubWiringDeps) {
  // Other add-ons reach built-in kinds' provider methods through Studio
  // (callProvider in the kit), as they reach an add-on's over RPC.
  bb.rpc.register(builtinProviderContract, {
    [STUDIO_PROVIDER_CALL_METHOD]: ({ pluginId, method, input }) => {
      if (!BUILTIN_PLUGIN_IDS.has(pluginId)) throw new Error(`${pluginId} isn't built into Studio.`);
      return hub.call(pluginId, method, input as never);
    },
  });
  const tags = new TagStore(db);
  const stars = new StarStore(db);
  const tabs = new TabStore(db);
  const threadTitles = new ThreadTitles(async (threadId) => {
    const thread = (await bb.sdk.threads.get({ threadId })) as { title?: string | null; titleFallback?: string | null };
    return thread.title?.trim() || thread.titleFallback?.trim() || "";
  });
  /** Adds each item's tag ids, when it was starred, and the thread that made it. */
  const listed = async <T extends { pluginId: string; id: string }>(items: readonly T[]) => {
    const assigned = tags.assignments();
    const starredAt = stars.map();
    const createdBy = services.creators();
    const origins = services.originThreads();
    const keys = items.map((item) => `${item.pluginId}:${item.id}`);
    const titles = await threadTitles.titles(keys.flatMap((key) => origins.get(key) ?? []));
    return items.map((item, index) => {
      const threadId = origins.get(keys[index]!);
      return {
        ...item,
        tags: assigned.get(keys[index]!) ?? [],
        starredAt: starredAt.get(keys[index]!) ?? null,
        createdBy: createdBy.get(keys[index]!) ?? null,
        thread: threadId ? { id: threadId, title: titles.get(threadId) ?? "" } : null,
      };
    });
  };
  let disposed = false;
  const workspace = new WorkspacePresence();
  const searchIndex = new SearchIndex(db, hub, () => { if (!disposed) bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }); });
  bb.onDispose(() => {
    disposed = true;
    searchIndex.dispose();
  });
  async function studioChanged({ pluginId, ids, removed }: { pluginId: string; ids?: string[]; removed?: string[] }): Promise<{ ok: true }> {
    if (disposed) return { ok: true };
    await searchIndex.changed(pluginId, ids, removed);
    if (disposed) return { ok: true };
    await recordProviderChanges(hub, changes, pluginId, ids, removed);
    if (disposed) return { ok: true };
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId, ids, removed });
    return { ok: true };
  }
  onStudioChangedReady(studioChanged);
  const contentSearch = async (query: string, keys?: string[]) => {
    await searchIndex.ensure();
    const indexed = searchIndex.search(query, { limit: 100, keys });
    return {
      keys: [...new Set(indexed.map((hit) => `${hit.ref.pluginId}:${hit.ref.id}`))],
      snippets: Object.fromEntries(indexed.map((hit) => [`${hit.ref.pluginId}:${hit.ref.id}`, hit.snippet.text])),
    };
  };
  const providerComments = new ProviderComments(bb.sdk);
  const pendingThreadChecks = new Set(services.activeThreads().map((thread) => thread.threadId));
  let reconcilingThreads: Promise<void> | null = null;
  const reconcileThreads = (): Promise<void> => reconcilingThreads ??= (async () => {
    for (const threadId of pendingThreadChecks) {
      if (disposed) break;
      const complete = await services.reconcileThread(
        threadId,
        () => bb.sdk.threads.get({ threadId }),
        (error) => { if (!disposed) bb.log.warn(`Thread ${threadId} unavailable: ${errorText(error)}`); },
      );
      if (disposed) break;
      if (complete) pendingThreadChecks.delete(threadId);
    }
  })().finally(() => { reconcilingThreads = null; });
  await reconcileThreads();
  let lastReconcile = Date.now();
  // Thread events keep linked threads current; this pass only catches what was missed, so it is rare where BB reports interruptions itself.
  const hostEvents = { listening: false };
  const pendingThreads = new Map<string, { id: string; createdAt: number; status: string }>();
  triggers.every("thread-reconcile", 60_000, () => (disposed || (hostEvents.listening && Date.now() - lastReconcile < 30 * 60_000) ? undefined : (lastReconcile = Date.now(), reconcileThreads().catch((error) => { if (!disposed) bb.log.warn(`Thread reconciliation failed: ${errorText(error)}`); }))));
  bb.onDispose(async () => {
    disposed = true;
    pendingThreads.clear();
    await reconcilingThreads;
  });
  const updateThread = (threadId: string, state: string) => {
    if (disposed) return;
    pendingThreadChecks.delete(threadId);
    for (const found of services.threadsForThread(threadId)) services.linkThread({ ...found, state, updatedAt: Date.now() });
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  };
  bb.events.on("thread.active", ({ thread }) => updateThread(thread.id, "working"));
  bb.events.on("thread.idle", ({ thread }) => updateThread(thread.id, "idle"));
  bb.events.on("thread.failed", ({ thread }) => updateThread(thread.id, "failed"));
  bb.events.on("thread.archived", ({ thread }) => updateThread(thread.id, "archived"));
  bb.events.on("thread.deleted", ({ thread }) => updateThread(thread.id, "deleted"));
  bb.events.on("thread.unarchived", ({ thread }) => updateThread(thread.id, "idle"));
  // The composer does not expose a thread id to add-ons. Its first accepted
  // input still contains the item's link or mention, so link it when saved.
  const mentionProviders = mentionProviderLookup((pluginId, signal) => BUILTIN_PLUGIN_IDS.has(pluginId)
    ? hub.call(pluginId, "studio_describe", null)
    : bb.sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null, outputSchema: schemas.provider.studio_describe.output, signal }));
  const checkedThreads = new Set<string>();
  const checkingThreads = new Set<string>();
  const linkComposerThread = async (thread: { id: string; createdAt: number; status: string }) => {
    if (disposed || checkedThreads.has(thread.id) || services.threadsForThread(thread.id).length) return;
    if (checkingThreads.has(thread.id)) { pendingThreads.set(thread.id, thread); return; }
    checkingThreads.add(thread.id);
    try {
      const events = await bb.sdk.threads.events.list({ threadId: thread.id, order: "asc", limit: "50", types: ["client/thread/start", "client/turn/requested", "client/turn/start"] });
      if (disposed) return;
      const providers = await mentionProviders(firstThreadMentionPlugins(events));
      if (disposed) return;
      const refs = firstThreadItemRefs(events, { providers });
      if (refs === null) return;
      for (const ref of refs) {
        services.linkThread({ threadId: thread.id, ref, role: "new-thread", state: thread.status, createdAt: thread.createdAt, updatedAt: Date.now(), metadata: {} });
      }
      if (refs.length) {
        changes.append(null);
        bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
      }
      checkedThreads.add(thread.id);
    } finally {
      checkingThreads.delete(thread.id);
      const pending = pendingThreads.get(thread.id);
      if (pending) {
        pendingThreads.delete(thread.id);
        if (!disposed) queueMicrotask(() => { void linkComposerThread(pending).catch(() => {}); });
      }
    }
  };
  const tryLinkComposerThread = (thread: { id: string; createdAt: number; status: string }) => {
    if (disposed) return;
    void linkComposerThread(thread).catch(() => { /* The first input may not be saved yet. */ });
  };
  bb.events.on("thread.created", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("experimental_thread.events", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("thread.active", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("thread.idle", ({ thread }) => tryLinkComposerThread(thread));
  void bb.sdk.threads.list({ limit: 200 }).then((threads) => {
    if (disposed) return;
    for (const thread of threads) tryLinkComposerThread(thread);
  }).catch(() => {});
  bb.events.on("interaction.pending", () => {
    if (disposed) return;
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  });
  /** Every window's sidebar refetches its tabs. */
  const tabsChanged = () => bb.realtime.publish(TABS_CHANNEL, {});

  /**
   * Every item with its tag ids. Tags and tabs of items a provider no longer
   * lists are dropped; a provider that is down, or listed only some, keeps them.
   * Concurrent callers share one in-flight overview pass.
   */
  const runOverview = async () => {
    const result = await hub.overview();
    let closed = false;
    for (const provider of result.providers) {
      if (provider.state !== "ready" || result.truncated.has(provider.pluginId)) continue;
      const live = new Set(result.items.filter((item) => item.pluginId === provider.pluginId).map((item) => item.id));
      tags.prune(provider.pluginId, live);
      stars.prune(provider.pluginId, live);
      closed = tabs.prune(provider.pluginId, live) || closed;
    }
    if (closed) tabsChanged();
    return {
      providers: result.providers,
      items: await listed(result.items),
      tags: tags.list(),
    };
  };
  let overviewInFlight: { cursor: number; promise: ReturnType<typeof runOverview> } | null = null;
  const overview = () => {
    const cursor = changes.current();
    if (overviewInFlight?.cursor === cursor) return overviewInFlight.promise;
    // Shared result: callers must not mutate the returned arrays.
    const promise = runOverview().finally(() => {
      if (overviewInFlight?.promise === promise) overviewInFlight = null;
    });
    overviewInFlight = { cursor, promise };
    return promise;
  };

  /** Recent open threads, newest first, to pick a lead from. */
  const recentThreads = async (): Promise<ThreadOptionView[]> =>
    (await bb.sdk.threads.list({ archived: false, limit: 100 }))
      .map((thread) => ({
        id: thread.id,
        title: thread.title || thread.titleFallback || "Untitled thread",
        status: thread.status,
        projectId: thread.projectId ?? null,
        updatedAt: thread.updatedAt ?? thread.createdAt ?? 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  /** Open collections refetch, as when an add-on's items change. */
  const tagsChanged = () => {
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  };
  /** Deletes an add-on's items and forgets their tags, stars and tabs. */
  const deleteItems = async (pluginId: string, ids: string[]) => {
    const result = await hub.call(pluginId, "studio_delete", { ids });
    tags.forget(pluginId, result.done);
    stars.forget(pluginId, result.done);
    if (tabs.forget(pluginId, result.done)) tabsChanged();
    return result;
  };

  return {
    tags,
    stars,
    tabs,
    threadTitles,
    listed,
    workspace,
    searchIndex,
    studioChanged,
    contentSearch,
    providerComments,
    hostEvents,
    tabsChanged,
    overview,
    recentThreads,
    tagsChanged,
    deleteItems,
  };
}
