import { subcommand, takeFlag, takeOption, usage } from "@bb-studio/kit/cli";
// bb-studio server: the hub every Studio add-on plugs into.
//
// - Studio finds add-ons through RPC discovery (src/hub.ts) and fans the
//   collection's requests out to their `studio_*` methods.
// - Add-ons call `studio_changed` when their items change; Studio relays it
//   to open collections over realtime.
// - Studio can hide the add-ons' own sidebar entries, since its collection
//   lists their items (src/sidebar.ts).
// - Studio keeps tags, which group items across add-ons (src/tags.ts).
// - Studio keeps the sidebar's tabs, one per opened item (src/tabs.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { relativeTime, untitled } from "@bb-studio/kit/format";
import { z } from "zod";
import { rpcContract, TABS_CHANNEL, type SidebarView, type TabView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { ChangeLog } from "./src/changes";
import { isPanelVisible, withPanelsVisible } from "./src/sidebar";
import { MIGRATIONS } from "./src/migrations";
import { itemAtPath, TabStore } from "./src/tabs";
import { TagStore, type ItemRef, type Tag } from "./src/tags";
import { SearchIndex } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
import { ProviderHistory } from "./src/provider-history";
import { ProviderComments } from "./src/provider-comments";
import { routeCommentMentions } from "./src/comment-routing";
import { homeData } from "./src/home";
import { firstThreadItemRefs } from "./src/thread-item-refs";
import { respondToNeed } from "./src/needs-you";
import { zipFiles } from "./src/export-zip";
import { PlaybookStore, renderPlaybook } from "./src/playbooks";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";
const MAX_LISTED = 100;

export default async function plugin(bb: BbPluginApi) {
  const hub = new StudioHub(bb.sdk);
  const changes = new ChangeLog();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const tags = new TagStore(db);
  const tabs = new TabStore(db);
  const playbooks = new PlaybookStore(db);
  const searchIndex = new SearchIndex(db, hub);
  const contentSearch = async (query: string) => {
    await searchIndex.ensure();
    const indexed = searchIndex.search(query, { limit: 100 });
    const fallback = await hub.search(query, true);
    return {
      keys: [...new Set([...indexed.map((hit) => `${hit.ref.pluginId}:${hit.ref.id}`), ...fallback.keys])],
      snippets: { ...fallback.snippets, ...Object.fromEntries(indexed.map((hit) => [`${hit.ref.pluginId}:${hit.ref.id}`, hit.snippet.text])) },
    };
  };
  const services = new StudioServices(db);
  const providerHistory = new ProviderHistory(bb.sdk);
  const providerComments = new ProviderComments(bb.sdk);
  const threadState = async (threadId: string) => {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread.archivedAt ? "archived" : "idle";
    } catch { return "deleted"; }
  };
  for (const thread of services.activeThreads()) {
    const state = await threadState(thread.threadId);
    services.linkThread({ ...thread, state, updatedAt: Date.now() });
  }
  const updateThread = (threadId: string, state: string) => {
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
  const checkedThreads = new Set<string>();
  const checkingThreads = new Set<string>();
  const pendingThreads = new Map<string, { id: string; createdAt: number; status: string }>();
  const linkComposerThread = async (thread: { id: string; createdAt: number; status: string }) => {
    if (checkedThreads.has(thread.id) || services.threadsForThread(thread.id).length) return;
    if (checkingThreads.has(thread.id)) { pendingThreads.set(thread.id, thread); return; }
    checkingThreads.add(thread.id);
    try {
      const events = await bb.sdk.threads.events.list({ threadId: thread.id, order: "asc", limit: "50", types: ["client/thread/start", "client/turn/requested", "client/turn/start"] });
      const refs = firstThreadItemRefs(events);
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
        queueMicrotask(() => { void linkComposerThread(pending).catch(() => {}); });
      }
    }
  };
  const tryLinkComposerThread = (thread: { id: string; createdAt: number; status: string }) => {
    void linkComposerThread(thread).catch(() => { /* The first input may not be saved yet. */ });
  };
  bb.events.on("thread.created", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("experimental_thread.events", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("thread.active", ({ thread }) => tryLinkComposerThread(thread));
  bb.events.on("thread.idle", ({ thread }) => tryLinkComposerThread(thread));
  void bb.sdk.threads.list({ limit: 200 }).then((threads) => {
    for (const thread of threads) tryLinkComposerThread(thread);
  }).catch(() => {});
  bb.events.on("interaction.pending", () => {
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  });
  /** Every window's sidebar refetches its tabs. */
  const tabsChanged = () => bb.realtime.publish(TABS_CHANNEL, {});

  /**
   * Every item with its tag ids. Tags and tabs of items a provider no longer
   * lists are dropped; a provider that is down, or listed only some, keeps them.
   */
  const overview = async () => {
    const result = await hub.overview();
    let closed = false;
    for (const provider of result.providers) {
      if (provider.state !== "ready" || result.truncated.has(provider.pluginId)) continue;
      const live = new Set(result.items.filter((item) => item.pluginId === provider.pluginId).map((item) => item.id));
      tags.prune(provider.pluginId, live);
      closed = tabs.prune(provider.pluginId, live) || closed;
    }
    if (closed) tabsChanged();
    const assigned = tags.assignments();
    return {
      providers: result.providers,
      items: result.items.map((item) => ({ ...item, tags: assigned.get(`${item.pluginId}:${item.id}`) ?? [] })),
      tags: tags.list(),
    };
  };
  /** Open collections refetch, as when an add-on's items change. */
  const tagsChanged = () => {
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  };

  const tabViews = ({ providers, items }: { providers: Awaited<ReturnType<typeof hub.providers>>; items: HubItem[] }): TabView[] => {
    const kindIcons = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.icon])));
    const byKey = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item]));
    // A tab whose add-on is down stays open but isn't shown until it's back.
    return tabs.list().flatMap((ref) => {
      const item = byKey.get(`${ref.pluginId}:${ref.id}`);
      if (!item) return [];
      return [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), icon: item.icon, kindIcon: kindIcons.get(`${item.pluginId}:${item.kind}`) ?? "File", href: item.href }];
    });
  };

  const tabData = async () => {
    const providers = await hub.providers();
    const refs = tabs.list();
    const items = (await Promise.all([...new Set(refs.map((ref) => ref.pluginId))].map((pluginId) =>
      hub.get(pluginId, refs.filter((ref) => ref.pluginId === pluginId).map((ref) => ref.id)).catch(() => []),
    ))).flat();
    return { providers, items };
  };

  const itemForPath = async (path: string) => {
    const parts = path.split(/[?#]/)[0]!.split("/");
    const pluginId = parts[2];
    const id = parts[4];
    if (!pluginId || !id) return null;
    const items = await hub.get(pluginId, [decodeURIComponent(id)]).catch(() => []);
    return itemAtPath(items, path);
  };

  const addonPanels = async () =>
    (await hub.providers())
      .filter((provider) => provider.panel)
      .map((provider) => ({ id: `${provider.pluginId}/${provider.panel}`, label: provider.name }));

  const readSidebar = async (): Promise<SidebarView> => {
    const [panels, { preferences }] = await Promise.all([addonPanels(), bb.sdk.system.uiPreferences.list()]);
    const order = preferences[ORDER_KEY].value;
    const visible = preferences[VISIBLE_KEY].value;
    return { panels: panels.map((panel) => ({ ...panel, visible: isPanelVisible(order, visible, panel.id) })) };
  };

  const runPlaybook = async (id: string, projectId: string, variables: Record<string, string>, startHandoffs: boolean) => {
    const source = playbooks.get(id);
    if (!source) throw new Error("Playbook not found.");
    const book = renderPlaybook(source, { ...variables, name: variables.name?.trim() || source.name });
    const ready = await hub.providers();
    for (const [needed, count] of [["pages", book.pages.length], ["studio-tasks", book.tasks.length]] as const) {
      if (count && !ready.some((provider) => provider.pluginId === needed && provider.state === "ready")) throw new Error(`${needed} is unavailable.`);
    }
    const items: ItemRef[] = [], threadIds: string[] = [];
    for (const page of book.pages) {
      const result = await bb.sdk.plugins.callRpc({ pluginId: "pages", method: "create", input: { ...page, projectId, parentId: null }, outputSchema: z.object({ page: z.object({ id: z.string() }) }) });
      items.push({ pluginId: "pages", id: result.page.id });
    }
    for (const task of book.tasks) {
      const result = await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "create", input: { title: task.title, description: task.description, projectId, ...(task.assignee ? { assignee: task.assignee } : {}) }, outputSchema: z.object({ task: z.object({ id: z.string() }) }) });
      const ref = { pluginId: "studio-tasks", id: result.task.id };
      items.push(ref);
      if (startHandoffs && task.handoffPrompt) {
        if (task.assignee?.startsWith("bot:")) {
          await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "handOffBot", input: { id: ref.id, note: task.handoffPrompt }, outputSchema: z.object({ roomId: z.string() }) });
        } else {
          const handoff = await bb.sdk.plugins.callRpc({ pluginId: "studio-tasks", method: "handOff", input: {
            id: ref.id, projectId, providerId: null, model: null, reasoningLevel: null, note: task.handoffPrompt, workspace: "folder",
          }, outputSchema: z.object({ threadId: z.string() }) });
          threadIds.push(handoff.threadId);
        }
      }
    }
    return { items, threadIds };
  };

  bb.rpc.register(rpcContract, {
    home: ({ projectId, periodDays }) => homeData(bb.sdk, hub, services, providerComments, projectId, periodDays),
    homeRespond: async (input) => {
      await respondToNeed(bb.sdk, input);
      changes.append(null);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
      return { ok: true };
    },
    overview: () => overview(),
    search: ({ query }) => contentSearch(query),
    searchAll: async ({ query, kinds, projectId, limit }) => {
      await searchIndex.ensure();
      const studio = query.trim() ? searchIndex.search(query, { kinds, projectId, limit }) : searchIndex.recent(limit, { kinds, projectId });
      const others = query.trim() ? await externalResults(bb, query, { kinds, projectId, limit }) : [];
      const fallback = query.trim() ? await hub.search(query, true) : { keys: [], snippets: {} };
      const groups = new Map<string, string[]>();
      for (const key of fallback.keys) {
        const split = key.indexOf(":");
        const pluginId = key.slice(0, split), id = key.slice(split + 1);
        groups.set(pluginId, [...(groups.get(pluginId) ?? []), id]);
      }
      const legacy = (await Promise.all([...groups].map(([pluginId, ids]) => hub.get(pluginId, ids).catch(() => [])))).flat()
        .filter((item) => !item.archived && (!kinds?.length || kinds.includes(item.kind)) && (projectId === undefined || item.projectId === projectId)).map((item) => ({
        ref: { pluginId: item.pluginId, id: item.id }, kind: item.kind, title: item.title,
        snippet: { text: fallback.snippets[`${item.pluginId}:${item.id}`] ?? "", ranges: [] },
        href: item.href, projectId: item.projectId, updatedAt: item.updatedAt, score: 1,
      }));
      return [...studio, ...legacy, ...others].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
    },
    create: ({ pluginId, kind, projectId }) => hub.call(pluginId, "studio_create", { kind, projectId }),
    duplicate: ({ pluginId, id, projectId, includeChildren }) => hub.call(pluginId, "studio_duplicate", { id, projectId, includeChildren }),
    setTemplate: ({ pluginId, id, template }) => hub.call(pluginId, "studio_template", { id, template }),
    instantiateTemplate: ({ pluginId, id, projectId, variables }) => hub.call(pluginId, "studio_instantiate", { id, projectId, variables }),
    templates: async () => ({ items: (await hub.overview()).items.filter((item) => item.template) }),
    exportItem: ({ pluginId, id, format }) => hub.call(pluginId, "studio_export", { id, format }),
    exportBulk: async ({ items }) => {
      const files: { name: string; bytes: Buffer }[] = [];
      let size = 0;
      for (const { pluginId, id, format } of items) {
        const result = await hub.call(pluginId, "studio_export", { id, format });
        for (const file of result.files) {
          const bytes = Buffer.from(file.data, "base64");
          size += bytes.length;
          if (size > 100 * 1024 * 1024) throw new Error("Selection exceeds the 100 MB ZIP export limit.");
          files.push({ name: `${pluginId}/${id}/${file.name}`, bytes });
        }
      }
      return { name: "studio-export.zip", mime: "application/zip", data: zipFiles(files).toString("base64") };
    },
    playbooks: () => ({ playbooks: playbooks.list() }),
    savePlaybook: (playbook) => { playbooks.save(playbook); return { playbook }; },
    deletePlaybook: ({ id }) => { playbooks.remove(id); return { ok: true }; },
    runPlaybook: ({ id, projectId, variables, startHandoffs }) => runPlaybook(id, projectId, variables, startHandoffs),
    move: ({ pluginId, ids, projectId }) => hub.call(pluginId, "studio_move", { ids, projectId }),
    archive: ({ pluginId, ids, archived }) => hub.call(pluginId, "studio_archive", { ids, archived }),
    remove: async ({ pluginId, ids }) => {
      const result = await hub.call(pluginId, "studio_delete", { ids });
      tags.forget(pluginId, result.done);
      if (tabs.forget(pluginId, result.done)) tabsChanged();
      return result;
    },
    action: ({ pluginId, action, ids }) => hub.call(pluginId, "studio_action", { action, ids }),
    createTag: ({ name }) => {
      const tag = tags.ensure(name);
      tagsChanged();
      return { tag };
    },
    renameTag: ({ id, name }) => {
      const tag = tags.rename(id, name);
      tagsChanged();
      return { tag };
    },
    deleteTag: ({ id }) => {
      tags.remove(id);
      tagsChanged();
      return { ok: true };
    },
    tagItems: ({ items, add, remove }) => {
      tags.apply(items, add, remove);
      tagsChanged();
      return { ok: true };
    },
    studio_changed: async ({ pluginId, ids, removed }) => {
      await searchIndex.changed(pluginId, ids, removed).catch(() => {});
      if (!ids && !removed) changes.append(null);
      let fresh: HubItem[] | null = [];
      let fallbackKind: string | null = null;
      if (ids?.length) {
        try {
          const provider = (await hub.providers()).find((entry) => entry.pluginId === pluginId && entry.state === "ready");
          if (!provider) throw new Error("Provider unavailable");
          fallbackKind = provider.kinds.length === 1 ? provider.kinds[0]!.id : null;
          fresh = await hub.get(pluginId, ids);
        } catch { fresh = null; changes.append(null); }
      }
      const byId = new Map(fresh?.map((item) => [item.id, item]));
      for (const id of fresh === null ? [] : (ids ?? [])) changes.append({ pluginId, id, kind: byId.get(id)?.kind ?? fallbackKind ?? "", removed: !byId.has(id), at: Date.now() });
      for (const id of removed ?? []) changes.append({ pluginId, id, kind: "", removed: true, at: Date.now() });
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId, ids, removed });
      return { ok: true };
    },
    changes: ({ since }) => changes.since(since),
    items: async ({ pluginId, ids }) => {
      const assigned = tags.assignments();
      return { items: (await hub.get(pluginId, ids)).map((item) => ({ ...item, tags: assigned.get(`${pluginId}:${item.id}`) ?? [] })) };
    },
    sidebar: () => readSidebar(),
    tabs: async () => ({ tabs: tabViews(await tabData()) }),
    visitTab: async ({ path }) => {
      if (!path.startsWith("/plugins/") || path.startsWith(`/plugins/${STUDIO_PLUGIN_ID}/`)) return { tab: null };
      const item = await itemForPath(path);
      if (!item) return { tab: null };
      if (tabs.open(item)) tabsChanged();
      return { tab: tabViews(await tabData()).find((each) => each.pluginId === item.pluginId && each.id === item.id) ?? null };
    },
    closeTabs: ({ items }) => {
      let closed = false;
      for (const item of items) closed = tabs.close(item) || closed;
      if (closed) tabsChanged();
      return { ok: true };
    },
    setSidebar: async ({ visible: show }) => {
      const ids = (await addonPanels()).map((panel) => panel.id);
      // Another window can change the sidebar between our read and write; a
      // stale revision fails, so read again and retry once.
      for (let attempt = 0; ; attempt++) {
        const { preferences } = await bb.sdk.system.uiPreferences.list();
        const order = preferences[ORDER_KEY];
        const visible = preferences[VISIBLE_KEY];
        const next = withPanelsVisible(order.value, visible.value, ids, show);
        try {
          if (next.order.length !== order.value.length) {
            await bb.sdk.system.uiPreferences.set({ key: ORDER_KEY, value: next.order, expectedRevision: order.revision });
          }
          await bb.sdk.system.uiPreferences.set({ key: VISIBLE_KEY, value: next.visible, expectedRevision: visible.revision });
          break;
        } catch (error) {
          if (attempt > 0) throw error;
        }
      }
      return readSidebar();
    },
    itemAt: async (input) => {
      if ("path" in input && input.path.startsWith(`/plugins/${STUDIO_PLUGIN_ID}/`)) return { item: null, kind: null };
      const providers = await hub.providers();
      const item = "path" in input
        ? await itemForPath(input.path)
        : (await hub.get(input.pluginId, [input.id]))[0] ?? null;
      if (!item) return { item: null, kind: null };
      const kind = providers.find((provider) => provider.pluginId === item.pluginId)?.kinds.find((each) => each.id === item.kind) ?? null;
      return { item, kind };
    },
    links: ({ ref }) => services.links(ref),
    replaceLinks: ({ ref, source, links }) => { services.replaceLinks(ref, source, links); return { ok: true }; },
    itemThreads: ({ ref }) => ({ threads: services.threads(ref) }),
    linkItemThread: ({ thread }) => { services.linkThread(thread); return { ok: true }; },
    spawnForItem: async ({ ref, prompt, role, metadata, projectId, visibility }) => {
      const item = (await hub.get(ref.pluginId, [ref.id]))[0];
      if (!item) throw new Error("Item not found.");
      const selectedProject = projectId ?? item.projectId;
      if (!selectedProject) throw new Error("Pick a project for this thread.");
      const thread = await bb.sdk.threads.spawn({
        projectId: selectedProject,
        title: item.title || undefined,
        input: [{ type: "text", text: `${prompt}\n\nItem: ${item.href}`, mentions: [], ...(visibility === "agent-only" ? { visibility } : {}) }],
        environment: { type: "host", workspace: { type: "unmanaged", path: null } },
        pluginMetadata: { studioItem: { pluginId: ref.pluginId, id: ref.id, role, ...metadata } },
      });
      const at = Date.now();
      services.linkThread({ threadId: thread.id, ref, role, state: "working", createdAt: at, updatedAt: at, metadata: metadata ?? {} });
      return { threadId: thread.id };
    },
    activity: ({ ref, since, limit }) => ({ events: services.activity(ref ?? null, since ?? 0, limit ?? 50) }),
    recordActivity: (event) => {
      const id = services.recordActivity(event);
      changes.append(null);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
      return { id };
    },
    comments: async ({ ref }) => ({ comments: (await providerComments.list(ref)) ?? services.comments(ref) }),
    commentCreate: async (input) => {
      const delegated = await providerComments.create(input);
      const comment = delegated ?? services.addComment(input);
      if (!delegated) {
        const item = (await hub.get(input.ref.pluginId, [input.ref.id]))[0];
        void routeCommentMentions(bb.sdk, input.ref, input.body, item?.href ?? `${input.ref.pluginId}:${input.ref.id}`).catch(() => { /* Teams is optional. */ });
      }
      changes.append(null);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
      return { comment };
    },
    commentResolve: async ({ ref, id, resolved }) => {
      const ok = (await providerComments.resolve(ref, id, resolved)) ?? services.resolveComment(ref, id, resolved);
      if (ok) { changes.append(null); bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }); }
      return { ok };
    },
    versions: async ({ ref }) => ({ versions: (await providerHistory.versions(ref)) ?? services.versions(ref) }),
    versionCreate: ({ ref, bytes, label, actor }) => ({ version: services.addVersion(ref, Buffer.from(bytes, "base64"), label, actor) }),
    versionRead: async ({ ref, id }) => { const bytes = (await providerHistory.read(ref, id)) ?? services.versionBytes(ref, id); return { bytes: bytes ? Buffer.from(bytes).toString("base64") : null }; },
  });

  // Agents --------------------------------------------------------------------

  /** `snippet` is the content that matched a query, when the add-on gave it. */
  type ListedItem = HubItem & { tags: string[]; snippet?: string };
  const itemLine = (item: ListedItem, kindLabel: string, tagNames: Map<string, string>) =>
    `- ${item.icon ? `${item.icon} ` : ""}${untitled(item.title)} — ${kindLabel}${item.archived ? ", archived" : ""}, ${
      item.projectId ? "project" : "global"
    }, updated ${relativeTime(item.updatedAt)}${item.tags.map((id) => ` #${tagNames.get(id) ?? id}`).join("")} (${item.href})${
      item.snippet ? `\n  > ${item.snippet}` : ""
    }`;

  const listItems = async (options: { projectId: string | null; all: boolean; kind?: string; query?: string; tag?: string }) => {
    const { providers, items, tags: allTags } = await overview();
    const tag = options.tag ? tags.byName(options.tag) : null;
    if (options.tag && !tag) throw new Error(`No tag called "${options.tag}". Tags: ${allTags.map((each) => each.name).join(", ") || "none yet"}.`);
    const labels = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.label])));
    const raw = options.query?.trim();
    const query = raw?.toLowerCase();
    const content = raw ? await contentSearch(raw) : null;
    const contentKeys = new Set(content?.keys);
    const picked: ListedItem[] = items
      .filter(
        (item) =>
          !item.archived &&
          (options.all || item.projectId === null || item.projectId === options.projectId) &&
          (!options.kind || item.kind === options.kind) &&
          (!tag || item.tags.includes(tag.id)) &&
          (!query || untitled(item.title).toLowerCase().includes(query) || contentKeys.has(`${item.pluginId}:${item.id}`)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => {
        const snippet = content?.snippets[`${item.pluginId}:${item.id}`];
        return snippet ? { ...item, snippet } : item;
      });
    const problems = providers.filter((provider) => provider.state !== "ready").map((provider) => `${provider.name}: ${provider.detail}`);
    const tagNames = new Map(allTags.map((each) => [each.id, each.name]));
    return { picked, labels, problems, tagNames, kinds: providers.flatMap((provider) => provider.kinds.map((kind) => kind.id)) };
  };

  const formatList = ({ picked, labels, problems, tagNames }: Awaited<ReturnType<typeof listItems>>) => {
    const lines = picked.slice(0, MAX_LISTED).map((item) => itemLine(item, labels.get(`${item.pluginId}:${item.kind}`) ?? item.kind, tagNames));
    if (picked.length > MAX_LISTED) lines.push(`…and ${picked.length - MAX_LISTED} more. Narrow with a query or kind.`);
    if (!lines.length) lines.push("No Studio items match.");
    if (problems.length) lines.push("", "Unavailable:", ...problems.map((problem) => `- ${problem}`));
    return lines.join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_items",
    description:
      "List the user's BB Studio items — pages, Talk recordings, drawings and anything else a Studio add-on provides — in this project and global ones, newest first. Each line has a link and the item's #tags, and a content match shows the text that matched; open or mention it to work with the item.",
    parameters: z.object({
      query: z.string().max(200).optional().describe("Match titles and content"),
      kind: z.string().max(100).optional().describe("Only this kind, e.g. page, recording, drawing"),
      allProjects: z.boolean().optional().describe("Include every project, not just this one"),
      tag: z.string().max(100).optional().describe("Only items with this tag"),
    }),
    async execute({ query, kind, allProjects, tag }, ctx) {
      return formatList(await listItems({ projectId: ctx.projectId ?? null, all: allProjects === true, kind, query, tag }));
    },
  });

  /** Finds items by link or `<plugin>:<id>`, as studio_list_items shows them. */
  const resolveItems = async (refs: readonly string[]) => {
    const { items } = await hub.overview();
    const found: ItemRef[] = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const trimmed = ref.trim().replace(/^\((.*)\)$/, "$1");
      const item = items.find((each) => each.href === trimmed || `${each.pluginId}:${each.id}` === trimmed);
      if (item) found.push({ pluginId: item.pluginId, id: item.id });
      else missing.push(ref);
    }
    return { found, missing };
  };

  bb.agents.registerTool({
    name: "studio_tag_items",
    description:
      "Group the user's BB Studio items with tags. Tags work across pages, recordings, drawings, artifacts and tasks; new tag names are created. Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/pages/pages/pg_x"),
      add: z.array(z.string().max(100)).max(20).optional().describe("Tag names to add"),
      remove: z.array(z.string().max(100)).max(20).optional().describe("Tag names to remove"),
    }),
    async execute({ items, add = [], remove = [] }) {
      if (!add.length && !remove.length) return "Pass tag names to add or remove.";
      const { found, missing } = await resolveItems(items);
      const added: Tag[] = add.map((name) => tags.ensure(name));
      const removed = remove.map((name) => tags.byName(name)).filter((tag): tag is Tag => tag !== null);
      if (found.length) {
        tags.apply(found, added.map((tag) => tag.id), removed.map((tag) => tag.id));
        tagsChanged();
      }
      const lines = [`Updated ${found.length} item${found.length === 1 ? "" : "s"}.`];
      if (added.length) lines.push(`Added: ${added.map((tag) => `#${tag.name}`).join(" ")}`);
      if (removed.length) lines.push(`Removed: ${removed.map((tag) => `#${tag.name}`).join(" ")}`);
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "studio_playbook_run",
    description: "Create a playbook's pages and tasks in a project. Use bb studio playbooks to see available playbooks. Handoffs start agent threads only when requested.",
    parameters: z.object({ id: z.string().min(1).max(100), projectId: z.string().min(1).max(200), variables: z.record(z.string(), z.string()).optional(), startHandoffs: z.boolean().optional() }),
    async execute({ id, projectId, variables, startHandoffs }) {
      const result = await runPlaybook(id, projectId, variables ?? {}, startHandoffs ?? false);
      return `Created ${result.items.length} items${result.threadIds.length ? ` and started ${result.threadIds.length} handoffs` : ""}.`;
    },
  });

  bb.cli.register({
    name: "studio",
    summary: "List BB Studio items across Pages, Talk, Draw and other add-ons",
    commands: [
      { name: "list", summary: "List items in the current project and global ones", usage: "bb studio list [--all] [--kind <kind>] [--tag <tag>] [--query <text>] [--json]" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
      { name: "playbooks", summary: "List available playbooks", usage: "bb studio playbooks" },
      { name: "playbook-run", summary: "Create a playbook in a project", usage: "bb studio playbook-run <id> --project <id> [--name <value>]" },
    ],
    async run(argv, ctx) {
      const { command, rest } = subcommand(argv);
      const flag = (name: string) => takeFlag(rest, name);
      const option = (name: string) => takeOption(rest, name);
      try {
        switch (command) {
          case "list": {
            const json = flag("--json");
            const result = await listItems({
              projectId: ctx.projectId ?? null,
              all: flag("--all"),
              kind: option("--kind"),
              query: option("--query"),
              tag: option("--tag"),
            });
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(result.picked.slice(0, MAX_LISTED), null, 2)}\n` };
            return { exitCode: 0, stdout: `${formatList(result)}\n` };
          }
          case "tags": {
            const { items, tags: allTags } = await overview();
            if (!allTags.length) return { exitCode: 0, stdout: "No tags yet.\n" };
            const lines = allTags.map((tag) => `#${tag.name}\t${items.filter((item) => item.tags.includes(tag.id)).length}`);
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "providers": {
            const providers = await hub.providers();
            if (!providers.length) return { exitCode: 0, stdout: "No Studio add-ons installed. Install Studio Pages, Studio Talk or Studio Draw.\n" };
            const lines = providers.map(
              (provider) =>
                `${provider.pluginId}\t${provider.state}\t${provider.kinds.map((kind) => kind.id).join(",") || "-"}${provider.detail ? `\t${provider.detail}` : ""}`,
            );
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "reindex": {
            const count = await searchIndex.rebuild();
            return { exitCode: 0, stdout: `Indexed ${count} Studio items.\n` };
          }
          case "playbooks": return { exitCode: 0, stdout: `${playbooks.list().map((book) => `${book.id}\t${book.name}\t${book.description}`).join("\n")}\n` };
          case "playbook-run": {
            const id = rest.shift();
            const projectId = option("--project") ?? ctx.projectId;
            if (!id || !projectId) return usage("bb studio playbook-run <id> --project <id> [--name <value>]");
            const name = option("--name");
            const result = await runPlaybook(id, projectId, name ? { name } : {}, false);
            return { exitCode: 0, stdout: `Created ${result.items.length} items.\n` };
          }
          default:
            return usage("bb studio <list|tags|providers|reindex|playbooks|playbook-run> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}
