import { CODE_TOOLS, registerCode } from "./src/code/server";
import { registerDecisions } from "./src/decisions/server";
import { DECISIONS_SETTINGS } from "./src/decisions/settings";
import { BotMaintenance } from "./src/bot-maintenance";
import { registerChat } from "./src/chat/server";
import { ARTIFACT_TOOLS, registerArtifacts } from "./src/artifacts/server";
import { DRAW_TOOLS, registerDraw } from "./src/draw/server";
import { DESIGN_TOOLS, registerDesign } from "./src/design/server";
import { DASHBOARD_TOOLS, registerDashboards } from "./src/dashboards/server";
import { registerTalk, TALK_SETTINGS, TALK_TOOLS, type TalkSettingsHandle } from "./src/talk/server";
import { PAGE_TOOLS, registerPages } from "./src/pages/server";
import { AGENT_INSTRUCTIONS as PAGE_INSTRUCTIONS } from "./src/pages/tools";
import { registerExploreBuiltin } from "./src/explore/server";
import { PAGES_SETTINGS } from "./src/kit/pages-contract";
import { importReactionsSettings, REACTIONS_PLUGIN_ID, REACTIONS_SETTINGS, REACTIONS_SETTINGS_IMPORTED } from "./src/reactions/server";
import { BUILTIN_PLUGIN_IDS, builtinItemAt } from "./src/builtins";
import { builtinProviderContract } from "./src/builtin-provider";
import { BUILTIN_KINDS, builtinOn, frontendState, KindSettingsStore, resolveKinds, routeProviders, routingInstructions, type KindRoute } from "./src/kinds";
import { kindsContract, type KindsState } from "./src/kinds-contract";
import { SPEECH_SETTINGS } from "./src/speech/settings";
import { registerSpeech } from "./src/speech/register";
import { registerVoice, type BuiltinVoice } from "./src/voice/register";
import { migrateOpenaiKey } from "./src/openai-key";
import { subcommand, usage } from "./src/kit/cli";
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
// - Each BB project can have a lead thread with a heartbeat; the personal
//   project's lead is the user's Bot (src/project-lead.ts, src/bot.ts).
// - Studio keeps saved views, named collection queries (src/views.ts). The
//   query language (src/query.ts) drives the agent tool and CLI too.
// - Studio keeps the sidebar's tabs, one per opened item (src/tabs.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { STUDIO_PLUGIN_ID, STUDIO_PROVIDER_CALL_METHOD, STUDIO_REALTIME_CHANNEL } from "./src/kit/contract";
import { relativeTime, untitled } from "./src/kit/format";
import { serveBytes } from "./src/kit/server/index";
import { z } from "zod";
import { rpcContract, schemas, TABS_CHANNEL, type SidebarView, type ThreadOptionView, type TabView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { externalProviders } from "./src/external-bots";
import { EXTERNAL_AGENTS_PLUGIN_ID } from "./src/bot";
import { ChangeLog, recordProviderChanges } from "./src/changes";
import { isPanelVisible, withPanelsVisible } from "./src/sidebar";
import { MIGRATIONS } from "./src/migrations";
import { AVATAR_ROUTE, BOT_AVATAR_SETTINGS, imageMime, pickImageProvider } from "./src/bot-avatar";
import { registerBotProfileTools } from "./src/bot-profile-tools";
import { BotCacheWarmer } from "./src/bot-cache";
import { botControlRefusal, Bots, SKILL_NAME } from "./src/bot";
import { SIDE_THREAD_INSTRUCTIONS, SideThreads } from "./src/bot-side-threads";
import { alertBot, parseSchedule, Runners } from "./src/runners";
import { AutoResume, type ResumeTarget } from "./src/auto-resume";
import { THREAD_RESUME_SETTINGS, ThreadResume, type ThreadOwner } from "./src/thread-resume";
import { BotOwnedThreads } from "./src/bot-owned";
import { Automations } from "./src/automations";
import { lintSkill, patchText, REVIEW_TOOLS, SkillLearning } from "./src/skill-learning";
import { parseDuration, type Schedule } from "./src/schedule";
import { itemAtPath, TabStore } from "./src/tabs";
import { formatWorkspace, openHrefs, WorkspacePresence, type WorkspaceCommand } from "./src/workspace-presence";
import { WORKSPACE_CHANNEL } from "./src/ids";
import { TagStore, type ItemRef, type Tag } from "./src/tags";
import { planMove } from "./src/move-items";
import { backgroundKinds, compileQuery, parseQuery, type Filter, type Query } from "./src/query";
import { ViewStore } from "./src/views";
import { ThreadTitles } from "./src/thread-titles";
import { withTagHint } from "./src/create-tag-hint";
import { SearchIndex } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
import { ProviderHistory } from "./src/provider-history";
import { ProviderComments } from "./src/provider-comments";
import { firstThreadItemRefs, firstThreadMentionPlugins, mentionProviderLookup } from "./src/thread-item-refs";
import { zipFiles } from "./src/export-zip";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./src/project-lead";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";
const MAX_LISTED = 100;

/** A CLI argument as query text: the shell took the quotes off `project:"Q4 launch"`. */
function queryArg(arg: string): string {
  if (!/\s/.test(arg) || arg.includes('"')) return arg;
  const filter = /^(-?[a-z]+:)(.*)$/i.exec(arg);
  return filter ? `${filter[1]}"${filter[2]}"` : `"${arg}"`;
}

import { HEALTH_REALTIME_CHANNEL, healthSchemas } from "./src/kit/health";
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
  const changes = new ChangeLog();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const services = new StudioServices(db);
  const recordActivity = (event: Parameters<StudioServices["recordActivity"]>[0]) => {
    const id = services.recordActivity(event);
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
    return id;
  };
  // Create tools nudge agents to tag what they make (src/create-tag-hint.ts).
  const tagNames = new TagStore(db);
  const registerTool = bb.agents.registerTool.bind(bb.agents);
  bb.agents.registerTool = ((tool: Parameters<typeof registerTool>[0]) =>
    registerTool(withTagHint(tool as never, () => tagNames.list().map((tag) => tag.name)))) as typeof bb.agents.registerTool;
  // Kinds built into Studio (docs/merging-add-ons.md); the hub calls them in-process.
  const artifacts = registerArtifacts(bb, db, services);
  bb.onDispose(() => artifacts.dispose());
  const drawings = registerDraw(bb, db, services);
  bb.onDispose(() => drawings.dispose());
  const designs = registerDesign(bb, db, services);
  bb.onDispose(() => designs.dispose());
  const dashboards = registerDashboards(bb, db, services);
  bb.onDispose(() => dashboards.dispose());
  // BB takes one settings definition per plugin. Studio's settings are Talk's,
  // Pages', Explore's and Reactions', under the keys they had in their own plugins,
  // then Bot avatars' (with Studio's shared OpenAI key), Speech's and thread
  // resume's, plus Decisions under namespaced keys.
  const settings = bb.settings.define({ ...DECISIONS_SETTINGS, ...TALK_SETTINGS, ...PAGES_SETTINGS, ...REACTIONS_SETTINGS, ...BOT_AVATAR_SETTINGS, ...SPEECH_SETTINGS, ...THREAD_RESUME_SETTINGS });
  const code = registerCode(bb, db);
  const decisions = await registerDecisions(bb, settings);
  const recordings = await registerTalk(bb, db, settings as unknown as TalkSettingsHandle);
  bb.onDispose(() => recordings.dispose());
  // "Bot avatars: OpenAI API key" became Studio's one OpenAI key: move a key set there.
  await migrateOpenaiKey({ get: () => settings.get(), set: (values) => settings.experimental_set(values as never) })
    .then((moved) => { if (moved) bb.log.info("Moved the Bot avatars OpenAI key to Studio's OpenAI API key setting."); })
    .catch((error) => bb.log.warn(`Couldn't move the Bot avatars OpenAI key: ${errorText(error)}`));
  let settingValues: Record<string, unknown> = await settings.get();
  const explore = registerExploreBuiltin(bb, db, settingValues);
  settings.onChange((next) => {
    settingValues = next;
    explore.update(next);
  });
  const speech = registerSpeech(bb, db, {
    values: () => settingValues,
    set: async (values) => { settingValues = { ...settingValues, ...values }; await settings.experimental_set(values as never); },
  });
  // Reactions keep only settings: copy the old plugin's once, in the background.
  const reactionsImport = {
    plugins: bb.sdk.plugins,
    kv: bb.storage.kv,
    settings: { get: () => settings.get(), set: (values: Record<string, unknown>) => settings.experimental_set(values as never) },
  };
  void importReactionsSettings(reactionsImport).then((applied) => { if (applied) bb.log.info(`Copied Studio Reactions settings (${applied.join(", ") || "none changed"}).`); })
    .catch((error) => bb.log.warn(`Couldn't copy Studio Reactions settings: ${errorText(error)}`));
  const pages = registerPages(bb, db, {
    snapshotsPerPage: () => Number(settingValues.snapshotsPerPage ?? PAGES_SETTINGS.snapshotsPerPage.default),
  }, {
    created: (ref, threadId) => services.created(ref, threadId),
    linkThread: (thread) => services.linkThread(thread),
    replaceLinks: (ref, source, links) => services.replaceLinks(ref, source, links),
    recordActivity,

  });
  bb.onDispose(() => pages.dispose());
  // BB takes one agent configuration per plugin: the built-in kinds' tools in
  // every session, with Pages' instructions and the Next row's (Explore's), as
  // the Pages plugin gave them.
  // Setup → Kinds: built-in kinds the user turned off, and who opens and
  // creates each (src/kinds.ts).
  const kindSettings = new KindSettingsStore(bb.storage.kv as never);
  await kindSettings.load();
  // A dashboard kind that's off refreshes nothing.
  dashboards.setEnabled(() => builtinOn(kindSettings.current, "dashboards"));
  const hub = new StudioHub(bb.sdk, [
    { pluginId: "studio-code", name: "VS Code", handlers: code.provider },
    { pluginId: "pages", name: "Pages", handlers: pages.provider },
    { pluginId: "artifacts", name: "Artifacts", handlers: artifacts.provider },
    { pluginId: "excalidraw", name: "Drawings", handlers: drawings.provider },
    { pluginId: "design", name: "Designs", handlers: designs.provider },
    { pluginId: "talk", name: "Recordings", handlers: recordings.provider },
    { pluginId: "dashboards", name: "Dashboards", handlers: dashboards.provider },
  ], {
    builtinOn: (pluginId) => builtinOn(kindSettings.current, pluginId),
    route: (providers) => routeProviders(providers, kindSettings.current),
  });
  // The agent configuration is synchronous, so it reads the last resolved
  // routes; they refresh in the background at most every 30 seconds.
  let kindRoutes: KindRoute[] = resolveKinds([], kindSettings.current);
  let routesCheckedAt = 0;
  let routesRefresh: Promise<KindRoute[]> | null = null;
  const refreshRoutes = (): Promise<KindRoute[]> => routesRefresh ??= hub.providers()
    .then((providers) => { kindRoutes = resolveKinds(providers, kindSettings.current); routesCheckedAt = Date.now(); return kindRoutes; })
    .catch(() => kindRoutes)
    .finally(() => { routesRefresh = null; });
  void refreshRoutes();
  const BOT_TOOLS = ["bot_get", "bot_set", "bot_avatar_generate", "bot_pause", "bot_resume", "bot_stop", "bot_activity"] as const;
  /** Only the Bot's own thread gets these: its skills and its history. */
  const BOT_OWN_TOOLS = ["bot_profile_update", "bot_skill_list", "bot_skill_view", "bot_skill_write", "bot_skill_patch", "bot_skill_delete", "bot_skill_lint", "bot_history_search", "runner_create", "runner_update", "runner_pause", "runner_resume", "runner_delete", "runner_list", "runner_run_now", "automation_list", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_run_now", "automation_delete"] as const;
  /** A side thread (src/bot-side-threads.ts) talks about one reply: it reads the Bot, never changes it. */
  const SIDE_THREAD_TOOLS = ["bot_get", "bot_activity", "bot_skill_list", "bot_skill_view", "bot_history_search", "runner_list", "automation_list"] as const;
  // A fork inherits its Bot's session, tool list included, so configure can't
  // take tools away from a side thread: each tool that changes the Bot
  // refuses there instead. Installed before any tool registers.
  const SIDE_THREAD_REFUSED = new Set<string>([...BOT_TOOLS, ...BOT_OWN_TOOLS].filter((name) => !(SIDE_THREAD_TOOLS as readonly string[]).includes(name)));
  const registerAgentTool = bb.agents.registerTool.bind(bb.agents);
  bb.agents.registerTool = ((tool: Parameters<typeof registerAgentTool>[0]) => registerAgentTool(!SIDE_THREAD_REFUSED.has(tool.name) ? tool : {
    ...tool,
    execute: async (input: never, ctx: { threadId: string }) => await sideThreads.isSideThread(ctx.threadId)
      ? `Refused: this is a side thread, which can read about the Bot but not change it. Tell the user ${tool.name.replace(/_/g, " ")} is done from the Bot's main chat.`
      : (tool.execute as (input: never, ctx: never) => unknown)(input, ctx as never),
  } as never)) as typeof bb.agents.registerTool;
  /** Only a runner's thread gets this (src/runners.ts). */
  const RUNNER_TOOLS = ["runner_report"] as const;
  const KIND_TOOLS: Record<string, readonly string[]> = { page: PAGE_TOOLS, artifact: ARTIFACT_TOOLS, drawing: DRAW_TOOLS, design: DESIGN_TOOLS, recording: TALK_TOOLS, dashboard: DASHBOARD_TOOLS };
  // BB takes one agent configuration per plugin: the built-in kinds' tools in
  // every session, with Pages' instructions and the Next row's (Explore's), as
  // the Pages plugin gave them. A kind turned off gives neither, from the next
  // session start or resume on (BB doesn't change a running session).
  /** Studio → Voice (src/voice/); registered once the Bot is, below. */
  let voice: BuiltinVoice | null = null;
  bb.agents.configure((context) => {
    if (Date.now() - routesCheckedAt > 30_000) void refreshRoutes();
    const off = new Set(kindSettings.current.off);
    const tools = BUILTIN_KINDS.filter((each) => !off.has(each.kind)).flatMap((each) => [...(KIND_TOOLS[each.kind] ?? [])]);
    tools.push(...CODE_TOOLS);
    // A voice chat is told to speak, not write, and gets Studio's item tools with its own;
    // voice mode in any other thread adds the same to what it already gets (at the end).
    const voiceMode = voice?.configure(context.thread.id, context.pluginMetadata) ?? null;
    if (voiceMode?.chat) return { tools: [...tools, ...voiceMode.tools], skills: ["studio-code"], instructions: voiceMode.instructions };
    const withVoice = (config: { tools: string[]; skills: string[]; instructions: string }) => voiceMode
      ? { ...config, tools: [...config.tools, ...voiceMode.tools], instructions: [config.instructions, voiceMode.instructions].filter(Boolean).join("\n\n") }
      : config;
    // A skill review fork (src/skill-learning.ts) gets the skill tools and the Memory page's, nothing else of Studio's.
    if (learning.review(context.thread.id) || typeof context.pluginMetadata?.botReview === "string") return { tools: [...REVIEW_TOOLS, ...CODE_TOOLS], skills: ["studio-code"], instructions: "" };
    // The Bot's own thread is told who it is; paused or stopped, it gets no Studio tools but its own.
    // A side thread (a fork at one of its replies) runs as the Bot too.
    // BB sets a fork's session up while it's made, before Studio records it:
    // the fork's metadata says it's a side thread from the start.
    const sideBotId = typeof context.pluginMetadata?.botSideThread === "string" ? context.pluginMetadata.botSideThread : sideThreads.forThread(context.thread.id)?.botId;
    const sideBot = sideBotId ? bots.stored(sideBotId) : null;
    if (sideBot && sideBot.kind !== "external") {
      const asBot = { ...sideBot, threadId: context.thread.id };
      const instructions = [bots.instructions(asBot), SIDE_THREAD_INSTRUCTIONS, off.has("page") ? "" : PAGE_INSTRUCTIONS, explore.instructions(), routingInstructions(kindRoutes, kindSettings.current)].filter(Boolean).join("\n\n");
      return withVoice({ tools: [...tools, ...SIDE_THREAD_TOOLS], skills: ["studio-code"], instructions });
    }
    const bot = sideBot ? { ...sideBot, threadId: context.thread.id } : bots.forThread(context.thread.id, context.pluginMetadata);
    // An external bot's agent has its own memory and tools; Studio's don't reach it.
    if (bot?.kind === "external") return withVoice({ tools: [], skills: [], instructions: bots.instructions(bot) });
    if (bot && bot.state !== "active") return withVoice({ tools: [...BOT_TOOLS, ...CODE_TOOLS], skills: ["studio-code"], instructions: bots.instructions(bot) });
    // A runner is told its job and how to report; it reports with runner_report only.
    const runner = bot ? null : runners.forThread(context.thread.id, context.pluginMetadata);
    const instructions = [bot ? bots.instructions(bot) : "", runner ? runners.instructions(runner) : "", off.has("page") ? "" : PAGE_INSTRUCTIONS, explore.instructions(), routingInstructions(kindRoutes, kindSettings.current)].filter(Boolean).join("\n\n");
    return withVoice({ tools: [...tools, ...BOT_TOOLS, ...(bot ? BOT_OWN_TOOLS : []), ...(runner ? RUNNER_TOOLS : [])], skills: ["studio-code"], instructions });
  });
  // Other add-ons reach built-in kinds' provider methods through Studio
  // (callProvider in the kit), as they reach an add-on's over RPC.
  bb.rpc.register(builtinProviderContract, {
    [STUDIO_PROVIDER_CALL_METHOD]: ({ pluginId, method, input }) => {
      if (!BUILTIN_PLUGIN_IDS.has(pluginId)) throw new Error(`${pluginId} isn't built into Studio.`);
      return hub.call(pluginId, method, input as never);
    },
  });
  const tags = new TagStore(db);
  const tabs = new TabStore(db);
  const views = new ViewStore(db);
  const threadTitles = new ThreadTitles(async (threadId) => ((await bb.sdk.threads.get({ threadId })) as { title?: string | null }).title ?? "");
  /** Adds each item's tag ids and the thread that made it. */
  const listed = async <T extends { pluginId: string; id: string }>(items: readonly T[]) => {
    const assigned = tags.assignments();
    const origins = services.originThreads();
    const keys = items.map((item) => `${item.pluginId}:${item.id}`);
    const titles = await threadTitles.titles(keys.flatMap((key) => origins.get(key) ?? []));
    return items.map((item, index) => {
      const threadId = origins.get(keys[index]!);
      return { ...item, tags: assigned.get(keys[index]!) ?? [], thread: threadId ? { id: threadId, title: titles.get(threadId) ?? "" } : null };
    });
  };
  const workspace = new WorkspacePresence();
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
  const providerHistory = new ProviderHistory(bb.sdk, {
    artifacts: {
      versions: (id) => artifacts.store.versions(id).map((version) => ({ id: version.id, name: version.name, createdAt: version.created_at })),
      bytes: (id, versionId) => {
        const version = artifacts.store.version(id, versionId);
        return version ? artifacts.store.bytes(version.sha256) : null;
      },
    },
  });
  const providerComments = new ProviderComments(bb.sdk);
  const pendingThreadChecks = new Set(services.activeThreads().map((thread) => thread.threadId));
  let reconcilingThreads: Promise<void> | null = null;
  const reconcileThreads = (): Promise<void> => reconcilingThreads ??= (async () => {
    for (const threadId of pendingThreadChecks) {
      const complete = await services.reconcileThread(threadId, () => bb.sdk.threads.get({ threadId }),
        (error) => bb.log.warn(`Thread ${threadId} unavailable: ${errorText(error)}`));
      if (complete) pendingThreadChecks.delete(threadId);
    }
  })().finally(() => { reconcilingThreads = null; });
  await reconcileThreads();
  const threadCheckTimer = setInterval(() => void reconcileThreads().catch((error) => bb.log.warn(`Thread reconciliation failed: ${errorText(error)}`)), 60_000);
  bb.onDispose(async () => { clearInterval(threadCheckTimer); await reconcilingThreads; });
  const updateThread = (threadId: string, state: string) => {
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
    return {
      providers: result.providers,
      items: await listed(result.items),
      tags: tags.list(),
      views: views.list(),
    };
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
  /** Deletes an add-on's items and forgets their tags, tabs and versions. */
  const deleteItems = async (pluginId: string, ids: string[]) => {
    const result = await hub.call(pluginId, "studio_delete", { ids });
    tags.forget(pluginId, result.done);
    services.forgetVersions(pluginId, result.done);
    if (tabs.forget(pluginId, result.done)) tabsChanged();
    return result;
  };

  // Each project's optional lead thread and its heartbeat (src/project-lead.ts).
  // The heartbeat of the personal project is the Bot's check-in, under its name.
  const projectLeads: ProjectLeads = new ProjectLeads({ db, sdk: bb.sdk, changed: tagsChanged, personalPrompt: (): string => bots.prompt(), botPrompt: (key) => bots.promptFor(key) });
  // The user's Bot (src/bot.ts): the personal project's lead, with a name, avatar and state.
  // Its Memory page is a Studio page in the personal project; a shared skill goes to BB's user skills.
  const bots: Bots = new Bots({
    db, sdk: bb.sdk, leads: projectLeads, changed: tagsChanged,
    memory: {
      exists: (pageId) => { const page = pages.store.meta(pageId); return !!page && !page.archived_at; },
      create: ({ title, markdown }) => pages.createPage({ projectId: PERSONAL_PROJECT_ID, title, icon: "🧠", markdown }),
      addCheckin: (pageId, line) => pages.addCheckin(pageId, line),
    },
    userSkillsDir: join(bb.server.experimental_dataDir, "skills"),
    hiddenThreads: () => learning.reviewThreads(),
    ownedThreads: (botId) => ownedThreads.owned(botId),
    claimChains: () => ownedThreads.claimChains(),
    runners: { threads: (botId) => runners.threads(botId), pauseAll: (botId, onPaused) => runners.pauseAll(botId, onPaused), restore: (id) => runners.restore(id) },
    automationAlerts: (botId) => [...autoResume.alerts(botId).filter((alert) => alert.owner !== "runner"), ...threadResume.alerts(botId)],
    automations: {
      pauseAll: (botId, onPaused) => automations.pauseAll(botId, onPaused),
      restore: (id) => automations.restore(id),
      follow: async (botId) => { const bot = automationBot(botId); if (bot) await automations.follow(bot); },
    },
  });
  // Voice sessions: a fast-model thread the user talks to, which hands work to the Bot or threads.
  voice = await registerVoice(bb, { speech: speech.service, botThread: () => bots.stored()?.threadId ?? null });
  // The Bot's runners (src/runners.ts): long-lived threads on their own schedules, quiet unless they report.
  const runners: Runners = new Runners({
    db, sdk: bb.sdk, changed: tagsChanged,
    bot: (botId) => bots.stored(botId),
    startedThreads: (botId) => bots.started(botId),
    chain: (botId) => bots.chain(botId),
    botThreads: () => new Set(bots.list().flatMap((bot) => bots.chain(bot.id))),
  });
  // Runner threads live under their Bot, out of BB's thread list: runners from
  // before (or a hide that failed) are hidden once; retried next startup.
  // Every thread a Bot uses (its chain, what the chain spawned, runs of
  // automations it or its threads made) lives under it, out of BB's thread
  // list (src/bot-owned.ts): hidden as they're made or assigned, plus a sweep
  // at startup and every five minutes.
  const ownedThreads = new BotOwnedThreads({
    db, sdk: bb.sdk, changed: tagsChanged, log: (message) => bb.log.warn(message),
    bots: () => bots.list().map((bot) => ({ id: bot.id, chain: bots.chain(bot.id) })),
    // A thread the user handed a Bot: a line in its chat, and a note asking for a short read of it.
    handed: async (thread, botId) => {
      const bot = bots.stored(botId);
      if (!bot?.threadId) return;
      const link = thread.projectId ? `[${thread.title.replace(/[[\]]/g, "")}](/projects/${thread.projectId}/threads/${thread.id})` : `**${thread.title}**`;
      await alertBot(bb.sdk, {
        botThreadId: bot.threadId, line: `📥 Handed to you: ${link}`,
        note: `The user dragged this thread (${thread.id}) onto you in Studio's sidebar: it's yours now and lists under you. Read it (bb thread show ${thread.id}, bb thread output ${thread.id}) and reply in one or two short lines: what it's about and whether it waits on you or the user. Don't start work on it unless it plainly waits on you.`,
      });
    },
    skip: () => runners.threadIds(),
  });
  const sweepOwned = () => void ownedThreads.sweep().catch((error) => bb.log.warn(`Hiding Bot threads failed: ${errorText(error)}`));
  bb.events.on("thread.created", ({ thread }) => void ownedThreads.created(thread).catch(() => {}));
  // The same five-minute sweep turns back on automations BB turned off (resumeSweep, below).
  const ownedTimer = setInterval(() => { sweepOwned(); resumeSweep(); threadResumeSweep(); }, 5 * 60_000);
  bb.onDispose(() => { clearInterval(ownedTimer); ownedThreads.dispose(); });
  void runners.hideThreads().catch((error) => bb.log.warn(`Hiding runner threads failed: ${errorText(error)}`)).finally(sweepOwned);
  // A Bot's automations (src/automations.ts): check-ins, reminders, watchers, and its runners in the same list.
  const automationBot = (botId?: string) => { const bot = bots.stored(botId); return bot ? { id: bot.id, name: bot.name, threadId: bot.threadId, state: bot.state, primary: bot.primary !== false, kind: bot.kind ?? "studio" } : null; };
  const automations: Automations = new Automations({
    db, sdk: bb.sdk, changed: tagsChanged,
    bot: automationBot,
    heartbeat: {
      get: (botId) => { const key = bots.heartbeatKey(botId); return key ? projectLeads.runs.get(key) : null; },
      set: async (botId, run) => { await bots.setRun({ botId, ...run }); },
      automation: (botId) => { const key = bots.heartbeatKey(botId); return key ? projectLeads.runs.automation(key) : null; },
    },
    runners: {
      list: (botId) => runners.list(botId),
      get: (id, botId) => runners.get(id, botId),
      create: (input, botId) => { bots.requireStudio(botId, "runners"); return runners.create(input, botId); },
      update: (input, botId) => runners.update(input, botId),
      setState: (id, state, botId) => runners.setState(id, state, botId),
      runNow: (id, botId) => runners.runNow(id, botId),
      delete: (id, botId) => runners.delete(id, botId),
      automation: (id) => runners.automation(id),
    },
    maintenance: {
      get: (botId) => { const view = maintenance.view(botId); const last = view.runs[0]; return { paused: !view.settings.enabled, lastRunAt: last?.at ?? null, lastOutcome: last?.summary ?? null, nextRunAt: view.settings.enabled ? (() => { const next = new Date(); next.setHours(4, 0, 0, 0); if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1); return next.getTime(); })() : null }; },
      setPaused: async (botId, paused) => { await maintenance.set(botId, { enabled: !paused }); },
      run: async (botId) => { await maintenance.run(botId); },
    },
  });
  // Runner and Bot automations BB turned off after a transient failure come
  // back on (src/auto-resume.ts), at most three times a day each; past that,
  // Needs you. At startup, on the five-minute sweep, and soon after a
  // target thread goes idle or fails.
  const resumeTargets = (): ResumeTarget[] => [
    ...runners.resumeTargets().map((target) => ({ ...target, owner: "runner" as const })),
    ...bots.list().flatMap((bot) => {
      const key = bots.heartbeatKey(bot.id);
      const run = key ? projectLeads.runs.get(key) : null;
      const automation = key ? projectLeads.runs.automation(key) : null;
      return automation ? [{ automationId: automation.id, projectId: automation.projectId, botId: bot.id, owner: "checkin" as const, ownerId: "heartbeat", name: `${bot.name}'s check-in`, on: !!run?.enabled && bot.state === "active" }] : [];
    }),
    ...automations.resumeTargets().map((target) => ({ ...target, owner: "automation" as const })),
  ];
  const autoResume = new AutoResume({
    db, sdk: bb.sdk, targets: resumeTargets, log: (message) => bb.log.warn(message),
    resumed: (target, line) => { if (target.owner === "runner") runners.note(target.ownerId, line); else tagsChanged(); },
    exhausted: async (target, line) => {
      if (target.owner === "runner") { await runners.alert(target.ownerId, line); return; }
      tagsChanged();
      const bot = bots.stored(target.botId);
      if (bot?.threadId) {
        await alertBot(bb.sdk, {
          botThreadId: bot.threadId, line: `⚠️ ${line}`,
          note: "Studio notice, already shown to the user as is. Don't reply or acknowledge it; reply exactly [PASS].",
          push: { title: `${bot.name} · ${target.name}`, body: line, coalesceKey: `auto-resume:${target.automationId}` },
        });
      }
    },
  });
  const resumeSweep = () => void autoResume.sweep().catch((error) => bb.log.warn(`Auto-resume failed: ${errorText(error)}`));
  bb.onDispose(() => autoResume.dispose());
  const resumeSoon = (threadId: string) => { if (runners.forThread(threadId) || bots.list().some((bot) => bot.threadId === threadId)) autoResume.later(); };
  bb.events.on("thread.idle", ({ thread }) => resumeSoon(thread.id));
  bb.events.on("thread.failed", ({ thread }) => resumeSoon(thread.id));
  resumeSweep();
  // Threads a host restart cut off (src/thread-resume.ts): resumed with a
  // marker, at most twice an hour each; past that, Needs you (a Bot's thread)
  // or a phone push (any other).
  const threadOwner = (threadId: string): ThreadOwner | null => {
    const bot = bots.list().find((each) => bots.chain(each.id).includes(threadId))
      ?? (() => { const runner = runners.forThread(threadId); return runner ? bots.stored(runner.bot_id) : null; })()
      ?? bots.list().find((each) => ownedThreads.owned(each.id).has(threadId));
    return bot ? { botId: bot.id, name: bot.name, threadId: bot.threadId ?? null, active: bot.state === "active" } : null;
  };
  const threadResume = new ThreadResume({
    db, sdk: bb.sdk, owner: threadOwner, log: (message) => bb.log.warn(message),
    enabled: () => settingValues.autoResumeThreads !== false,
    exhausted: async (thread, owner, line) => {
      if (owner?.threadId) {
        tagsChanged();
        await alertBot(bb.sdk, {
          botThreadId: owner.threadId, line: `⚠️ ${line}`,
          note: "Studio notice, already shown to the user as is. Don't reply or acknowledge it; reply exactly [PASS].",
          push: { title: `${owner.name} · ${thread.title}`, body: line, coalesceKey: `thread-resume:${thread.id}` },
        });
        return;
      }
      await bb.sdk.plugins.callRpc({
        pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
        input: { title: `Stopped: ${thread.title}`, body: line, kind: "turn-finished", threadId: thread.id, ...(thread.projectId ? { projectId: thread.projectId } : {}), coalesceKey: `thread-resume:${thread.id}` } as never,
      }).catch((error) => bb.log.warn(`Thread resume notice failed: ${errorText(error)}`));
    },
  });
  const threadResumeSweep = () => void threadResume.sweep().catch((error) => bb.log.warn(`Thread resume sweep failed: ${errorText(error)}`));
  bb.onDispose(() => threadResume.dispose());
  bb.events.on("thread.failed", ({ thread }) => threadResume.failed(thread.id));
  bb.events.on("thread.idle", ({ thread }) => threadResume.idle(thread.id));
  bb.events.on("thread.archived", ({ thread }) => threadResume.settled(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => threadResume.settled(thread.id));
  // host:changed comes over BB's realtime socket (SDK 0.6.37 has it); without it, the sweeps still run.
  if (typeof bb.sdk.subscribe === "function") {
    try {
      const unsubscribe = bb.sdk.subscribe({ event: "host:changed", callback: (event) => { if (event.changes.includes("host-connected")) threadResume.hostConnected(); } });
      bb.onDispose(() => unsubscribe());
    } catch (error) { bb.log.warn(`Thread resume: no host events (${errorText(error)})`); }
  }
  threadResume.startup();
  // Skills that learn (src/skill-learning.ts): background reviews of a Bot's work; Maintenance owns curation.
  const learningBot = (bot: NonNullable<ReturnType<typeof bots.stored>>) => ({ id: bot.id, name: bot.name, threadId: bot.threadId, state: bot.state, kind: bot.kind ?? "studio" });
  // Side threads on a Bot's replies (src/bot-side-threads.ts).
  const sideThreads = new SideThreads({
    db, sdk: bb.sdk, changed: tagsChanged,
    botFor: (threadId) => bots.list().find((bot) => bots.chain(bot.id).includes(threadId)) ?? null,
  });
  bb.events.on("thread.idle", ({ thread }) => void sideThreads.idle(thread.id).catch((error) => bb.log.warn(`Side thread replies: ${errorText(error)}`)));
  // A side chat made on a Bot's chat (BB's side-chat plugin) becomes one of its side threads.
  bb.events.on("thread.created", ({ thread }) => void sideThreads.created(thread).catch((error) => bb.log.warn(`Side chat: ${errorText(error)}`)));
  bb.events.on("thread.active", ({ thread }) => sideThreads.touched(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => sideThreads.forget(thread.id));
  // Archived from its menu (or BB's): the Bot's lists drop it, and bring it back unarchived.
  bb.events.on("thread.archived", ({ thread }) => sideThreads.touched(thread.id));
  bb.events.on("thread.unarchived", ({ thread }) => sideThreads.touched(thread.id));
  const learning: SkillLearning = new SkillLearning({
    db, sdk: bb.sdk, changed: tagsChanged,
    bots: () => bots.list().map(learningBot),
    bot: (botId) => { const bot = bots.stored(botId); return bot ? learningBot(bot) : null; },
    memoryPage: (botId) => { try { return bots.memoryPage(botId); } catch { return null; } },
    skills: (botId) => bots.skills(botId).map((skill) => ({ name: skill.name, description: skill.description, body: bots.skill(skill.name, botId)?.body ?? "", state: skill.state ?? "active", pinned: !!skill.pinned, usedAt: skill.usedAt ?? null, updatedAt: skill.updatedAt })),
    setState: (botId, name, state) => { bots.setSkillState(name, state, botId); },
    log: (message) => bb.log.warn(message),
  });
  const maintenance = new BotMaintenance({
    db, sdk: bb.sdk, changed: tagsChanged,
    bots: () => bots.list(), owned: (id) => ownedThreads.owned(id), refreshOwned: () => ownedThreads.sweep(),
    memory: (id) => { const pageId = bots.memoryPage(id); if (!pageId) return null; const page = pages.store.meta(pageId); return page ? { id: pageId, markdown: pages.markdown(pageId) ?? "", updatedAt: page.updated_at } : null; },
    curate: (id, dryRun) => learning.curate(id, { dryRun }),
    automationPause: (id, botId) => automations.setState(id, "paused", botId),
    automationDelete: (id, botId) => automations.delete(id, botId),
    adoptable: (id) => runners.adoptable(id),
    alert: async (id, line) => { const bot = bots.stored(id); if (bot?.threadId) await alertBot(bb.sdk, { botThreadId: bot.threadId, line, note: "Maintenance alert, already shown to the user. Do not repeat or acknowledge it. Reply exactly [PASS]. Details are in Bot info → Maintenance." }); },
  });
  bb.events.on("thread.idle", ({ thread }) => {
    const bot = bots.list().find((b) => b.threadId === thread.id);
    if (bot) void bb.sdk.threads.events.list({ threadId: thread.id, order: "desc", limit: "1", types: ["client/turn/requested"] }).then((events) => {
      const key = bots.heartbeatKey(bot.id);
      const heartbeat = key ? projectLeads.runs.automation(key) : null;
      if (heartbeat && JSON.stringify(events[0]?.data ?? {}).includes(`[bb automation due:${heartbeat.id}]`)) return maintenance.tick(Date.now(), bot.id);
    }).catch((error) => bb.log.warn(`Maintenance after check-in: ${errorText(error)}`));
  });
  // Prompt-cache warming for Bot chats (src/bot-cache.ts): a tiny ping about
  // every 55 minutes while the user is around, and one compaction before the
  // cache expires once they've gone idle; nothing in the first 5 minutes.
  const warmer: BotCacheWarmer = new BotCacheWarmer({
    db, sdk: bb.sdk, pluginId: "studio", changed: tagsChanged, log: (message) => bb.log.warn(message),
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, state: bot.state, threadId: bot.threadId, kind: bot.kind ?? "studio" })),
  });
  bb.events.on("thread.idle", ({ thread }) => void warmer.idle(thread.id).catch(() => {}));
  bb.events.on("thread.failed", ({ thread }) => warmer.failed(thread.id));
  const warmTimer = setInterval(() => void warmer.tick().catch((error) => bb.log.warn(`Cache warming tick failed: ${errorText(error)}`)), 60_000);
  bb.onDispose(() => clearInterval(warmTimer));
  /** A Studio bot's id for its learning settings (the primary without one). */
  const learnerId = (botId?: string) => { const bot = bots.stored(botId); if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first."); bots.requireStudio(bot.id, "skill learning"); return bot.id; };
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => void learning.idle(thread, lastAssistantText).catch((error) => bb.log.warn(`Skill learning: ${errorText(error)}`)));
  // A cache-warming ping isn't a new turn by the user: it leaves a running review alone.
  bb.events.on("thread.active", ({ thread }) => { if (!warmer.pinging(thread.id)) void learning.active(thread.id).catch(() => {}); });
  bb.events.on("thread.failed", ({ thread, error }) => void learning.failed(thread.id, error).catch(() => {}));
  // Watchers' findings and end dates, once a minute; Maintenance and stuck reviews too.
  void runners.retryCleanup();
  void automations.tick().catch((error) => bb.log.warn(`Automations startup failed: ${errorText(error)}`));
  const automationTimer = setInterval(() => {
    void runners.retryCleanup();
    void automations.tick().catch((error) => bb.log.warn(`Automations tick failed: ${errorText(error)}`));
    void maintenance.tick().catch((error) => bb.log.warn(`Maintenance tick failed: ${errorText(error)}`));
    void learning.tick().catch((error) => bb.log.warn(`Skill learning tick failed: ${errorText(error)}`));
  }, 60_000);
  // Moves Spaces' leads to projects, retires old heartbeat automations and turns
  // migrated heartbeats back on; whatever fails is retried next startup.
  void projectLeads.finishMoves()
    .then(() => projectLeads.runs.repair((key) => bots.threadForRunKey(key) ?? projectLeads.storedLead(key)))
    // An enabled check-in picks up the current prompt (botHeartbeat), same schedule.
    .then(async () => {
      const run = projectLeads.runs.get(PERSONAL_PROJECT_ID);
      if (run?.enabled && bots.stored()) await projectLeads.setRun(PERSONAL_PROJECT_ID, run);
    })
    .catch((error) => console.warn("[studio] heartbeat repair failed; retrying next startup", error));
  /**
   * Moves items to a project. Items already there stay; kinds that can't move
   * are listed as failed.
   */
  const moveItems = async (refs: readonly ItemRef[], { projectId }: { projectId: string | null }) => {
    const { items, providers } = await hub.overview();
    const movable = new Set(providers.flatMap((provider) => provider.kinds.filter((kind) => kind.capabilities?.move).map((kind) => `${provider.pluginId}:${kind.id}`)));
    const byKey = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item]));
    const known = refs.flatMap((ref) => {
      const item = byKey.get(`${ref.pluginId}:${ref.id}`);
      return item ? [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), projectId: item.projectId ?? null, kind: item.kind }] : [];
    });
    const plan = planMove(known, { projectId }, (item) => item.pluginId !== STUDIO_PLUGIN_ID && movable.has(`${item.pluginId}:${item.kind}`));
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
    // A built-in's Studio address, or its old add-on address.
    const builtin = builtinItemAt(path);
    if (builtin) return itemAtPath(await hub.get(builtin.pluginId, [builtin.id]).catch(() => []), builtin.href);
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

  /** The thread a cache RPC is about: the one given, else the Bot's chat. */
  const cacheThread = (threadId: string | undefined, botId: string | undefined): string => {
    if (threadId) return threadId;
    const bot = bots.stored(botId);
    if (!bot?.threadId) throw new Error(bot ? `${bot.name} has no chat.` : "Make your Bot first.");
    return bot.threadId;
  };
  bb.rpc.register(rpcContract, {
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
    project_leads: () => ({ leads: projectLeads.list() }),
    project_lead: ({ projectId }) => projectLeads.get(projectId),
    project_set_lead: async ({ projectId, threadId }) => {
      const lead = await projectLeads.setLead(projectId, threadId);
      // The personal project's lead is the primary Bot's thread.
      if (projectId === PERSONAL_PROJECT_ID) await ownedThreads.claimChains().catch(() => {});
      return lead;
    },
    // The personal project's heartbeat is the Bot's: it can't be turned on while the Bot is paused or stopped.
    project_set_run: async ({ projectId, ...run }) => {
      if (projectId === PERSONAL_PROJECT_ID) await bots.setRun(run);
      else return projectLeads.setRun(projectId, run);
      return projectLeads.get(projectId);
    },
    bot_list: () => ({ bots: bots.list() }),
    bot_get: ({ botId }) => bots.get(botId),
    bot_create: (input) => bots.create(input),
    bot_set: (input) => bots.set(input),
    bot_avatar_history: ({ botId }) => bots.avatarHistory(botId),
    bot_profile_changes: ({ botId }) => ({ changes: bots.profileChanges(botId) }),
    bot_profile_revert: ({ botId, changeId }) => bots.revertChange(botId, changeId),
    bot_avatar_use: ({ botId, imageId }) => { const bot = bots.useAvatarImage(botId, imageId); return bots.get(bot.id); },
    bot_avatar_revert: ({ botId }) => { const bot = bots.revertAvatar(botId); return bots.get(bot.id); },
    bot_avatar_upload: ({ botId, data }) => {
      const bytes = Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64");
      const mime = imageMime(bytes);
      if (!mime) throw new Error("Upload a PNG, JPEG, WebP or GIF image.");
      const bot = bots.addAvatarImage(botId, { data: bytes, mime, source: "upload" });
      return bots.get(bot.id);
    },
    bot_set_thread: ({ threadId }) => bots.setThread(threadId),
    bot_set_run: (run) => bots.setRun(run),
    bot_pause: ({ botId }) => bots.pause(botId),
    bot_resume: ({ botId }) => bots.resume(botId),
    bot_stop: ({ botId }) => bots.stop(botId),
    bot_maintenance_threads: async ({ botId }) => ({ threads: await maintenance.olderThreads(learnerId(botId)) }),
    bot_maintenance_get: ({ botId }) => maintenance.view(learnerId(botId)),
    bot_maintenance_set: ({ botId, ...patch }) => maintenance.set(learnerId(botId), patch),
    bot_maintenance_run: ({ botId, dryRun }) => maintenance.run(learnerId(botId), { dryRun }),
    bot_activity: async ({ botId }) => ({ ...await bots.activity(botId), maintenance: bots.stored(botId) ? maintenance.view(bots.stored(botId)!.id).runs : [] }),
    bot_cache_state: ({ threadId, botId }) => warmer.state(cacheThread(threadId, botId)),
    bot_cache_set: ({ botId, ...patch }) => {
      const bot = bots.stored(botId);
      if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first.");
      warmer.setSettings(bot.id, patch);
      return warmer.state(cacheThread(undefined, bot.id));
    },
    bot_cache_banner_hide: ({ threadId }) => { warmer.hideBanner(threadId); return { ok: true as const }; },
    bot_cache_compact: async ({ threadId }) => { await warmer.compact(threadId); return { ok: true as const }; },
    thread_handoff_to_model: ({ threadId, providerId, model, reasoning }) => bots.switchModel(threadId, { providerId, model, ...(reasoning ? { reasoning } : {}) }),
    bot_memory: ({ botId }) => { bots.requireStudio(botId, "Memory page"); return { pageId: bots.memoryPage(botId) }; },
    bot_external_providers: () => externalProviders({
      registered: () => bb.sdk.providers.list(),
      health: (provider) => bb.sdk.plugins.callRpc({ pluginId: EXTERNAL_AGENTS_PLUGIN_ID, method: "health", input: { provider } as never, outputSchema: z.object({ online: z.boolean(), status: z.string(), message: z.string() }) }),
      models: async (providerId) => (await bb.sdk.providers.models({ providerId })).models,
    }),
    bot_chain: async ({ botId }) => { const threads = await bots.chainThreads(botId); return { threadIds: threads.map((thread) => thread.id), threads }; },
    bot_side_threads: async ({ threadId }) => ({ chat: sideThreads.isChat(threadId), threads: await sideThreads.list(threadId) }),
    bot_side_threads_for_bot: async ({ botId }) => { const bot = bots.stored(botId); return { threads: bot ? await sideThreads.forBot(bot.id) : [] }; },
    bot_listed_threads: () => ({ threadIds: [...new Set([...ownedThreads.all(), ...sideThreads.threadIds()])] }),
    bot_side_thread_open: ({ threadId, messageId }) => sideThreads.open(threadId, messageId),
    bot_thread_owner: ({ threadId }) => ({ botId: ownedThreads.ownerOf(threadId) ?? runners.forThread(threadId)?.bot_id ?? null }),
    bot_thread_release: ({ threadId }) => ownedThreads.release(threadId),
    bot_thread_adopt: ({ botId, threadId }) => { const bot = bots.stored(botId); if (!bot) throw new Error("That bot isn't there anymore."); return ownedThreads.adopt(threadId, bot.id); },
    bot_checkin_preset: ({ botId, preset }) => bots.checkinPreset(preset, botId),
    bot_skills: ({ botId }) => ({ skills: bots.skills(botId) }),
    bot_skill_write: ({ botId, ...input }) => { bots.requireStudio(botId, "skills"); return bots.writeSkill(input, botId); },
    bot_skill_share: ({ botId, name }) => bots.shareSkill(name, botId),
    bot_skill_delete: ({ botId, name }) => ({ deleted: bots.deleteSkill(name, botId) }),
    bot_skill_pin: ({ botId, name, pinned }) => ({ changed: bots.pinSkill(name, pinned, botId) }),
    bot_skill_restore: ({ botId, name }) => ({ changed: bots.setSkillState(name, "active", botId) }),
    bot_learning: ({ botId }) => learning.view(learnerId(botId)),
    bot_learning_set: ({ botId, ...input }) => learning.set(learnerId(botId), input),
    bot_learning_review: async ({ botId }) => ({ started: await learning.start(learnerId(botId), "review", "manual") }),
    bot_skill_curate: ({ botId, dryRun }) => learning.curate(learnerId(botId), { dryRun }),
    // Deprecated for one release: old iOS clients receive an empty pending list.
    bot_skill_history: ({ botId, before }) => ({ versions: bots.skillHistory(botId, before) }),
    bot_skill_revert: ({ botId, versionId }) => { bots.revertSkill(versionId, botId); return { reverted: true }; },
    bot_automations: async ({ botId }) => ({ automations: await automations.list(botId) }),
    bot_automation_create: ({ botId, ...input }) => automations.create(input as never, botId),
    bot_automation_update: ({ botId, ...input }) => automations.update(input as never, botId),
    bot_automation_pause: ({ botId, id }) => automations.setState(id, "paused", botId),
    bot_automation_resume: ({ botId, id }) => automations.setState(id, "active", botId),
    bot_automation_run_now: ({ botId, id }) => automations.runNow(id, botId),
    bot_automation_delete: ({ botId, id }) => automations.delete(id, botId),
    bot_automation_runs: async ({ botId, id, limit }) => ({ runs: await automations.runs(id, botId, limit) }),
    bot_runners: async ({ botId }) => { const [list, adoptable] = await Promise.all([runners.list(botId), runners.adoptable(botId)]); return { runners: list, adoptable }; },
    bot_runner_create: ({ botId, ...input }) => { bots.requireStudio(botId, "runners"); return runners.create(input, botId); },
    bot_runner_update: ({ botId, ...input }) => runners.update(input, botId),
    bot_runner_pause: ({ botId, id }) => runners.setState(id, "paused", botId),
    bot_runner_resume: ({ botId, id }) => runners.setState(id, "active", botId),
    bot_runner_run_now: ({ botId, id }) => runners.runNow(id, botId),
    bot_runner_delete: ({ botId, id }) => runners.delete(id, botId),
    bot_runner_seen: ({ botId, id }) => { runners.seen(id, botId); return { ok: true as const }; },
    bot_runner_adopt: ({ botId, ...input }) => { bots.requireStudio(botId, "runners"); return runners.adopt(input, botId); },
    // Deprecated aliases of bot_get, bot_set_thread and bot_set_run, for one release.
    chief_of_staff: () => projectLeads.chief(),
    chief_of_staff_set: async ({ threadId }) => { if (threadId) await bots.setThread(threadId); else await projectLeads.setChief(null); return projectLeads.chief(); },
    chief_of_staff_set_run: async (run) => { await bots.setRun(run); return projectLeads.chief(); },
    thread_handoff: async ({ threadId, request }) => {
      const result = await projectLeads.handoff(threadId, request);
      // An additional Bot's thread isn't a lead: it follows the handoff here.
      await bots.handedOff(threadId, result.threadId);
      return result;
    },
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
    studio_changed: async ({ pluginId, ids, removed }) => {
      await searchIndex.changed(pluginId, ids, removed).catch(() => {});
      await recordProviderChanges(hub, services, changes, pluginId, ids, removed);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId, ids, removed });
      return { ok: true };
    },
    changes: ({ since }) => changes.since(since),
    items: async ({ pluginId, ids }) => {
      return { items: await listed(await hub.get(pluginId, ids)) };
    },
    sidebar: () => readSidebar(),
    tabs: async () => ({ tabs: tabViews(await tabData()) }),
    visitTab: async ({ path }) => {
      // Studio's own pages aren't items; its built-in kinds' item pages are.
      if (!path.startsWith("/plugins/") || (path.startsWith(`/plugins/${STUDIO_PLUGIN_ID}/`) && !builtinItemAt(path))) return { tab: null };
      const item = await itemForPath(path);
      if (!item) return { tab: null };
      if (tabs.open(item)) tabsChanged();
      return { tab: tabViews(await tabData()).find((each) => each.pluginId === item.pluginId && each.id === item.id) ?? null };
    },
    workspaceReport: (report) => {
      workspace.report(report);
      return { ok: true };
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
      if ("path" in input && input.path.startsWith(`/plugins/${STUDIO_PLUGIN_ID}/`) && !builtinItemAt(input.path)) return { item: null, kind: null };
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
      return { id: recordActivity(event) };
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

  /** The values a query can name, with every field's names for an error. */
  const vocabulary = async (data: Awaited<ReturnType<typeof overview>>) => ({
    kinds: data.providers.flatMap((provider) => provider.kinds),
    projects: (await bb.sdk.projects.list().catch(() => [])).map((project) => ({ id: project.id, name: project.name })),
    tags: data.tags,
  });
  const unknownFilter = (filter: Filter, names: Awaited<ReturnType<typeof vocabulary>>) => {
    const known = {
      kind: names.kinds.map((kind) => kind.id),
      project: ["global", ...names.projects.map((project) => project.name)],
      tag: ["none", ...names.tags.map((tag) => tag.name)],
      is: ["archived", "template"],
    }[filter.field];
    return new Error(`No ${filter.field} called "${filter.value}". Try: ${known.join(", ") || "none yet"}.`);
  };

  /**
   * Lists items matching a query (src/query.ts). Without `all` or a project
   * filter, it's the thread's project's items and global ones; the Chief of
   * Staff sees every project.
   */
  const listItems = async (options: { projectId: string | null; threadId?: string; all: boolean; query?: string; kind?: string; tag?: string }) => {
    const data = await overview();
    const names = await vocabulary(data);
    const parsed: Query = parseQuery(options.query ?? "");
    for (const [field, value] of [["kind", options.kind], ["tag", options.tag]] as const) {
      if (value) parsed.filters.push({ field, value });
    }
    const compiled = compileQuery(parsed, names);
    if (compiled.unknown.length) throw unknownFilter(compiled.unknown[0]!, names);
    const named = parsed.filters.some((filter) => !filter.negate && filter.field === "project");
    const everything = named || options.all || (options.threadId !== undefined && (projectLeads.chiefThreadId() === options.threadId || !!bots.forThread(options.threadId)));
    const inScope = (item: HubItem) => everything || item.projectId === null || item.projectId === options.projectId;
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
    return { picked, labels, problems, tagNames };
  };

  const formatList = ({ picked, labels, problems, tagNames }: Awaited<ReturnType<typeof listItems>>) => {
    const lines = picked.slice(0, MAX_LISTED).map((item) => itemLine(item, labels.get(`${item.pluginId}:${item.kind}`) ?? item.kind, tagNames));
    if (picked.length > MAX_LISTED) lines.push(`…and ${picked.length - MAX_LISTED} more. Narrow the query.`);
    if (!lines.length) lines.push("No Studio items match.");
    if (problems.length) lines.push("", "Unavailable:", ...problems.map((problem) => `- ${problem}`));
    return lines.join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_items",
    description:
      "List the user's BB Studio items — pages, Talk recordings, drawings and anything else a Studio add-on provides — newest first. It lists this thread's project's items and global ones (the user's Bot, the personal project's lead, sees every project); a project: filter or allProjects lists beyond that. Each line has a link and the item's #tags, and a content match shows the text that matched; open or mention it to work with the item.",
    parameters: z.object({
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Words match titles and content. Filters: kind:<kind> project:<name|global> tag:<name|none> is:archived is:template; quote names with spaces, repeat a field for any of its values, prefix - to exclude. E.g. kind:page -tag:draft project:"Q4 launch" pricing'),
      kind: z.string().max(100).optional().describe("Only this kind, e.g. page, recording, drawing; same as kind: in the query"),
      allProjects: z.boolean().optional().describe("Include every project, not just this one"),
      tag: z.string().max(100).optional().describe("Only items with this tag; same as tag: in the query"),
    }),
    async execute({ query, kind, allProjects, tag }, ctx) {
      return formatList(await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId, all: allProjects === true, kind, query, tag }));
    },
  });

  // The Bot's tools (src/bot.ts), in every thread so the user can ask any agent about it.
  const describeBot = ({ bot, run }: Awaited<ReturnType<typeof bots.get>>) => bot
    ? `${bot.avatar} ${bot.name} is ${bot.state}. Thread: ${bot.threadId ? `/threads/${bot.threadId}` : "none"}. Check-ins: ${run?.enabled ? `${run.cadence}${run.cadence === "custom" ? ` (${run.cron})` : ` at ${run.time}`}` : "off"}.`
    : "The user has no Bot yet. They can make one in Studio → Bot.";
  const listThreads = (label: string, threads: { id: string; title: string; status: string }[]) => threads.length ? [`${label}:`, ...threads.map((thread) => `- [${thread.title}](/threads/${thread.id}) (${thread.status})`)] : [];
  // These act on the Bot the thread works for: its own thread (or handoff
  // chain), one of its runners, or a thread it started; elsewhere the primary.
  const acting = (threadId: string | undefined) => bots.actingFor(threadId, (id) => runners.forThread(id)?.bot_id);
  const selfBot = async (threadId: string | undefined) => (await acting(threadId))?.botId;
  // Pause and stop only from the Bot's own chat (botControlRefusal); no Bot resumes itself.
  bb.agents.registerTool({ name: "bot_get", description: "Show the user's Bot (their always-on agent, formerly the Chief of Staff): name, avatar, state (active, paused, stopped), its thread and check-ins. In a Bot's own thread, that Bot.", parameters: z.object({}), execute: async (_input, ctx) => describeBot(await bots.get(await selfBot(ctx.threadId))) });
  bb.agents.registerTool({
    name: "bot_set", description: "Rename the user's Bot, change its avatar emoji, or set its role (a sentence or two it's given). Only when the user asks. A Bot changing its own profile on its own uses bot_profile_update; from a Bot's threads either is recorded for the user to revert.",
    parameters: z.object({ name: z.string().trim().min(1).max(60).optional(), avatar: z.string().trim().min(1).max(16).optional().describe("One emoji"), role: z.string().trim().max(400).optional().describe("Its role in the user's words; empty clears it") }),
    execute: async (input, ctx) => {
      const self = await acting(ctx.threadId);
      if (self?.via === "runner") return "A runner can't change its Bot's profile; tell the user instead (runner_report).";
      // From a Bot's own threads it's the Bot's edit: recorded, for the user to see and revert.
      if (self) return describeBot((await bots.selfEdit(self.botId, input, { botId: self.botId, threadId: ctx.threadId ?? null })).view);
      return describeBot(await bots.set({ ...input, botId: undefined }));
    },
  });
  registerBotProfileTools(bb, { bots, acting, imageProvider: () => pickImageProvider({ settings: settingValues }) });
  // A Bot's image avatar, for the desktop and the iOS app. The URL names the image, so it never goes stale.
  bb.http.route("GET", AVATAR_ROUTE, (context) => {
    const image = bots.avatarImage(context.req.query("bot") ?? "", context.req.query("image") ?? "");
    if (!image) return context.text("Not found", 404);
    return serveBytes(new Uint8Array(image.data), { "content-type": image.mime, "content-security-policy": "default-src 'none'" });
  });
  bb.agents.registerTool({
    name: "bot_pause", description: "Pause the user's Bot: its check-ins stop and it takes on no new work until resumed. Only in the Bot's own chat, when the user asks; elsewhere the user uses Studio → Bot.", parameters: z.object({}),
    execute: async (_input, ctx) => { const self = await acting(ctx.threadId); return botControlRefusal(self, "pause") ?? describeBot(await bots.pause(self!.botId)); },
  });
  bb.agents.registerTool({
    name: "bot_resume", description: "Resume the user's paused or stopped Bot, its check-ins if they were on, and the automations and runners Stop paused. Only when the user asks; the Bot can't resume itself.", parameters: z.object({}),
    execute: async (_input, ctx) => (await acting(ctx.threadId)) ? "Only the user can resume their Bot: Studio → Bot → Resume." : describeBot(await bots.resume()),
  });
  bb.agents.registerTool({
    name: "bot_stop", description: "Stop the user's Bot: pause it, stop the running threads it spawned (its sub-threads, not forks of its chat) and pause automations that wake it and its runners. Data is kept. Only in the Bot's own chat, when the user explicitly asks to stop it; elsewhere the user uses Studio → Bot.", parameters: z.object({}),
    execute: async (_input, ctx) => { const self = await acting(ctx.threadId); const refused = botControlRefusal(self, "stop"); if (refused) return refused; const result = await bots.stop(self!.botId); return [describeBot(result), `Stopped ${result.stoppedThreadIds.length} thread(s); paused ${result.pausedAutomationIds.length} automation(s).`].join("\n"); },
  });
  bb.agents.registerTool({
    name: "bot_activity", description: "What the user's Bot is doing: threads that need the user, in progress, scheduled check-ins and automations, and recently completed threads it started.", parameters: z.object({}),
    execute: async (_input, ctx) => {
      const activity = await bots.activity(await selfBot(ctx.threadId));
      const lines = [
        ...listThreads("Needs you", activity.needsYou), ...listThreads("In progress", activity.inProgress),
        ...(activity.scheduled.length ? ["Scheduled:", ...activity.scheduled.map((each) => `- ${each.name}${each.enabled ? "" : " (off)"}${each.nextRunAt ? `, next ${new Date(each.nextRunAt).toISOString()}` : ""}`)] : []),
        ...listThreads("Completed", activity.completed),
      ];
      return lines.length ? lines.join("\n") : "Nothing to show yet.";
    },
  });

  // The Bot's own tools: given only to its thread and its skill review forks (agents.configure above).
  const ownBot = (threadId: string | undefined): string => {
    const review = learning.review(threadId);
    if (review) return review.bot_id;
    const bot = bots.forThread(threadId);
    if (!bot) throw new Error("Only the user's Bot has its own skills and history.");
    return bot.id;
  };
  /** The lint's advisory notes, after a tool's result line. */
  const withNotes = (line: string, skill: { name: string; body: string }, botId: string) => {
    const notes = lintSkill(skill, bots.skills(botId).filter((each) => each.state !== "archived").map((each) => each.name));
    return notes.length ? `${line}\nNotes (advisory, nothing was blocked):\n${notes.map((note) => `- ${note}`).join("\n")}` : line;
  };
  const saveSkill = (input: { name: string; description: string; body: string }, botId: string, threadId: string | undefined, verb: string) => {
    bots.writeSkill(input, botId);
    learning.noteWrite(threadId, "saved");
    return withNotes(`${verb === "patched" ? "Patched" : "Saved"} your skill ${input.name}.`, input, botId);
  };
  bb.agents.registerTool({
    name: "bot_skill_lint", description: "Inspect saved skill versions and optionally attach advisory quality or safety warnings to an exact version. Never blocks or rolls back a save.",
    parameters: z.object({ versionId: z.number().int().positive().optional(), warnings: z.array(z.string().min(1).max(2000)).max(20).optional() }),
    execute: ({ versionId, warnings }, ctx) => {
      const botId = ownBot(ctx.threadId);
      if (versionId && warnings) bots.lintSkillVersion(versionId, warnings, botId);
      return JSON.stringify(bots.skillHistory(botId).slice(0, 20));
    },
  });
  bb.agents.registerTool({
    name: "bot_skill_list", description: "List your own skills: name, one-line description, and whether it's stale or pinned. Archived skills are left out.", parameters: z.object({}),
    execute: (_input, ctx) => {
      const list = bots.skills(ownBot(ctx.threadId)).filter((skill) => skill.state !== "archived");
      return list.map((skill) => `- ${skill.name}${skill.pinned ? " (pinned)" : ""}${skill.state === "stale" ? " (stale)" : ""}: ${skill.description}`).join("\n") || "No skills yet.";
    },
  });
  bb.agents.registerTool({
    name: "bot_skill_view", description: "Load one of your own skills in full. Do it before you follow a skill: your instructions list only names and descriptions.", parameters: z.object({ name: z.string().min(1).max(64) }),
    execute: ({ name }, ctx) => {
      const botId = ownBot(ctx.threadId);
      const skill = bots.skill(name, botId);
      if (!skill || skill.state === "archived") return `No skill "${name}". Yours: ${bots.skills(botId).filter((each) => each.state !== "archived").map((each) => each.name).join(", ") || "none"}.`;
      // A review reading skills isn't the Bot using them.
      if (!learning.review(ctx.threadId)) bots.touchSkill(name, botId);
      return `# ${skill.name}\n${skill.description}\n\n${skill.body}`;
    },
  });
  bb.agents.registerTool({
    name: "bot_skill_write",
    description: "Create or rewrite one of your own skills (only you load them; the user can share one with every agent). Same name replaces it; for a small fix use bot_skill_patch. Write the rule a future run follows, not a log of today: when to use it, then the steps and pitfalls.",
    parameters: z.object({
      name: z.string().regex(SKILL_NAME).max(64).describe("lowercase-with-hyphens, named for the kind of task"),
      description: z.string().trim().min(1).max(500).describe("When to use it, in one sentence"),
      body: z.string().min(1).max(20_000).describe("Markdown instructions"),
    }),
    execute: (input, ctx) => { const botId = ownBot(ctx.threadId); return saveSkill(input, botId, ctx.threadId, bots.skill(input.name, botId) ? "rewritten" : "new"); },
  });
  bb.agents.registerTool({
    name: "bot_skill_patch",
    description: "Make a targeted edit to one of your own skills: replace exact text (copy it from bot_skill_view) with new text, and optionally its description. Use it to fix a wrong step in place or add a pitfall.",
    parameters: z.object({
      name: z.string().min(1).max(64),
      find: z.string().min(1).max(20_000).describe("Exact text now in the skill; it must occur once unless all is set"),
      replace: z.string().max(20_000).describe("What replaces it (empty removes it)"),
      all: z.boolean().optional().describe("Replace every occurrence"),
      description: z.string().trim().min(1).max(500).optional(),
    }),
    execute: ({ name, find, replace, all, description }, ctx) => {
      const botId = ownBot(ctx.threadId);
      const skill = bots.skill(name, botId);
      if (!skill) return `No skill "${name}". Make it with bot_skill_write.`;
      return saveSkill({ name, description: description ?? skill.description, body: patchText(skill.body, find, replace, all) }, botId, ctx.threadId, "patched");
    },
  });
  bb.agents.registerTool({
    name: "bot_skill_delete", description: "Delete one of your own skills.", parameters: z.object({ name: z.string().min(1).max(64) }),
    execute: ({ name }, ctx) => {
      const botId = ownBot(ctx.threadId);
      const skill = bots.skill(name, botId);
      if (!skill) return `No skill "${name}".`;
      if (learning.review(ctx.threadId) && skill.pinned) return `${name} is pinned by the user; leave it.`;
      bots.deleteSkill(name, botId);
      learning.noteWrite(ctx.threadId, "saved");
      return `Deleted ${name}.`;
    },
  });
  // The Bot's runners: its tools (its thread only) and the runner's one report tool.
  const scheduleParam = z.object({
    cadence: z.enum(["every5minutes", "every15minutes", "every30minutes", "hourly", "every2hours", "every6hours", "daily", "weekdays", "weekly", "custom"]),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM local; the minute for hourly cadences. Default 09:00"),
    cron: z.string().max(100).optional().describe("Five-field cron, only with cadence custom"),
  });
  const describeRunner = (runner: Awaited<ReturnType<typeof runners.list>>[number]) =>
    `- ${runner.name} (${runner.id}, ${runner.state}${runner.adopted ? ", adopted" : ""}): ${runner.schedule.cadence}${runner.schedule.cadence === "custom" ? ` ${runner.schedule.cron}` : ` at ${runner.schedule.time}`}${runner.nextRunAt ? `, next ${new Date(runner.nextRunAt).toLocaleString()}` : ""}. Job: ${runner.job}${runner.lastReport ? `\n  Last report (${runner.lastLevel}): ${runner.lastReport}` : ""}${runner.threadId ? `\n  Thread: /threads/${runner.threadId}` : ""}`;
  const runnerTool = (name: string, description: string, parameters: z.ZodObject, execute: (input: never, botId: string) => Promise<string>) =>
    bb.agents.registerTool({ name, description, parameters, execute: async (input, ctx) => execute(input as never, ownBot(ctx.threadId)) });
  runnerTool("runner_create", "Make a runner: a long-lived thread that does a recurring job on its own schedule and stays quiet unless it has something to report (it tells you or the user through runner_report). Use it when a task becomes recurring, so your chat stays for the user. Its first run starts now.",
    z.object({ name: z.string().trim().min(1).max(60), job: z.string().trim().min(1).max(2000).describe("A short instruction: what to check or do each run, and what counts as worth reporting"), schedule: scheduleParam }),
    async (input: { name: string; job: string; schedule: z.infer<typeof scheduleParam> }, botId) => `Made the runner:\n${describeRunner(await runners.create({ ...input, schedule: parseSchedule(input.schedule) }, botId))}`);
  runnerTool("runner_update", "Change a runner's name, job or schedule.",
    z.object({ id: z.string().min(1).describe("Runner id or name"), name: z.string().trim().min(1).max(60).optional(), job: z.string().trim().min(1).max(2000).optional(), schedule: scheduleParam.optional() }),
    async (input: { id: string; name?: string; job?: string; schedule?: z.infer<typeof scheduleParam> }, botId) => describeRunner(await runners.update({ ...input, schedule: input.schedule ? parseSchedule(input.schedule) : undefined }, botId)));
  runnerTool("runner_pause", "Pause a runner: its schedule stops until resumed.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeRunner(await runners.setState(id, "paused", botId)));
  runnerTool("runner_resume", "Resume a paused runner.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeRunner(await runners.setState(id, "active", botId)));
  runnerTool("runner_run_now", "Run a runner now, outside its schedule.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeRunner(await runners.runNow(id, botId)));
  runnerTool("runner_delete", "Delete a runner you made: its schedule is deleted and its thread archived. An adopted runner is only let go (its thread and automation stay). Only when the user asks or the job is over.",
    z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => (await runners.delete(id, botId)).kept ? "Let go of the adopted runner; its thread and automation stay." : "Deleted the runner; its thread is archived.");
  runnerTool("runner_list", "List your runners: schedule, state, next run and last report.", z.object({}), async (_input: unknown, botId) => (await runners.list(botId)).map(describeRunner).join("\n") || "No runners yet.");
  // The Bot's automations: check-ins, reminders, watchers and runners in one list (src/automations.ts).
  const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  const toolSchedule = z.object({
    times: z.array(hhmm).max(24).optional().describe("HH:MM run times, e.g. [\"08:00\",\"18:00\"]"),
    every: z.string().regex(/^\d+\s*(m|min|minutes?|h|hours?)$/).optional().describe("Instead of times: an interval, e.g. 15m or 2h"),
    from: hhmm.optional().describe("With every: active window start"), to: hhmm.optional().describe("With every: window end"),
    days: z.array(z.number().int().min(0).max(6)).optional().describe("0=Sun..6=Sat; default every day"),
    quiet: z.object({ from: hhmm, to: hhmm }).optional().describe("Skip runs in these hours, e.g. 22:00-07:00"),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last day, YYYY-MM-DD"),
    cron: z.string().max(100).optional().describe("Raw five-field cron instead"),
    timezone: z.string().max(100).optional(),
    at: z.string().max(60).optional().describe("Reminders: ISO date-time"), in: z.string().max(20).optional().describe("Reminders: delay like 30m, 2h, 1d"),
  });
  const toSchedule = (input: z.infer<typeof toolSchedule>): Schedule => {
    if (input.at || input.in) {
      const at = input.at ? Date.parse(input.at) : Date.now() + parseDuration(input.in!);
      if (!Number.isFinite(at)) throw new Error(`"${input.at}" isn't a date-time.`);
      return { type: "once", at };
    }
    const common = { ...(input.timezone ? { timezone: input.timezone } : {}), ...(input.quiet ? { quiet: input.quiet } : {}), ...(input.until ? { until: input.until } : {}) };
    const days = (input.days ?? [0, 1, 2, 3, 4, 5, 6]) as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
    if (input.cron) return { type: "cron", cron: input.cron, ...common };
    if (input.every) {
      const [, n, unit] = /^(\d+)\s*(\w+)$/.exec(input.every)!;
      return { type: "interval", every: Number(n), unit: unit!.startsWith("h") ? "hours" : "minutes", days, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}), ...common };
    }
    if (!input.times?.length) throw new Error("Give times, every, cron, at or in.");
    return { type: "times", days, times: input.times, ...common };
  };
  const describeAutomation = (each: Awaited<ReturnType<typeof automations.list>>[number]) =>
    `- ${each.name} (${each.kind}, ${each.id}, ${each.state}): ${each.scheduleText}${each.nextRunAt ? `, next ${new Date(each.nextRunAt).toLocaleString()}` : ""}${each.kind === "watcher" ? ` → wakes ${each.targetName}` : ""}. ${each.kind === "watcher" ? `Script (${each.script?.interpreter})` : each.instruction}${each.model?.model ? ` [${each.model.model}${each.model.reasoning ? `/${each.model.reasoning}` : ""}]` : ""}${each.lastOutcome ? `\n  Last: ${each.lastOutcome}` : ""}`;
  const automationFields = {
    instruction: z.string().trim().max(2000).optional().describe("Check-in/reminder: what to do when it fires. Runner: its job. Watcher: what to do with the script's output"),
    schedule: toolSchedule.optional(),
    model: z.string().max(200).optional().describe("Check-in/reminder: a cheaper model on your provider for routine runs"),
    reasoning: z.string().max(40).optional(),
    script: z.string().max(262_144).optional().describe("Watcher: the script. Exit 0 and print the finding to stdout to wake you; print nothing when nothing changed"),
    interpreter: z.enum(["bash", "sh", "node", "python3"]).optional(),
    target: z.string().max(200).optional().describe("Watcher: \"main\" (you, default) or a runner id/name to wake"),
  };
  type AutomationToolInput = { name?: string; instruction?: string; schedule?: z.infer<typeof toolSchedule>; model?: string; reasoning?: string; script?: string; interpreter?: "bash" | "sh" | "node" | "python3"; target?: string };
  const automationChanges = (input: AutomationToolInput) => ({
    ...(input.name ? { name: input.name } : {}), ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
    ...(input.schedule ? { schedule: toSchedule(input.schedule) } : {}),
    ...(input.model || input.reasoning ? { model: { model: input.model ?? null, reasoning: input.reasoning ?? null } } : {}),
    ...(input.script ? { script: { body: input.script, interpreter: input.interpreter ?? "bash" } } : {}),
    ...(input.target ? { target: input.target } : {}),
  });
  runnerTool("automation_list", "List your automations: check-ins, reminders, watchers and runners, with schedule, state, next run and last outcome.", z.object({}),
    async (_input: unknown, botId) => (await automations.list(botId)).map(describeAutomation).join("\n") || "No automations yet.");
  runnerTool("automation_create", "Schedule something for yourself. kind checkin: wakes your thread on a schedule with an instruction. reminder: once, with schedule.at or schedule.in (\"tomorrow 9:00 remind me…\", \"in 2h check the deploy\"). watcher: a script on a schedule that wakes you only when it prints something (zero tokens otherwise). runner: a recurring job in its own thread.",
    z.object({ kind: z.enum(["checkin", "reminder", "watcher", "runner"]), name: z.string().trim().min(1).max(60), ...automationFields, schedule: toolSchedule }),
    async (input: AutomationToolInput & { kind: "checkin" | "reminder" | "watcher" | "runner"; name: string }, botId) => `Made:\n${describeAutomation(await automations.create({ kind: input.kind, name: input.name, schedule: toSchedule(input.schedule!), ...automationChanges(input) } as never, botId))}`);
  runnerTool("automation_update", "Change an automation's name, instruction, schedule, model or script.",
    z.object({ id: z.string().min(1).describe("Automation id or name"), name: z.string().trim().min(1).max(60).optional(), ...automationFields }),
    async (input: AutomationToolInput & { id: string }, botId) => describeAutomation(await automations.update({ id: input.id, ...automationChanges(input) } as never, botId)));
  runnerTool("automation_pause", "Pause an automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "paused", botId)));
  runnerTool("automation_resume", "Resume a paused automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "active", botId)));
  runnerTool("automation_run_now", "Run an automation now, outside its schedule.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.runNow(id, botId)));
  runnerTool("automation_delete", "Delete an automation. Only when the user asks or it's no longer needed.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => { await automations.delete(id, botId); return "Deleted."; });
  bb.agents.registerTool({
    name: "runner_report",
    description: "Report from this run. log: kept in this thread and the Bot's Activity. tell: one short line to the user in the Bot's chat. urgent: tell plus Needs you and a phone push, only when the user must act now. With nothing new, don't call it and finish without a final message.",
    parameters: z.object({ level: z.enum(["log", "tell", "urgent"]), summary: z.string().trim().min(1).max(600).describe("One or two short sentences") }),
    execute: async (input, ctx) => {
      if (!ctx.threadId || !runners.forThread(ctx.threadId)) throw new Error("Only a runner's thread can report.");
      return runners.report(ctx.threadId, input);
    },
  });
  bb.agents.registerTool({
    name: "bot_history_search", description: "Search your own past threads (your earlier threads and the threads you started) for words.",
    parameters: z.object({ query: z.string().trim().min(1).max(200) }),
    execute: async ({ query }, ctx) => {
      const hits = await bots.historySearch(query, 10, ownBot(ctx.threadId));
      return hits.length ? hits.map((hit) => `- [${hit.title}](/threads/${hit.threadId}): ${hit.text.replace(/\s+/g, " ")}`).join("\n") : "No matches in your threads.";
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
      "Group the user's BB Studio items with tags. Tags work across pages, recordings, drawings, artifacts and other items; new tag names are created. Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
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
      "Permanently delete the user's BB Studio items — pages (with their sub-pages), recordings, drawings, artifacts and other add-on items. Pass items as the links studio_list_items shows. Deletion can't be undone, so delete only what the user asked to remove.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
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

  const sendToWorkspace = (command: WorkspaceCommand) => bb.realtime.publish(WORKSPACE_CHANNEL, command);
  /** How long a window gets to report a command's result. */
  const CONFIRM_MS = 3000;
  bb.agents.registerTool({
    name: "studio_workspace",
    description:
      "See what the user has open in BB Studio's workspace, the tabbed view of their pages, recordings, drawings and other items: each pane's tabs, which tab is in front, and whether they're looking at it. Use it when the user says \"this\", \"what I'm looking at\" or \"my tabs\". Open or close tabs with studio_open_items and studio_close_tabs.",
    parameters: z.object({}),
    async execute() {
      return formatWorkspace(workspace.current(), Date.now());
    },
  });

  bb.agents.registerTool({
    name: "studio_open_items",
    description:
      "Open BB Studio items as tabs in the user's Studio workspace, in the BB window they're using, and show it to them. Pass items as the links studio_list_items shows. Open beside what they're looking at with placement right or down. Only open what the user asked to see, or what you made for them to look at.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(20).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
      placement: z.enum(["tab", "right", "down"]).optional().describe("tab (default) adds tabs to the focused pane; right or down splits it and opens them there"),
      show: z.boolean().optional().describe("Bring the workspace on screen (default true); false only adds the tabs"),
    }),
    async execute({ items: refs, placement = "tab", show = true }) {
      const current = workspace.current();
      if (!current) return "No BB window has Studio's workspace, so nothing was opened. The user may not have BB open.";
      const { found, missing } = await resolveItems(refs);
      const { items } = await hub.overview();
      const matched = found.flatMap((ref) => items.filter((item) => item.pluginId === ref.pluginId && item.id === ref.id));
      const opened = matched.map((item) => ({ href: item.href, title: untitled(item.title) }));
      // The sidebar's Studio list shows them too, as it does items the user opens.
      if (matched.map((item) => tabs.open(item)).some(Boolean)) tabsChanged();
      const lines: string[] = [];
      if (opened.length) {
        const confirmed = await workspace.deliver(
          (client) => sendToWorkspace({ client, action: "open", items: opened, placement: placement === "down" ? "bottom" : placement, show }),
          (report) => opened.every((item) => openHrefs(report).has(item.href)),
          CONFIRM_MS,
        );
        lines.push(confirmed
          ? `Opened ${opened.map((item) => item.title).join(", ")} in the user's Studio workspace${placement === "tab" ? "" : `, split ${placement}`}.`
          : `Sent ${opened.map((item) => item.title).join(", ")} to the user's BB windows, but none confirmed; BB may be closed. Don't assume they're open.`);
      }
      if (missing.length) lines.push(`Not found: ${missing.join(", ")}`);
      return lines.join("\n") || "Nothing to open.";
    },
  });

  bb.agents.registerTool({
    name: "studio_close_tabs",
    description:
      "Close tabs in the user's Studio workspace. Closing a tab keeps the item. Pass the links studio_workspace shows. Close only tabs the user asked to close, or ones you opened for them.",
    parameters: z.object({
      items: z.array(z.string().max(2000)).min(1).max(100).describe("Tab links, e.g. /plugins/studio/studio/pages/pg_x"),
    }),
    async execute({ items: hrefs }) {
      const current = workspace.current();
      if (!current) return "No BB window has Studio's workspace open.";
      // The last report can lag a tab just opened, so every one is sent.
      const closing = [...new Set(hrefs.map((href) => href.trim()))];
      const before = new Map(workspace.candidates().map((report) => [report.client, openHrefs(report)]));
      const confirmed = await workspace.deliver(
        (client) => sendToWorkspace({ client, action: "close", hrefs: closing }),
        (report) => closing.every((href) => !openHrefs(report).has(href)),
        CONFIRM_MS,
      );
      if (!confirmed) return "Sent the close to the user's BB windows, but none confirmed; BB may be closed.";
      const wasOpen = before.get(confirmed) ?? new Set<string>();
      const closed = closing.filter((href) => wasOpen.has(href));
      return closed.length === closing.length ? `Closed ${closed.length} tab${closed.length === 1 ? "" : "s"}.` : `Closed what was open. Not open: ${closing.filter((href) => !wasOpen.has(href)).join(", ")}`;
    },
  });

  bb.agents.registerTool({
    name: "studio_move_items",
    description:
      "Move the user's BB Studio items to another BB project, or to Global (no project). Pass items as the links studio_list_items shows.",
    parameters: z.object({
      items: z.array(z.string().max(500)).min(1).max(100).describe("Item links, e.g. /plugins/studio/studio/pages/pg_x"),
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
  bb.onDispose(() => { clearInterval(healthTimer); clearInterval(automationTimer); health.dispose(); });
  // BB Studio setup: add-ons, retired plugins and what to run; see src/setup.ts.
  const setup = new SetupService({
    sdk: bb.sdk,
    health: (maxAgeMs) => (maxAgeMs ? health.summary(maxAgeMs) : health.check()),
    // Setup's Retired plugins: Studio Reactions can go once its settings are copied.
    settingsCopied: async (pluginId) => {
      if (pluginId !== REACTIONS_PLUGIN_ID) return true;
      await importReactionsSettings(reactionsImport).catch(() => null);
      return Boolean(await bb.storage.kv.get(REACTIONS_SETTINGS_IMPORTED));
    },
  });
  bb.rpc.register(setupContract, {
    "setup.summary": ({ maxAgeMs }) => setup.summary(maxAgeMs),
    "setup.install": ({ pluginIds }) => setup.install(pluginIds),
    "setup.enable": ({ pluginId }) => setup.enable(pluginId),
    "setup.remove": ({ pluginId }) => setup.remove(pluginId),
  });

  // Setup → Kinds (src/kinds.ts). Turning a kind off or on, or choosing its
  // provider, applies to Studio's lists, search and New menus at once, to
  // agents from their next session, and to thread tabs, composer entries and
  // reply cards after a window reload.
  const kindsState = async (): Promise<KindsState> => {
    const routes = await refreshRoutes();
    const settings = kindSettings.current;
    return {
      kinds: BUILTIN_KINDS.map((each) => {
        const route = routes.find((entry) => entry.kind === each.kind)!;
        return { kind: each.kind, label: each.label, covers: each.covers, on: !settings.off.includes(each.kind), choice: route.choice, active: route.active, reason: route.reason, alternatives: route.alternatives };
      }),
      frontend: frontendState(routes, settings),
    };
  };
  bb.rpc.register(kindsContract, {
    "kinds.state": () => kindsState(),
    "kinds.update": async ({ kind, on, use }) => {
      const before = builtinOn(kindSettings.current, BUILTIN_KINDS.find((each) => each.kind === kind)?.pluginId ?? "");
      await kindSettings.update(kind, { on, use });
      const pluginId = BUILTIN_KINDS.find((each) => each.kind === kind)!.pluginId;
      bb.log.info(`Studio kind ${kind}: ${kindSettings.current.off.includes(kind) ? "off" : "on"}, open and create with ${kindSettings.current.use[kind] ?? "automatic"}.`);
      // Search drops an off kind's hits and indexes it again when it's back on.
      if (before !== builtinOn(kindSettings.current, pluginId)) void searchIndex.changed(pluginId).catch(() => {});
      changes.append(null);
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId });
      return kindsState();
    },
  });

  // Backup and restore of every Studio item (src/backup/, docs/backup.md).
  const threadExists = (threadId: string) => bb.sdk.threads.get({ threadId }).then((thread) => thread.deletedAt == null);
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
    builtins: {
      pages: { name: "Studio Pages", handlers: pages.backup },
      artifacts: { name: "Studio Artifacts", handlers: artifacts.backup },
      excalidraw: { name: "Studio Draw", handlers: drawings.backup },
      design: { name: "Studio Design", handlers: designs.backup },
      talk: { name: "Studio Talk", handlers: recordings.backup },
      dashboards: { name: "Studio Dashboards", handlers: dashboards.backup },
    },
  });
  registerBackup(bb, backups, join(bb.server.experimental_dataDir, "plugins", STUDIO_PLUGIN_ID));
  /** A CLI path, relative to where the command ran. */
  const cliPath = (path: string, cwd: string | undefined) => (isAbsolute(path) ? path : resolvePath(cwd ?? homedir(), path));

  bb.cli.register({
    name: "studio",
    summary: "BB Studio: pages, recordings, drawings, designs, artifacts and other add-ons' items",
    commands: [
      { name: "decisions", summary: "Jev, fallback model and Smart Queue", usage: "bb studio decisions <status|recent|classify|check|fallback>" },
      { name: "list", summary: "List items in the current project and global ones", usage: "bb studio list [query…] [--all] [--json], e.g. bb studio list kind:page -tag:draft pricing" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "move", summary: "Move items to a project", usage: "bb studio move <item-link|plugin:id>… --project <name|id|global>" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "health", summary: "Check every plugin for setup problems and failures", usage: "bb studio health [--json]" },
      { name: "setup", summary: "Show which BB Studio add-ons are installed and working, and the commands to finish setup", usage: "bb studio setup [--json]" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
      { name: "backup", summary: "Save every Studio item, from every add-on, into one .zip file", usage: "bb studio backup [--out <file|folder>]" },
      { name: "restore", summary: "Restore a Studio backup; shows what would change first", usage: "bb studio restore <file> [--dry-run | --yes]" },
      { name: "artifacts", summary: "Save and read artifacts: save, list, show, export, delete", usage: "bb studio artifacts <save|list|show|export|delete> …" },
      { name: "drawings", summary: "Create, read and edit Excalidraw drawings", usage: "bb studio drawings <list|create|show|rename|delete|merge|remove-elements> …" },
      { name: "designs", summary: "List and read designs: list, show, html, rename, delete", usage: "bb studio designs <list|show|html|rename|delete> …" },
      { name: "recordings", summary: "Read Talk recordings and their transcripts: list, show, transcript, notes", usage: "bb studio recordings <list|show|transcript|notes> …" },
      { name: "pages", summary: "Read and write pages: list, show, create, append; explore stats for the Next row", usage: "bb studio pages <list|show|create|append|explore> …" },
      { name: "dashboards", summary: "List and read dashboards, and push data to their widgets", usage: "bb studio dashboards <list|show|set-data> …" },
      { name: "speech", summary: "Text to speech: show the engine, list its models, speak text to a file, run local voices", usage: "bb studio speech <status|models|say|local> …" },
    ],
    async run(argv, ctx) {
      // Built-in kinds' commands (`bb artifacts …` before the merge).
      if (argv[0] === "decisions") return decisions.cli(argv.slice(1));
      if (argv[0] === "artifacts") return artifacts.cli(argv.slice(1), ctx);
      if (argv[0] === "drawings") return drawings.cli(argv.slice(1), ctx);
      if (argv[0] === "designs") return designs.cli(argv.slice(1), ctx);
      if (argv[0] === "dashboards") return dashboards.cli(argv.slice(1));
      if (argv[0] === "recordings") return recordings.cli(argv.slice(1));
      if (argv[0] === "speech") return speech.cli(argv.slice(1), ctx);
      if (argv[0] === "pages") return argv[1] === "explore" ? explore.cli(argv.slice(2), ctx) : pages.cli(argv.slice(1), ctx);
      const { command, rest: raw } = subcommand(argv);
      const USAGE: Record<string, string> = {
        list: "bb studio list [query…] [--all] [--json] [--kind <kind>] [--tag <tag>] [--query <text>]",
        move: "bb studio move <item-link|plugin:id>… --project <name|id|global>",
        backup: "bb studio backup [--out <file|folder>]",
        restore: "bb studio restore <file> [--dry-run | --yes]",
      };
      const SPECS: Record<string, CliSpec> = {
        list: { flags: ["--json", "--all"], options: ["--kind", "--tag", "--query"] },
        health: { flags: ["--json"] },
        setup: { flags: ["--json"] },
        move: { options: ["--project"] },
        backup: { options: ["--out"] },
        restore: { flags: ["--dry-run", "--yes"] },
      };
      const parsed = parseCliArgs(raw, SPECS[command ?? ""] ?? {});
      const known = ["list", "tags", "move", "providers", "health", "setup", "reindex", "backup", "restore"].includes(command ?? "");
      if (!parsed.ok && known) return usage(`${USAGE[command!] ?? `bb studio ${command}`}\n${parsed.error}`);
      const rest = parsed.ok ? parsed.positional : [];
      const flag = (name: string) => parsed.ok && parsed.flags.has(name);
      const option = (name: string) => (parsed.ok ? parsed.options.get(name) : undefined);
      try {
        switch (command) {
          case "list": {
            const json = flag("--json");
            const options = { all: flag("--all"), kind: option("--kind"), tag: option("--tag"), query: option("--query") };
            const query = [options.query, ...rest.map(queryArg)].filter(Boolean).join(" ");
            const result = await listItems({ projectId: ctx.projectId ?? null, threadId: ctx.threadId ?? undefined, ...options, query });
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(result.picked.slice(0, MAX_LISTED), null, 2)}\n` };
            return { exitCode: 0, stdout: `${formatList(result)}\n` };
          }
          case "tags": {
            const { items, tags: allTags } = await overview();
            if (!allTags.length) return { exitCode: 0, stdout: "No tags yet.\n" };
            const lines = allTags.map((tag) => `#${tag.name}\t${items.filter((item) => item.tags.includes(tag.id)).length}`);
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "move": {
            const project = option("--project");
            if (!rest.length || !project) return usage(USAGE.move!);
            const projectId = await resolveProject(project);
            const lines = await moveItemsReport(rest, { projectId }, projectId ? `Project ${project}` : "Global");
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          case "providers": {
            const providers = await hub.providers();
            if (!providers.length) return { exitCode: 0, stdout: "No Studio kinds are ready. Reload Studio: bb plugin reload studio\n" };
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
          default:
            return usage("bb studio <list|tags|move|providers|health|setup|reindex|backup|restore|pages|artifacts|drawings|designs|recordings|dashboards|speech|decisions> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}
