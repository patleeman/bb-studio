import { registerChat } from "./src/chat/server";
import { Command } from "./src/command/command";
import { registerMentionProviders } from "./src/command/mention-providers";
import { subcommand, usage } from "@bb-studio/kit/cli";
import { parseCliArgs, type CliSpec } from "./src/cli-args";
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
import { TagStore, type ItemRef, type Tag } from "./src/tags";
import { listFiles, readFile, worktrees } from "./src/space-files";
import { inSpace, spaceAssignments, SpaceStore, THREAD_REF, type Space } from "./src/spaces";
import { SpaceFolders } from "./src/space-folders";
import { planMove } from "./src/move-items";
import { createThreadLines } from "./src/thread-lines";
import { spaceOpenItems, spaceTreeItems } from "./src/space-tree";
import { backgroundKinds, compileQuery, parseQuery, type Filter, type Query } from "./src/query";
import { ViewStore } from "./src/views";
import { SearchIndex } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
import { ProviderHistory } from "./src/provider-history";
import { ProviderComments } from "./src/provider-comments";
import { homeData } from "./src/home";
import { firstThreadItemRefs, firstThreadMentionPlugins, mentionProviderLookup } from "./src/thread-item-refs";
import { respondToNeed } from "./src/needs-you";
import { zipFiles } from "./src/export-zip";
import { SpaceLeads } from "./src/space-lead";
import { requestTexts, ThreadTitler, TitleStore, type TitleThread } from "./src/thread-titles";
import { askModel } from "@bb-studio/kit/decisions";
import { primaryHostId } from "@bb-studio/kit/server";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";
const MAX_LISTED = 100;

/** A CLI argument as query text: the shell took the quotes off `project:"Q4 launch"`. */
function queryArg(arg: string): string {
  if (!/\s/.test(arg) || arg.includes('"')) return arg;
  const filter = /^(-?[a-z]+:)(.*)$/i.exec(arg);
  return filter ? `${filter[1]}"${filter[2]}"` : `"${arg}"`;
}

import { HEALTH_REALTIME_CHANNEL, healthSchemas } from "@bb-studio/kit/health";
import { HealthMonitor } from "./src/health";
import { healthContract } from "./src/health-contract";
import { formatSetup, SetupService } from "./src/setup";
import { setupContract } from "./src/setup-contract";
import { BackupService, formatBackup, formatRestore, restoreFailed } from "./src/backup/service";
import { studioDataBackup } from "./src/backup/studio-data";
import { backupFileName, registerBackup } from "./src/backup/register";
import { stat as statPath } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";

/** How often Studio re-checks plugin health on its own. */
const HEALTH_INTERVAL_MS = 3 * 60_000;

export default async function plugin(bb: BbPluginApi) {
  await registerChat(bb);
  const hub = new StudioHub(bb.sdk);
  const changes = new ChangeLog();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const tags = new TagStore(db);
  const spaces = new SpaceStore(db);
  // Space leads are set up below; Command only reads them after startup.
  const command = new Command(bb, {
    list: () => spaces.list(),
    spaceOfThreads: () => spaceLeads.spaceOfThreads(),
    lead: async (spaceId) => (await spaceLeads.get(spaceId)).leadThreadId,
    join: (spaceId, threadId) => { spaces.add(spaceId, [{ pluginId: "bb-thread", id: threadId }]); tagsChanged(); },
  });
  registerMentionProviders(bb, command);
  for (const event of ["thread.created", "thread.active", "thread.idle", "thread.failed", "thread.archived", "thread.unarchived", "thread.deleted"] as const)
    bb.events.on(event, () => command.changed());
  spaces.reconcileProjects((await bb.sdk.projects.list({ includePersonal: true })).map((project) => project.id));
  // A new space gets its own catch-all project under ~/Spaces (src/space-folders.ts).
  // Staged and test BBs set BB_STUDIO_SPACES_DIR so they never write to the user's home.
  const folders = new SpaceFolders(db, spaces, {
    root: process.env.BB_STUDIO_SPACES_DIR || join(homedir(), "Spaces"),
    mkdir: async (path) => { await mkdir(path, { recursive: true }); },
    projects: async () => (await bb.sdk.projects.list({ includePersonal: true })).map((project) => ({ id: project.id, name: project.name, path: (project.sources.find((source) => source.isDefault) ?? project.sources[0])?.path ?? null })),
    createProject: async (name, path) => {
      const hostId = (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("Connect the primary host before adding a project.");
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
  const titleThread = (thread: { id: string; title: string | null; visibility?: string | null; archivedAt?: number | null }): TitleThread =>
    ({ id: thread.id, title: thread.title, hidden: thread.visibility === "hidden", archived: Boolean(thread.archivedAt) });
  const titler = new ThreadTitler(new TitleStore(db), {
    thread: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      return thread && thread.deletedAt == null ? titleThread(thread) : null;
    },
    context: async (threadId) => {
      const requests = async () => {
        // Events come 100 at a time; a thread past 1,000 requests counts as 1,000.
        const events: { seq: number }[] = [];
        for (let page = 0; page < 10; page++) {
          const rows = await bb.sdk.threads.events.list({ threadId, order: "asc", limit: "100", types: ["client/turn/requested"], ...(events.length ? { afterSeq: String(events.at(-1)!.seq) } : {}) });
          events.push(...rows);
          if (rows.length < 100) break;
        }
        return events;
      };
      const [events, output] = await Promise.all([requests(), bb.sdk.threads.output({ threadId }).catch(() => ({ output: null }))]);
      const prompts = requestTexts(events);
      return { prompts: prompts.length > 4 ? [prompts[0]!, ...prompts.slice(-3)] : prompts, promptCount: prompts.length, output: output.output };
    },
    ask: async (threadId, prompt, signal) =>
      (await askModel(bb, { caller: "studio", requestId: `title:${threadId}`, hostId: await primaryHostId(bb), providerId: null, prompt }, signal)).text,
    rename: async (threadId, title) => { await bb.sdk.threads.update({ threadId, title }); },
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => titler.dispose());
  bb.events.on("thread.created", ({ thread }) => titler.created(titleThread(thread)));
  const titleSettings = bb.settings.define({
    autoTitles: {
      type: "boolean",
      label: "Short thread titles",
      default: true,
      description: "Name new threads in a few words after each turn, and rename them as the conversation moves on. Titles you set yourself are never changed.",
    },
  });
  let autoTitles = (await titleSettings.get()).autoTitles;
  titleSettings.onChange((next) => { autoTitles = next.autoTitles; });
  bb.events.on("thread.idle", ({ thread }) => { if (autoTitles) void titler.idle(thread.id); });
  bb.events.on("thread.deleted", ({ thread }) => titler.deleted(thread.id));
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
  /** The one space a thread is in (every space for the Chief of Staff), which scopes what its agent sees by default. */
  const threadSpaces = (threadId: string, projectId: string | null) => {
    // The Chief of Staff is above every space, so it sees them all.
    if (spaceLeads.chiefThreadId() === threadId) return spaces.list();
    const space = spaces.get(spaces.ownerOfThread({ id: threadId, projectId }));
    return space ? [space] : [];
  };
  /** Open collections refetch, as when an add-on's items change. */
  const tagsChanged = () => {
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
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
    // A heartbeat that can't be turned off keeps the space, so deleting can be retried.
    await spaceLeads.removeSpace(id);
    spaces.remove(id);
    tagsChanged();
  };
  /** Where a space's new items go. Items follow their project, so a space without one gets its catch-all first. */
  const spaceProject = async (id: string): Promise<string> => {
    if (!spaces.get(id)) throw new Error("That space no longer exists.");
    await folders.ensureCatchAll(id);
    const projectId = spaces.get(id)?.defaultProjectId ?? null;
    if (!projectId) throw new Error("This Space has no folder to create items in yet.");
    return projectId;
  };
  // Each space's optional lead thread and its heartbeat (src/space-lead.ts).
  const spaceLeads = new SpaceLeads({ db, sdk: bb.sdk, spaces, changed: tagsChanged });
  const threadLines = createThreadLines(bb.sdk);
  /** A thread's space can change without a membership write; sidebars refetch space_of_threads. */
  const threadsMoved = () => { spaceLeads.threadsChanged(); tagsChanged(); };
  /**
   * Moves items to a project, or into a space through its catch-all project.
   * Items already there stay; kinds that can't move are listed as failed.
   */
  const moveItems = async (refs: readonly ItemRef[], target: { spaceId: string } | { projectId: string | null }) => {
    let projectId: string | null;
    let space: Space | undefined;
    if ("spaceId" in target) {
      if (!spaces.get(target.spaceId)) throw new Error("That space no longer exists.");
      await folders.ensureCatchAll(target.spaceId);
      space = spaces.get(target.spaceId) ?? undefined;
      projectId = space?.defaultProjectId ?? null;
      if (!space || !projectId) throw new Error("This Space has no folder to move items into yet.");
    } else projectId = target.projectId;
    const { items, providers } = await hub.overview();
    const movable = new Set(providers.flatMap((provider) => provider.kinds.filter((kind) => kind.capabilities?.move).map((kind) => `${provider.pluginId}:${kind.id}`)));
    const byKey = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item]));
    const known = refs.flatMap((ref) => {
      const item = byKey.get(`${ref.pluginId}:${ref.id}`);
      return item ? [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), projectId: item.projectId ?? null, kind: item.kind }] : [];
    });
    const plan = planMove(known, { projectId, space }, (item) => item.pluginId !== STUDIO_PLUGIN_ID && movable.has(`${item.pluginId}:${item.kind}`));
    const titleOf = (pluginId: string, id: string) => byKey.get(`${pluginId}:${id}`)?.title || id;
    const failed = [
      ...refs.filter((ref) => !byKey.has(`${ref.pluginId}:${ref.id}`)).map((ref) => ({ ...ref, title: ref.id, error: "Not found" })),
      ...plan.refused.map((item) => ({ pluginId: item.pluginId, id: item.id, title: item.title, error: "Can't be moved" })),
    ];
    const moved: { pluginId: string; id: string; title: string }[] = [];
    for (const [pluginId, ids] of plan.byPlugin) {
      try {
        const result = await hub.call(pluginId, "studio_move", { ids, projectId });
        moved.push(...result.done.map((id) => ({ pluginId, id, title: untitled(titleOf(pluginId, id)) })));
        failed.push(...result.failed.map(({ id, error }) => ({ pluginId, id, title: untitled(titleOf(pluginId, id)), error })));
      } catch (error) {
        failed.push(...ids.map((id) => ({ pluginId, id, title: untitled(titleOf(pluginId, id)), error: errorText(error) })));
      }
    }
    if (moved.length) tagsChanged();
    return { moved, unchanged: plan.unchanged, failed, projectId };
  };
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
      return [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), icon: item.icon, kindIcon: kindIcons.get(`${item.pluginId}:${item.kind}`) ?? "File", href: item.href, pinned: ref.pinned }];
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
    ...command.handlers(),
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
    rename: ({ pluginId, id, title }) => hub.call(pluginId, "studio_rename", { id, title }),
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
    createSpace: async ({ defaultProjectPath, ...input }) => {
      if (defaultProjectPath) input.defaultProjectId = (await folders.projectAt(defaultProjectPath)).id;
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
    updateSpace: async ({ id, defaultProjectPath, ...input }) => {
      if (defaultProjectPath) input.defaultProjectId = (await folders.projectAt(defaultProjectPath)).id;
      const space = spaces.update(id, input);
      tagsChanged();
      return { space };
    },
    deleteSpace: async ({ id }) => {
      await deleteSpace(id);
      return { ok: true };
    },
    spaceTree: async () => {
      const all = spaces.list();
      if (!all.length) return { spaces: [] };
      const { items, providers } = await hub.overview();
      const kindsOf = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind])));
      const options = { background: backgroundKinds(providers), kindIcon: (item: HubItem) => kindsOf.get(`${item.pluginId}:${item.kind}`)?.icon ?? "File" };
      const open = tabs.list();
      return {
        spaces: all.map((space) => {
          const tree = spaceTreeItems(space, items, options);
          return {
            id: space.id,
            name: space.name,
            icon: space.icon,
            color: space.color,
            items: tree.items,
            itemCount: tree.count,
            open: spaceOpenItems(space, open, items, (item) => { const kind = kindsOf.get(`${item.pluginId}:${item.kind}`); return { icon: kind?.icon ?? "File", label: kind?.label ?? item.kind }; }),
          };
        }),
      };
    },
    createInSpace: async ({ id, pluginId, kind }) => {
      const projectId = await spaceProject(id);
      const { item } = await hub.call(pluginId, "studio_create", { kind, projectId });
      tagsChanged();
      return { href: item.href, title: item.title || "Untitled" };
    },
    spaceProject: async ({ id }) => ({ projectId: await spaceProject(id) }),
    moveToSpace: async ({ id, items }) => {
      const { moved, unchanged, failed } = await moveItems(items, { spaceId: id });
      return { moved: moved.length, unchanged: unchanged.length, failed };
    },
    spaceMembers: ({ id, add, remove }) => {
      if (add.length) spaces.add(id, add);
      if (remove.length) spaces.removeMembers(id, remove);
      tagsChanged();
      const space = spaces.get(id);
      if (!space) throw new Error("That space no longer exists.");
      return { space };
    },
    addSpaceFolder: async ({ id, path }) => {
      if (!spaces.get(id)) throw new Error("That space no longer exists.");
      const project = await folders.projectAt(path);
      spaces.add(id, [{ pluginId: "bb-project", id: project.id }]);
      tagsChanged();
      const space = spaces.get(id);
      if (!space) throw new Error("That space no longer exists.");
      return { space, project: { id: project.id, name: project.name } };
    },
    space_lead: ({ spaceId }) => spaceLeads.get(spaceId),
    space_set_lead: ({ spaceId, threadId }) => spaceLeads.setLead(spaceId, threadId),
    thread_lines: async ({ threadIds }) => ({ lines: await threadLines.read(threadIds) }),
    space_of_threads: async () => ({ threads: await spaceLeads.spaceOfThreads() }),
    space_set_run: ({ spaceId, ...run }) => spaceLeads.setRun(spaceId, run),
    chief_of_staff: () => spaceLeads.chief(),
    chief_of_staff_set: ({ threadId }) => spaceLeads.setChief(threadId),
    chief_of_staff_set_run: (run) => spaceLeads.setChiefRun(run),
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
    spaceWorktrees: async ({ id }) => {
      if (!spaces.get(id)) throw new Error("That space no longer exists.");
      const threads = (await recentThreads()).filter((thread) => spaces.ownerOfThread(thread) === id);
      return { worktrees: await worktrees(bb, threads) };
    },
    spaceFiles: ({ threadId }) => listFiles(bb, threadId),
    spaceFile: ({ threadId, path }) => readFile(bb, threadId, path),
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
    pinTab: ({ pluginId, id, pinned }) => {
      if (tabs.pin({ pluginId, id }, pinned)) tabsChanged();
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
      }${space.threadIds.length ? `, ${space.threadIds.length} added thread${space.threadIds.length === 1 ? "" : "s"}` : ""} (${space.id})${space.description ? `\n  ${space.description}` : ""}`;
    }).join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_spaces",
    description:
      "List the user's Studio spaces. A space gathers whole BB projects, with their Studio items, and threads into one place; a thread in a space sees its items by default in studio_list_items.",
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

  /** A project by id or name; "global" is no project. */
  const resolveProject = async (ref: string): Promise<string | null> => {
    if (ref.trim().toLowerCase() === "global") return null;
    const projects = (await bb.sdk.projects.list({ includePersonal: true })) as { id: string; name: string }[];
    const found = projects.find((project) => project.id === ref) ?? projects.find((project) => project.name.toLowerCase() === ref.trim().toLowerCase());
    if (!found) throw new Error(`No project called "${ref}".`);
    return found.id;
  };

  /** Moves items by link and says what happened, a line each. */
  const moveItemsReport = async (refs: readonly string[], target: Parameters<typeof moveItems>[1], label: string) => {
    const { found, missing } = await resolveItems(refs);
    const lines: string[] = [];
    if (found.length) {
      const { moved, unchanged, failed } = await moveItems(found, target);
      lines.push(`${label}: moved ${moved.length} item${moved.length === 1 ? "" : "s"}${moved.length ? ` (${moved.map((item) => item.title).join(", ")})` : ""}.`);
      if (unchanged.length) lines.push(`Already there: ${unchanged.map((item) => item.title).join(", ")}`);
      if (failed.length) lines.push(`Failed: ${failed.map((item) => `${item.title} (${item.error})`).join(", ")}`);
    }
    if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
    return lines;
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
      "Move threads or Studio items into one of the user's spaces, or take this thread out. A thread is in one space at a time, so adding it moves it; taking it out returns it to its project's space. An item moves into the space's own project, unless it is already in the space. Only the user makes, renames or deletes spaces, so name one that exists. Use when the user asks to file something in a space, or when a space's lead starts a worker thread.",
    parameters: z.object({
      space: z.string().min(1).max(100).describe("The space's name or id"),
      thisThread: z.enum(["add", "remove"]).optional().describe("Add this thread to the space, or take it out"),
      threads: z.array(z.string().min(1).max(200)).max(100).optional().describe("Ids of other threads to add to the space, e.g. workers you started"),
      items: z.array(z.string().max(500)).max(100).optional().describe("Studio items to move into the space, as the links studio_list_items shows, e.g. /plugins/pages/pages/pg_x"),
    }),
    async execute({ space: name, thisThread, threads = [], items = [] }, ctx) {
      const space = requireSpace(name);
      if (!thisThread && !threads.length && !items.length) return "Pass threads, items or thisThread.";
      const thread = { pluginId: THREAD_REF, id: ctx.threadId };
      const others = (await Promise.all(threads.map((threadId) => bb.sdk.threads.get({ threadId }).catch(() => null)))).flatMap((found, index) => (found && found.deletedAt == null ? [{ pluginId: THREAD_REF, id: threads[index]! }] : []));
      const missing = threads.filter((threadId) => !others.some((other) => other.id === threadId));
      spaces.add(space.id, [...others, ...(thisThread === "add" ? [thread] : [])]);
      if (thisThread === "remove") spaces.removeMembers(space.id, [thread]);
      threadsMoved();
      const lines = others.length ? [`Space ${space.name}: added ${others.length} thread${others.length === 1 ? "" : "s"}.`] : [];
      if (thisThread) lines.push(thisThread === "add" ? "This thread is in the space." : "This thread is out of the space.");
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      if (items.length) lines.push(...(await moveItemsReport(items, { spaceId: space.id }, `Space ${space.name}`)));
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "studio_move_items",
    description:
      "Move the user's BB Studio items to another BB project, or to Global (no project). An item's space follows its project; to put items in a space, use studio_space_items instead. Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/pages/pages/pg_x"),
      project: z.string().min(1).max(200).describe('The project\'s id or name, or "global" for no project'),
    }),
    async execute({ items, project }) {
      const projectId = await resolveProject(project);
      return (await moveItemsReport(items, { projectId }, projectId ? `Project ${project}` : "Global")).join("\n");
    },
  });

  // Plugin health: the sidebar footer shows problems; see src/health.ts.
  const health = new HealthMonitor({
    sdk: bb.sdk,
    schemas: healthSchemas(z),
    kv: bb.storage.kv,
    changed: (summary) => bb.realtime.publish(HEALTH_REALTIME_CHANNEL, summary),
  });
  bb.rpc.register(healthContract, {
    "health.summary": ({ maxAgeMs }) => health.summary(maxAgeMs),
    "health.hide": ({ key, hidden }) => health.hide(key, hidden),
    "health.disable": ({ pluginId }) => health.disable(pluginId),
  });
  const healthTimer = setInterval(() => void health.check().catch((error) => bb.log.warn(`Plugin health check failed: ${errorText(error)}`)), HEALTH_INTERVAL_MS);
  bb.onDispose(() => { clearInterval(healthTimer); health.dispose(); });
  // BB Studio setup: add-ons, retired plugins and what to run; see src/setup.ts.
  const setup = new SetupService({ sdk: bb.sdk, health: (maxAgeMs) => (maxAgeMs ? health.summary(maxAgeMs) : health.check()) });
  bb.rpc.register(setupContract, {
    "setup.summary": ({ maxAgeMs }) => setup.summary(maxAgeMs),
    "setup.install": ({ pluginIds }) => setup.install(pluginIds),
    "setup.enable": ({ pluginId }) => setup.enable(pluginId),
    "setup.remove": ({ pluginId }) => setup.remove(pluginId),
  });

  // Backup and restore of every Studio item (src/backup/, docs/backup.md).
  const threadExists = (threadId: string) => bb.sdk.threads.get({ threadId }).then((thread) => thread.deletedAt == null, () => false);
  const backups = new BackupService({
    dataDir: bb.server.experimental_dataDir,
    sdk: bb.sdk,
    bbVersion: () => Promise.race([
      bb.sdk.system.version().then((version) => version.currentVersion),
      new Promise<null>((done) => setTimeout(() => done(null), 3000)),
    ]),
    studioData: studioDataBackup(db, {
      threadExists,
      changed: () => {
        changes.append(null);
        bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
        void searchIndex.rebuild().catch((error) => bb.log.warn(`Reindex after restore failed: ${errorText(error)}`));
      },
    }),
  });
  registerBackup(bb, backups, join(bb.server.experimental_dataDir, "plugins", STUDIO_PLUGIN_ID));
  /** A CLI path, relative to where the command ran. */
  const cliPath = (path: string, cwd: string | undefined) => (isAbsolute(path) ? path : resolvePath(cwd ?? homedir(), path));

  bb.cli.register({
    name: "studio",
    summary: "List BB Studio items across Pages, Talk, Draw and other add-ons",
    commands: [
      { name: "list", summary: "List items in the current space, or the current project and global ones", usage: "bb studio list [query…] [--all] [--json], e.g. bb studio list kind:page -tag:draft pricing" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "spaces", summary: "List spaces, their projects and how many items each has", usage: "bb studio spaces" },
      { name: "move", summary: "Move items or threads into a space, or items to a project", usage: "bb studio move <item-link|plugin:id|thread-id>… (--space <name|id> | --project <name|id|global>)" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "health", summary: "Check every plugin for setup problems and failures", usage: "bb studio health [--json]" },
      { name: "setup", summary: "Show which BB Studio add-ons are installed and working, and the commands to finish setup", usage: "bb studio setup [--json]" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
      { name: "backup", summary: "Save every Studio item, from every add-on, into one .zip file", usage: "bb studio backup [--out <file|folder>]" },
      { name: "restore", summary: "Restore a Studio backup; shows what would change first", usage: "bb studio restore <file> [--dry-run | --yes]" },
      { name: "retitle", summary: "Give threads a short title now and keep it current as they grow", usage: "bb studio retitle (<thread-id>… | --self | --recent <count>)" },
    ],
    async run(argv, ctx) {
      const { command, rest: raw } = subcommand(argv);
      const USAGE: Record<string, string> = {
        list: "bb studio list [query…] [--all] [--json] [--space <name>] [--kind <kind>] [--tag <tag>] [--query <text>]",
        move: "bb studio move <item-link|plugin:id|thread-id>… (--space <name|id> | --project <name|id|global>)",
        retitle: "bb studio retitle (<thread-id>… | --self | --recent <count>)",
        backup: "bb studio backup [--out <file|folder>]",
        restore: "bb studio restore <file> [--dry-run | --yes]",
      };
      const SPECS: Record<string, CliSpec> = {
        list: { flags: ["--json", "--all"], options: ["--space", "--kind", "--tag", "--query"] },
        health: { flags: ["--json"] },
        setup: { flags: ["--json"] },
        move: { options: ["--space", "--project"] },
        retitle: { flags: ["--self"], options: ["--recent"] },
        backup: { options: ["--out"] },
        restore: { flags: ["--dry-run", "--yes"] },
      };
      const parsed = parseCliArgs(raw, SPECS[command ?? ""] ?? {});
      const known = ["list", "tags", "spaces", "move", "providers", "health", "setup", "reindex", "retitle", "backup", "restore"].includes(command ?? "");
      if (!parsed.ok && known) return usage(`${USAGE[command!] ?? `bb studio ${command}`}\n${parsed.error}`);
      const rest = parsed.ok ? parsed.positional : [];
      const flag = (name: string) => parsed.ok && parsed.flags.has(name);
      const option = (name: string) => (parsed.ok ? parsed.options.get(name) : undefined);
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
          case "move": {
            const spaceName = option("--space");
            const project = option("--project");
            if (!rest.length || Boolean(spaceName) === Boolean(project)) return usage(USAGE.move!);
            const threadIds = rest.filter((ref) => /^thr_[a-z0-9]+$/i.test(ref));
            const itemRefs = rest.filter((ref) => !threadIds.includes(ref));
            const lines: string[] = [];
            if (spaceName) {
              const space = requireSpace(spaceName);
              if (threadIds.length) {
                const found = (await Promise.all(threadIds.map((threadId) => bb.sdk.threads.get({ threadId }).catch(() => null)))).flatMap((thread, index) => (thread && thread.deletedAt == null ? [threadIds[index]!] : []));
                if (found.length) {
                  spaces.add(space.id, found.map((id) => ({ pluginId: THREAD_REF, id })));
                  threadsMoved();
                  lines.push(`Space ${space.name}: moved ${found.length} thread${found.length === 1 ? "" : "s"}.`);
                }
                const missing = threadIds.filter((id) => !found.includes(id));
                if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
              }
              if (itemRefs.length) lines.push(...(await moveItemsReport(itemRefs, { spaceId: space.id }, `Space ${space.name}`)));
            } else {
              if (threadIds.length) return { exitCode: 1, stderr: "Threads move between spaces; pass --space.\n" };
              const projectId = await resolveProject(project!);
              lines.push(...(await moveItemsReport(itemRefs, { projectId }, projectId ? `Project ${project}` : "Global")));
            }
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
          case "health": {
            const summary = await health.check();
            if (flag("--json")) return { exitCode: 0, stdout: `${JSON.stringify(summary, null, 2)}\n` };
            const lines = [
              ...summary.problems.map((problem) => `${problem.status}\t${problem.pluginId}\t${problem.title}${problem.hidden ? " (hidden)" : ""}${problem.detail ? `\n\t\t${problem.detail}` : ""}`),
              ...summary.unanswered.map((entry) => `unknown\t${entry.pluginId}\tIts health check didn't answer: ${entry.error}`),
              ...summary.healthy.map((entry) => `ok\t${entry.pluginId}\t${entry.titles.join("; ")}`),
            ];
            return { exitCode: summary.problems.some((problem) => !problem.hidden) ? 1 : 0, stdout: `${lines.join("\n") || "No problems found."}\n` };
          }
          case "setup": {
            const summary = await setup.summary(0);
            return { exitCode: 0, stdout: flag("--json") ? `${JSON.stringify(summary, null, 2)}\n` : formatSetup(summary) };
          }
          case "backup": {
            if (rest.length) return usage(USAGE.backup!);
            const requested = option("--out");
            let out = cliPath(requested ?? backupFileName(), ctx.cwd);
            if (requested && (await statPath(out).catch(() => null))?.isDirectory()) out = join(out, backupFileName());
            if (await statPath(out).catch(() => null)) return { exitCode: 1, stderr: `${out} already exists; choose another --out.\n` };
            const summary = await backups.backup(out);
            const failed = summary.manifest.sections.some((section) => section.status === "failed");
            return { exitCode: failed ? 1 : 0, stdout: formatBackup(summary) };
          }
          case "restore": {
            if (rest.length !== 1 || (flag("--dry-run") && flag("--yes"))) return usage(USAGE.restore!);
            // Without --yes it only shows what would change.
            const dryRun = !flag("--yes");
            const summary = await backups.restore(cliPath(rest[0]!, ctx.cwd), { dryRun });
            const text = formatRestore(summary) + (dryRun ? "Run again with --yes to restore.\n" : "");
            return { exitCode: restoreFailed(summary) ? 1 : 0, stdout: text };
          }
          case "reindex": {
            const count = await searchIndex.rebuild();
            return { exitCode: 0, stdout: `Indexed ${count} Studio items.\n` };
          }
          case "retitle": {
            const recent = option("--recent");
            if (flag("--self") && !ctx.threadId) return usage(`${USAGE.retitle}\n--self only works inside a thread.`);
            const ids = flag("--self") && ctx.threadId ? [ctx.threadId, ...rest] : [...rest];
            if (recent) {
              const count = Number(recent);
              if (!Number.isInteger(count) || count < 1 || count > 100) return usage("bb studio retitle --recent <1-100>");
              const threads = await bb.sdk.threads.list({ limit: count, ...(ctx.projectId ? { projectId: ctx.projectId } : {}) });
              ids.push(...threads.filter((thread) => thread.visibility !== "hidden" && thread.id !== ctx.threadId).map((thread) => thread.id));
            }
            if (!ids.length) return usage(USAGE.retitle!);
            const retitle = async (threadId: string) => {
              const before = (await bb.sdk.threads.get({ threadId }).catch(() => null))?.title ?? "Untitled";
              try {
                const title = await titler.retitle(threadId);
                return title ? `${threadId}\t${before} → ${title}` : `${threadId}\t${before} (kept)`;
              } catch (error) {
                return `${threadId}\tfailed: ${errorText(error)}`;
              }
            };
            // A few at a time: each one runs a model session.
            const lines: string[] = [];
            for (let i = 0; i < ids.length; i += 4) lines.push(...(await Promise.all(ids.slice(i, i + 4).map(retitle))));
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          default:
            return usage("bb studio <list|tags|spaces|move|providers|health|setup|reindex|backup|restore|retitle> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}
