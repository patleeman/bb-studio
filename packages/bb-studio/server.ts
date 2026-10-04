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
// - Studio keeps spaces, meta-projects: each BB project, and so its items and
//   threads, is in one space (src/spaces.ts).
// - Studio keeps saved views, named collection queries (src/views.ts). The
//   query language (src/query.ts) drives the agent tool and CLI too.
// - Studio keeps the sidebar's tabs, one per opened item (src/tabs.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { relativeTime, untitled } from "@bb-studio/kit/format";
import { z } from "zod";
import { rpcContract, schemas, TABS_CHANNEL, type SidebarView, type SpaceThreadView, type TabView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { ChangeLog } from "./src/changes";
import { isPanelVisible, withPanelsVisible } from "./src/sidebar";
import { MIGRATIONS } from "./src/migrations";
import { itemAtPath, TabStore } from "./src/tabs";
import { MAX_TAG_NAME, TagStore, type ItemRef, type Tag } from "./src/tags";
import { inSpace, spaceAssignments, SpaceStore, THREAD_REF, type Space } from "./src/spaces";
import { spaceViewHref } from "./src/ui/space/routes";
import { SpaceFolders } from "./src/space-folders";
import { spaceOpenItems, spaceTreeItems } from "./src/space-tree";
import { PAGES_PLUGIN_ID, pageHref, spacePageMarkdown } from "./src/space-page";
import { backgroundKinds, compileQuery, parseQuery, type Filter, type Query } from "./src/query";
import { ViewStore } from "./src/views";
import { SearchIndex } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
import { ProviderHistory } from "./src/provider-history";
import { ProviderComments } from "./src/provider-comments";
import { routeCommentMentions } from "./src/comment-routing";
import { homeData } from "./src/home";
import { firstThreadItemRefs, firstThreadMentionPlugins, mentionProviderLookup } from "./src/thread-item-refs";
import { respondToNeed } from "./src/needs-you";
import { zipFiles } from "./src/export-zip";
import { SpaceLeads } from "./src/space-lead";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";
const MAX_LISTED = 100;

/** A CLI argument as query text: the shell took the quotes off `project:"Q4 launch"`. */
function queryArg(arg: string): string {
  if (!/\s/.test(arg) || arg.includes('"')) return arg;
  const filter = /^(-?[a-z]+:)(.*)$/i.exec(arg);
  return filter ? `${filter[1]}"${filter[2]}"` : `"${arg}"`;
}

export default async function plugin(bb: BbPluginApi) {
  const hub = new StudioHub(bb.sdk);
  const changes = new ChangeLog();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const tags = new TagStore(db);
  const spaces = new SpaceStore(db);
  spaces.reconcileProjects((await bb.sdk.projects.list({ includePersonal: true })).map((project) => project.id));
  // A new space gets its own catch-all project under ~/Spaces (src/space-folders.ts).
  const folders = new SpaceFolders(db, spaces, {
    root: join(homedir(), "Spaces"),
    mkdir: async (path) => { await mkdir(path, { recursive: true }); },
    projects: async () => (await bb.sdk.projects.list({ includePersonal: true })).map((project) => ({ id: project.id, name: project.name, path: (project.sources.find((source) => source.isDefault) ?? project.sources[0])?.path ?? null })),
    createProject: async (name, path) => {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("Connect the primary host before making a space.");
      const project = await bb.sdk.projects.create({ name, source: { type: "local_path", hostId, path } });
      return { id: project.id, name: project.name, path };
    },
  });
  const tabs = new TabStore(db);
  const views = new ViewStore(db);
  const searchIndex = new SearchIndex(db, hub, () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }));
  bb.onDispose(() => searchIndex.dispose());
  const contentSearch = async (query: string) => {
    await searchIndex.ensure();
    const indexed = searchIndex.search(query, { limit: 100 });
    return {
      keys: [...new Set(indexed.map((hit) => `${hit.ref.pluginId}:${hit.ref.id}`))],
      snippets: Object.fromEntries(indexed.map((hit) => [`${hit.ref.pluginId}:${hit.ref.id}`, hit.snippet.text])),
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
  const mentionProviders = mentionProviderLookup((pluginId, signal) => bb.sdk.plugins.callRpc({ pluginId, method: "studio_describe", input: null, outputSchema: schemas.provider.studio_describe.output, signal }));
  const checkedThreads = new Set<string>();
  const checkingThreads = new Set<string>();
  const pendingThreads = new Map<string, { id: string; createdAt: number; status: string }>();
  const linkComposerThread = async (thread: { id: string; createdAt: number; status: string }) => {
    if (checkedThreads.has(thread.id) || services.threadsForThread(thread.id).length) return;
    if (checkingThreads.has(thread.id)) { pendingThreads.set(thread.id, thread); return; }
    checkingThreads.add(thread.id);
    try {
      const events = await bb.sdk.threads.events.list({ threadId: thread.id, order: "asc", limit: "50", types: ["client/thread/start", "client/turn/requested", "client/turn/start"] });
      const providers = await mentionProviders(firstThreadMentionPlugins(events));
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
  // A Space picked in a new-thread composer takes the thread its user starts
  // there, with the first message. A thread is in one Space, so the last pick wins.
  const PENDING_SPACES_MS = 10 * 60_000;
  const pendingSpaces = new Map<string, { ids: string[]; at: number }>();
  bb.experimental_hooks.on("message.dispatch", (context) => {
    const pending = pendingSpaces.get(context.project.id);
    if (!pending || context.thread.status !== "pending" || context.initiator !== "user" || context.senderThreadId !== null ||
      context.originPluginId || context.thread.originPluginId) return { action: "proceed" };
    pendingSpaces.delete(context.project.id);
    if (Date.now() - pending.at > PENDING_SPACES_MS) return { action: "proceed" };
    const target = pending.ids.filter((id) => spaces.get(id)).at(-1);
    if (target) {
      spaces.add(target, [{ pluginId: THREAD_REF, id: context.thread.id }]);
      threadsMoved();
    }
    return { action: "proceed" };
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
    const allSpaces = spaces.list();
    const inSpaces = spaceAssignments(allSpaces, result.items);
    return {
      providers: result.providers,
      items: result.items.map((item) => ({ ...item, tags: assigned.get(`${item.pluginId}:${item.id}`) ?? [], spaces: inSpaces.get(`${item.pluginId}:${item.id}`) ?? [] })),
      tags: tags.list(),
      spaces: allSpaces,
      views: views.list(),
    };
  };

  /** Recent open threads, newest first, to pick from when adding one to a space. */
  const recentThreads = async (): Promise<SpaceThreadView[]> =>
    (await bb.sdk.threads.list({ archived: false, limit: 100 }))
      .map((thread) => ({
        id: thread.id,
        title: thread.title || thread.titleFallback || "Untitled thread",
        status: thread.status,
        projectId: thread.projectId ?? null,
        updatedAt: thread.updatedAt ?? thread.createdAt ?? 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  /** The one space a thread is in, which scopes what its agent sees by default. */
  const threadSpaces = (threadId: string, projectId: string | null) => {
    const space = spaces.get(spaces.ownerOfThread({ id: threadId, projectId }));
    return space ? [space] : [];
  };
  /** Open collections refetch, as when an add-on's items change. */
  const tagsChanged = () => {
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
  };
  const pageResult = z.object({ page: z.object({ id: z.string(), archived: z.boolean(), title: z.string().optional(), icon: z.string().optional() }).nullable() });
  const callPages = <T extends z.ZodType>(method: string, input: unknown, outputSchema: T) =>
    bb.sdk.plugins.callRpc({ pluginId: PAGES_PLUGIN_ID, method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) }) as Promise<z.infer<T>>;
  const making = new Map<string, Promise<string | null>>();
  /** A space's brief page, made from the space template if it has none; null without Pages. */
  const spacePage = (id: string): Promise<string | null> => {
    const pending = making.get(id);
    if (pending) return pending;
    const work = (async () => {
      const space = spaces.get(id);
      if (!space) throw new Error("That space no longer exists.");
      if (space.pageId) {
        const found = await callPages("get", { id: space.pageId }, pageResult).catch(() => undefined);
        // Pages being down doesn't lose the page.
        if (found === undefined) return space.pageId;
        // An archived brief comes back rather than a new one being made.
        if (found.page?.archived) await callPages("update", { id: space.pageId, archived: false }, pageResult).catch(() => {});
        if (found.page) return space.pageId;
      }
      const made = await callPages(
        "create",
        { projectId: space.defaultProjectId, parentId: null, title: space.name, ...(space.icon ? { icon: space.icon } : {}), markdown: spacePageMarkdown(space) },
        pageResult,
      ).catch(() => null);
      if (!made?.page) return null;
      spaces.setPage(id, made.page.id);
      tagsChanged();
      return made.page.id;
    })().finally(() => making.delete(id));
    making.set(id, work);
    return work;
  };
  /**
   * A space's brief page keeps its name and icon: renaming the page renames
   * the space, and deleting it leaves the space without a page. Checks the space pages among the changed ids, or all of
   * them when Pages doesn't say which. Only Pages answering that a page is
   * gone counts, never Pages being down.
   */
  const syncSpacePages = async (changed: string[] | null) => {
    const candidates = spaces.list().filter((space) => space.pageId && (!changed || changed.includes(space.pageId)));
    const found = await Promise.all(candidates.map((space) => callPages("get", { id: space.pageId }, pageResult).catch(() => undefined)));
    let touched = false;
    candidates.forEach((space, index) => {
      const result = found[index];
      if (!result) return;
      if (!result.page) {
        spaces.setPage(space.id, null);
        touched = true;
        return;
      }
      const name = result.page.title?.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_NAME).trim();
      const icon = result.page.icon === undefined ? space.icon : result.page.icon || null;
      if ((!name || name === space.name) && icon === space.icon) return;
      try {
        spaces.update(space.id, { ...(name ? { name } : {}), icon });
        touched = true;
      } catch {
        // Another tag or space has that name; the space keeps its own.
      }
    });
    if (touched) tagsChanged();
  };
  /** Deletes an add-on's items and forgets their tags, tabs and versions. */
  const deleteItems = async (pluginId: string, ids: string[]) => {
    const result = await hub.call(pluginId, "studio_delete", { ids });
    tags.forget(pluginId, result.done);
    services.forgetVersions(pluginId, result.done);
    if (tabs.forget(pluginId, result.done)) tabsChanged();
    return result;
  };

  const deleteSpace = async (id: string) => {
    const pageId = spaces.get(id)?.pageId;
    // A heartbeat that can't be turned off keeps the space, so deleting can be retried.
    await spaceLeads.removeSpace(id);
    spaces.remove(id);
    // The page may hold the user's writing: archive it rather than delete it.
    if (pageId) void callPages("update", { id: pageId, archived: true }, pageResult).catch(() => {});
    tagsChanged();
  };
  /** A space's page keeps its name and icon. */
  const renamePage = (space: Space) => {
    if (space.pageId) void callPages("update", { id: space.pageId, title: space.name, icon: space.icon ?? "" }, pageResult).catch(() => {});
  };
  // Each space's lead thread works beside its page (src/space-lead.ts).
  const spaceLeads = new SpaceLeads({ db, sdk: bb.sdk, spaces, ensurePage: spacePage, hub, changed: tagsChanged });
  /** A thread's space can change without a membership write; sidebars refetch space_of_threads. */
  const threadsMoved = () => { spaceLeads.threadsChanged(); tagsChanged(); };
  bb.events.on("thread.created", () => threadsMoved());
  bb.events.on("thread.archived", () => threadsMoved());
  bb.events.on("thread.unarchived", () => threadsMoved());
  bb.events.on("thread.deleted", ({ thread }) => { spaces.threads.forget(thread.id); threadsMoved(); });

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
    searchStatus: () => searchIndex.status(),
    searchRetry: () => searchIndex.retry(),
    searchAll: async ({ query, kinds, projectId, limit }) => {
      await searchIndex.ensure();
      // Recent items leave out background kinds unless they're asked for; a search still finds them.
      const skip = query.trim() || kinds?.length ? [] : [...backgroundKinds(await hub.providers())];
      const studio = query.trim() ? searchIndex.search(query, { kinds, projectId, limit }) : searchIndex.recent(limit, { kinds, projectId, skip });
      const others = query.trim() ? await externalResults(bb, query, { kinds, projectId, limit }) : [];
      return [...studio, ...others].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
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
    move: ({ pluginId, ids, projectId }) => hub.call(pluginId, "studio_move", { ids, projectId }),
    archive: ({ pluginId, ids, archived }) => hub.call(pluginId, "studio_archive", { ids, archived }),
    remove: ({ pluginId, ids }) => deleteItems(pluginId, ids),
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
    spaces: () => ({ spaces: spaces.list() }),
    createSpace: async (input) => {
      const made = spaces.create(input);
      try {
        await folders.ensureCatchAll(made.id);
      } catch (error) {
        // No half-made space: the name stays free for a retry.
        spaces.remove(made.id);
        throw error;
      }
      tagsChanged();
      return { space: spaces.get(made.id) ?? made };
    },
    updateSpace: ({ id, ...input }) => {
      const before = spaces.get(id);
      const space = spaces.update(id, input);
      if (before && (before.name !== space.name || before.icon !== space.icon)) renamePage(space);
      tagsChanged();
      return { space };
    },
    deleteSpace: async ({ id }) => {
      await deleteSpace(id);
      return { ok: true };
    },
    spacePage: async ({ id }) => {
      const pageId = await spacePage(id);
      return { href: pageId ? pageHref(pageId) : null };
    },
    spaceTree: async () => {
      const all = spaces.list();
      if (!all.length) return { spaces: [] };
      const { items, providers } = await hub.overview();
      const kindsOf = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind])));
      const options = { background: backgroundKinds(providers), pagesPluginId: PAGES_PLUGIN_ID, kindIcon: (item: HubItem) => kindsOf.get(`${item.pluginId}:${item.kind}`)?.icon ?? "File" };
      const open = tabs.list();
      return {
        spaces: all.map((space) => {
          const tree = spaceTreeItems(space, items, options);
          return {
            id: space.id,
            name: space.name,
            icon: space.icon,
            color: space.color,
            href: space.pageId ? pageHref(space.pageId) : spaceViewHref(space.id),
            items: tree.items,
            itemCount: tree.count,
            open: spaceOpenItems(space, open, items, options.kindIcon),
          };
        }),
      };
    },
    createInSpace: async ({ id, pluginId, kind }) => {
      if (!spaces.get(id)) throw new Error("That space no longer exists.");
      // Items follow their project: make sure the Space has its catch-all project first.
      await folders.ensureCatchAll(id);
      const projectId = spaces.get(id)?.defaultProjectId ?? null;
      if (!projectId) throw new Error("This Space has no folder to create items in yet.");
      const { item } = await hub.call(pluginId, "studio_create", { kind, projectId });
      tagsChanged();
      return { href: item.href, title: item.title || "Untitled" };
    },
    spaceMembers: ({ id, add, remove }) => {
      if (add.length) spaces.add(id, add);
      if (remove.length) spaces.removeMembers(id, remove);
      tagsChanged();
      const space = spaces.get(id);
      if (!space) throw new Error("That space no longer exists.");
      return { space };
    },
    space_lead: ({ spaceId }) => spaceLeads.get(spaceId),
    space_lead_setup: ({ spaceId, request }) => spaceLeads.setup(spaceId, request),
    space_thread_start: ({ spaceId, request }) => spaceLeads.startThread(spaceId, request),
    space_overview: ({ spaceId }) => spaceLeads.overview(spaceId),
    space_of_threads: async () => ({ threads: await spaceLeads.spaceOfThreads() }),
    space_set_run: ({ spaceId, ...run }) => spaceLeads.setRun(spaceId, run),
    thread_handoff: ({ threadId, request }) => spaceLeads.handoff(threadId, request),
    saveView: ({ name, query }) => {
      const view = views.save(name, query);
      tagsChanged();
      return { view };
    },
    deleteView: ({ id }) => {
      views.remove(id);
      tagsChanged();
      return { ok: true };
    },
    recentThreads: async () => ({ threads: await recentThreads() }),
    pendingThreadSpaces: ({ projectId, ids }) => {
      if (ids.length) pendingSpaces.set(projectId, { ids, at: Date.now() });
      else pendingSpaces.delete(projectId);
      return { ok: true };
    },
    spacesForThread: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      const holding = threadSpaces(threadId, thread?.projectId ?? null);
      return { spaces: holding, inherited: holding.filter((space) => !space.threadIds.includes(threadId)).map((space) => space.id) };
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
      services.forgetVersions(pluginId, [...(removed ?? []), ...(fresh === null ? [] : (ids ?? []).filter((id) => !byId.has(id)))]);
      if (pluginId === PAGES_PLUGIN_ID) await syncSpacePages(ids || removed ? [...(ids ?? []), ...(removed ?? [])] : null);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId, ids, removed });
      return { ok: true };
    },
    changes: ({ since }) => changes.since(since),
    items: async ({ pluginId, ids }) => {
      const assigned = tags.assignments();
      const items = await hub.get(pluginId, ids);
      const inSpaces = spaceAssignments(spaces.list(), items);
      return { items: items.map((item) => ({ ...item, tags: assigned.get(`${pluginId}:${item.id}`) ?? [], spaces: inSpaces.get(`${pluginId}:${item.id}`) ?? [] })) };
    },
    sidebar: () => readSidebar(),
    tabs: async () => ({ tabs: tabViews(await tabData()) }),
    visitTab: async ({ path }) => {
      // Studio's own pages aren't items.
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
    linkItemThread: ({ thread }) => {
      services.linkThread(thread);
      return { ok: true };
    },
    threadItems: ({ threadId }) => ({ threads: services.threadsForThread(threadId) }),
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
        void routeCommentMentions(bb.sdk, input.body, item?.href ?? `${input.ref.pluginId}:${input.ref.id}`).catch(() => { /* Teams is optional. */ });
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

  /** The named space; an unknown name lists the ones there are. */
  const requireSpace = (name: string) => {
    const space = spaces.find(name);
    if (!space) throw new Error(`No space called "${name}". Spaces: ${spaces.list().map((each) => each.name).join(", ") || "none yet"}. Only the user makes spaces.`);
    return space;
  };

  /** The values a query can name, with every field's names for an error. */
  const vocabulary = async (data: Awaited<ReturnType<typeof overview>>) => ({
    kinds: data.providers.flatMap((provider) => provider.kinds),
    projects: (await bb.sdk.projects.list().catch(() => [])).map((project) => ({ id: project.id, name: project.name })),
    tags: data.tags,
    spaces: data.spaces,
  });
  const unknownFilter = (filter: Filter, names: Awaited<ReturnType<typeof vocabulary>>) => {
    const known = {
      kind: names.kinds.map((kind) => kind.id),
      project: ["global", ...names.projects.map((project) => project.name)],
      tag: ["none", ...names.tags.map((tag) => tag.name)],
      space: names.spaces.map((space) => space.name),
      is: ["archived", "template"],
    }[filter.field];
    const hint = filter.field === "space" ? " Only the user makes spaces." : "";
    return new Error(`No ${filter.field} called "${filter.value}". Try: ${known.join(", ") || "none yet"}.${hint}`);
  };

  /**
   * Lists items matching a query (src/query.ts). Without `all` or a space or
   * project filter, the spaces the thread is in scope the list; outside any
   * space it's the project's items and global ones.
   */
  const listItems = async (options: { projectId: string | null; threadId?: string; all: boolean; query?: string; kind?: string; tag?: string; space?: string }) => {
    const data = await overview();
    const names = await vocabulary(data);
    const parsed: Query = parseQuery(options.query ?? "");
    for (const [field, value] of [["kind", options.kind], ["tag", options.tag], ["space", options.space]] as const) {
      if (value) parsed.filters.push({ field, value });
    }
    const compiled = compileQuery(parsed, names);
    if (compiled.unknown.length) throw unknownFilter(compiled.unknown[0]!, names);
    const named = parsed.filters.filter((filter) => !filter.negate && (filter.field === "space" || filter.field === "project"));
    const scope = named.length || options.all || !options.threadId ? [] : threadSpaces(options.threadId, options.projectId);
    const inScope = (item: HubItem) =>
      named.length || options.all ? true : scope.length ? scope.some((space) => inSpace(space, item)) : item.projectId === null || item.projectId === options.projectId;
    const labels = new Map(data.providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.label])));
    const text = compiled.text.toLowerCase();
    const content = compiled.text ? await contentSearch(compiled.text) : null;
    const contentKeys = new Set(content?.keys);
    const picked: ListedItem[] = data.items
      .filter(
        (item) =>
          inScope(item) &&
          compiled.test(item) &&
          (!text || untitled(item.title).toLowerCase().includes(text) || contentKeys.has(`${item.pluginId}:${item.id}`)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => {
        const snippet = content?.snippets[`${item.pluginId}:${item.id}`];
        return snippet ? { ...item, snippet } : item;
      });
    const problems = data.providers.filter((provider) => provider.state !== "ready").map((provider) => `${provider.name}: ${provider.detail}`);
    const tagNames = new Map(data.tags.map((each) => [each.id, each.name]));
    return { picked, labels, problems, tagNames, scope };
  };

  const formatList = ({ picked, labels, problems, tagNames, scope }: Awaited<ReturnType<typeof listItems>>, allHint = "Pass allProjects") => {
    const lines = picked.slice(0, MAX_LISTED).map((item) => itemLine(item, labels.get(`${item.pluginId}:${item.kind}`) ?? item.kind, tagNames));
    if (picked.length > MAX_LISTED) lines.push(`…and ${picked.length - MAX_LISTED} more. Narrow the query.`);
    if (!lines.length) lines.push("No Studio items match.");
    if (scope.length) lines.unshift(`In ${scope.length === 1 ? "space" : "spaces"} ${scope.map((space) => space.name).join(", ")}. ${allHint} for everything.`, "");
    if (problems.length) lines.push("", "Unavailable:", ...problems.map((problem) => `- ${problem}`));
    return lines.join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_items",
    description:
      "List the user's BB Studio items — pages, Talk recordings, drawings and anything else a Studio add-on provides — newest first. In a thread that belongs to a Studio space it lists that space's items; otherwise this project's and global ones. A space: or project: filter, or allProjects, lists beyond that. Each line has a link and the item's #tags, and a content match shows the text that matched; open or mention it to work with the item.",
    parameters: z.object({
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Words match titles and content. Filters: kind:<kind> project:<name|global> tag:<name|none> space:<name> is:archived is:template; quote names with spaces, repeat a field for any of its values, prefix - to exclude. E.g. kind:page -tag:draft project:"Q4 launch" pricing'),
      kind: z.string().max(100).optional().describe("Only this kind, e.g. page, recording, drawing; same as kind: in the query"),
      allProjects: z.boolean().optional().describe("Include every project, not just this one"),
      tag: z.string().max(100).optional().describe("Only items with this tag; same as tag: in the query"),
      space: z.string().max(100).optional().describe("Only items in this space, by name; same as space: in the query"),
    }),
    async execute({ query, kind, allProjects, tag, space }, ctx) {
      return formatList(await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId, all: allProjects === true, kind, query, tag, space }));
    },
  });

  const formatSpaces = async (all: readonly Space[], current: readonly Space[]) => {
    if (!all.length) return "No spaces yet. The user makes them in Studio.";
    const { items, providers } = await hub.overview();
    const background = backgroundKinds(providers);
    const projectNames = new Map((await bb.sdk.projects.list().catch(() => [])).map((project) => [project.id, project.name]));
    return all.map((space) => {
      const count = items.filter((item) => !item.archived && !background.has(`${item.pluginId}:${item.kind}`) && inSpace(space, item)).length;
      const projects = space.projectIds.map((id) => projectNames.get(id) ?? id);
      return `- ${space.icon ? `${space.icon} ` : ""}${space.name}${current.some((each) => each.id === space.id) ? " (this thread)" : ""} — ${count} item${count === 1 ? "" : "s"}${
        projects.length ? `, projects: ${projects.join(", ")}` : ""
      }${space.threadIds.length ? `, ${space.threadIds.length} added thread${space.threadIds.length === 1 ? "" : "s"}` : ""} (${spaceViewHref(space.id)})${space.description ? `\n  ${space.description}` : ""}`;
    }).join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_spaces",
    description:
      "List the user's Studio spaces. A space gathers Studio items, whole BB projects and threads into one place; a thread in a space sees its items by default in studio_list_items.",
    parameters: z.object({}),
    async execute(_params, ctx) {
      return formatSpaces(spaces.list(), threadSpaces(ctx.threadId, ctx.projectId ?? null));
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
      "Group the user's BB Studio items with tags. Tags work across pages, recordings, drawings, artifacts, tables and other items; new tag names are created. Pass items as the links studio_list_items shows.",
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
    name: "studio_delete_items",
    description:
      "Permanently delete the user's BB Studio items — pages (with their sub-pages), recordings, drawings, artifacts, tables and other add-on items. Pass items as the links studio_list_items shows. Deletion can't be undone, so delete only what the user asked to remove; spaces stay the user's to delete.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/pages/pages/pg_x"),
    }),
    async execute({ items: refs }) {
      const { found, missing } = await resolveItems(refs);
      const { items, providers } = await hub.overview();
      const deletable = new Set(
        providers.flatMap((provider) => provider.kinds.filter((kind) => kind.capabilities?.delete).map((kind) => `${provider.pluginId}:${kind.id}`)),
      );
      const titles = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, untitled(item.title)]));
      const kinds = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item.kind]));
      const byPlugin = new Map<string, string[]>();
      const refused: string[] = [];
      for (const { pluginId, id } of found) {
        if (pluginId === STUDIO_PLUGIN_ID || !deletable.has(`${pluginId}:${kinds.get(`${pluginId}:${id}`)}`)) refused.push(titles.get(`${pluginId}:${id}`) ?? id);
        else byPlugin.set(pluginId, [...(byPlugin.get(pluginId) ?? []), id]);
      }
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const [pluginId, ids] of byPlugin) {
        try {
          const result = await deleteItems(pluginId, ids);
          deleted.push(...result.done.map((id) => titles.get(`${pluginId}:${id}`) ?? id));
          failed.push(...result.failed.map(({ id, error }) => `${titles.get(`${pluginId}:${id}`) ?? id} (${error})`));
        } catch (error) {
          failed.push(...ids.map((id) => `${titles.get(`${pluginId}:${id}`) ?? id} (${errorText(error)})`));
        }
      }
      const lines = [`Deleted ${deleted.length} item${deleted.length === 1 ? "" : "s"}${deleted.length ? `: ${deleted.join(", ")}` : ""}.`];
      if (refused.length) lines.push(`Can't be deleted here: ${refused.join(", ")}`);
      if (failed.length) lines.push(`Failed: ${failed.join(", ")}`);
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "studio_space_items",
    description:
      "Move this thread or other threads into one of the user's spaces, or take them out. A thread is in one space at a time, so adding it moves it; taking it out returns it to its project's space. Studio items follow their project, so they can't be added one by one. Only the user makes, renames or deletes spaces, so name one that exists. Add when the user asks to file a thread in a space, or when a space's lead starts a worker thread.",
    parameters: z.object({
      space: z.string().min(1).max(100).describe("The space's name or id"),
      thisThread: z.enum(["add", "remove"]).optional().describe("Add this thread to the space, or take it out"),
      threads: z.array(z.string().min(1).max(200)).max(100).optional().describe("Ids of other threads to add to the space, e.g. workers you started"),
    }),
    async execute({ space: name, thisThread, threads = [] }, ctx) {
      const space = requireSpace(name);
      if (!thisThread && !threads.length) return "Pass threads or thisThread.";
      const thread = { pluginId: THREAD_REF, id: ctx.threadId };
      const others = (await Promise.all(threads.map((threadId) => bb.sdk.threads.get({ threadId }).catch(() => null)))).flatMap((found, index) => (found && found.deletedAt == null ? [{ pluginId: THREAD_REF, id: threads[index]! }] : []));
      const missing = threads.filter((threadId) => !others.some((other) => other.id === threadId));
      spaces.add(space.id, [...others, ...(thisThread === "add" ? [thread] : [])]);
      if (thisThread === "remove") spaces.removeMembers(space.id, [thread]);
      threadsMoved();
      const lines = others.length ? [`Space ${space.name}: added ${others.length} thread${others.length === 1 ? "" : "s"}.`] : [];
      if (thisThread) lines.push(thisThread === "add" ? "This thread is in the space." : "This thread is out of the space.");
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n");
    },
  });

  bb.cli.register({
    name: "studio",
    summary: "List BB Studio items across Pages, Talk, Draw and other add-ons",
    commands: [
      { name: "list", summary: "List items in the current space, or the current project and global ones", usage: "bb studio list [query…] [--all] [--json], e.g. bb studio list kind:page -tag:draft pricing" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "spaces", summary: "List spaces, their projects and how many items each has", usage: "bb studio spaces" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
    ],
    async run(argv, ctx) {
      const { command, rest } = subcommand(argv);
      const flag = (name: string) => takeFlag(rest, name);
      const option = (name: string) => takeOption(rest, name);
      try {
        switch (command) {
          case "list": {
            const json = flag("--json");
            const options = { all: flag("--all"), space: option("--space"), kind: option("--kind"), tag: option("--tag"), query: option("--query") };
            const query = [options.query, ...rest.map(queryArg)].filter(Boolean).join(" ");
            const result = await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId ?? undefined, ...options, query });
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(result.picked.slice(0, MAX_LISTED), null, 2)}\n` };
            return { exitCode: 0, stdout: `${formatList(result, "Pass --all")}\n` };
          }
          case "tags": {
            const { items, tags: allTags } = await overview();
            if (!allTags.length) return { exitCode: 0, stdout: "No tags yet.\n" };
            const lines = allTags.map((tag) => `#${tag.name}\t${items.filter((item) => item.tags.includes(tag.id)).length}`);
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "spaces":
            return { exitCode: 0, stdout: `${await formatSpaces(spaces.list(), ctx.threadId ? threadSpaces(ctx.threadId, ctx.projectId ?? null) : [])}\n` };
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
          default:
            return usage("bb studio <list|tags|spaces|providers|reindex> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}
