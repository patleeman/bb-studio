import { registerWorkCards, WORK_TOOLS } from "./src/work/register";
import { CONTINUE_TOOL, registerContinueNew } from "./src/continue-new";
import { runWorkCli } from "./src/work/cli";
import { registerLoops, LOOP_TOOLS, loopPushActions } from './src/loops/register';
import { reminderLoopId, scheduledContract, scheduledItems } from "./src/loops/scheduled";
import { automationTable, bbFromFile, bbFromOverview, readImportedAt, readStudioEntries, readThreadOwners } from "./src/automation-table";
import { arrangeRailOnce } from "./src/rail-arrangement";
import { arrangeFooterOnce } from "./src/footer-arrangement";
import { retireLegacyThemeOnce } from "./src/theme/legacy-theme";
import { RunnerPreflightError } from "./src/runner-machines";
import { indexItem } from "./src/kit/server/studio-index";
import { CODE_TOOLS, registerCode } from "./src/code/server";
import { registerWorkbenchAgent, WORKBENCH_TOOLS } from "./src/workbench-agent/server";
import { cutOffByHost, listenForHostEvents } from "./src/kit/host-events";
import { registerThreadExportHook } from "./src/thread-export-hook";
import { createSkillsRegistryGate } from "./src/skills-registry";
import { skillsRegistryContract } from "./src/skills-registry-contract";
import { hostApproval } from "./src/kit/host-approval";
import { registerQuietTurnClassifier } from "./src/kit/quiet-turns";
import { registerDecisions } from "./src/decisions/server";
import { BotMaintenance } from "./src/bot-maintenance";
import { registerChat } from "./src/chat/server";
import { ARTIFACT_TOOLS, registerArtifacts } from "./src/artifacts/server";
import { DRAW_TOOLS, moveOrphanDrawings, registerDraw } from "./src/draw/server";
import { DESIGN_TOOLS, registerDesign } from "./src/design/server";
import { registerDashboards } from "./src/dashboards/server";
import { MINI_TOOLS, registerMinis } from "./src/minis/server";
import { displayTitle as artifactTitle, versionType as artifactVersionType } from "./src/artifacts/server/store";
import { registerTalk, TALK_TOOLS, type TalkSettingsHandle } from "./src/talk/server";
import { PAGE_TOOLS, registerPages } from "./src/pages/server";
import { registerExploreBuiltin } from "./src/explore/server";
import { importReactionsSettings, REACTIONS_PLUGIN_ID, REACTIONS_SETTINGS_IMPORTED } from "./src/reactions/server";
import { BUILTIN_PLUGIN_IDS, builtinItemAt } from "./src/builtins";
import { builtinProviderContract } from "./src/builtin-provider";
import { BUILTIN_KINDS, builtinOn, frontendState, kindRowViews, KindSettingsStore, resolveKinds, routeProviders, routingInstructions, rowKinds, type KindRoute } from "./src/kinds";
import { kindsContract, type KindsState } from "./src/kinds-contract";
import { openaiKey } from "./src/openai-key";
import { registerSettings } from "./src/settings/register";
import { loopTimeZone } from "./src/settings/constants";
import { settingsCli, SETTINGS_USAGE } from "./src/settings/cli";
import { STUDIO_SETTINGS } from "./src/settings/schema";
import { VoiceLive } from "./src/voice/live/live";
import { registerVoiceLive } from "./src/voice/live/register";
import { registerWindowRelay } from "./src/windows/server";
import { gatherSeed, type SeedMessage } from "./src/voice/live/identity";
import { resolveTarget } from "./src/voice/live/targets";
import { VOICE_LIVE_CHANNEL } from "./src/voice/live/shared";
import { CANVAS_PLUGIN_ID, canvasVoiceOutput, canvasVoiceRunOutput, isCanvasThreadOrigin } from "./src/voice/live/canvas-plugin";
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
// - The query language (src/query.ts) drives the Library, the agent tool and CLI.
// - Studio keeps the sidebar's tabs, one per opened item (src/tabs.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { STUDIO_PLUGIN_ID, STUDIO_PROVIDER_CALL_METHOD, STUDIO_REALTIME_CHANNEL } from "./src/kit/contract";
import { relativeTime, untitled } from "./src/kit/format";
import { z } from "zod";
import { rpcContract, schemas, TABS_CHANNEL, type SidebarView, type StarredItemView, type ThreadOptionView, type TabView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { externalProviders } from "./src/external-bots";
import { EXTERNAL_AGENTS_PLUGIN_ID } from "./src/bot";
import { ChangeLog, recordProviderChanges } from "./src/changes";
import { isPanelVisible, withPanelsVisible } from "./src/sidebar";
import { TriggerEngine } from "./src/triggers/engine";
import { EngineScheduler, scheduleKey } from "./src/triggers/scheduler";
import { moveToScheduler } from "./src/triggers/migrate";
import { MIGRATIONS } from "./src/migrations";
import { ItemIndex } from "./src/item-index";
import { familyAndType, ITEM_FAMILIES, ITEM_TYPES, itemType, kindsNamed, typeOfId, type ItemType } from "./src/item-model";
import { APP_TOOLS, appTools, familyTool, ToolBook, type AgentTool } from "./src/family-tools";
import { registerBotProfileTools } from "./src/bot-profile-tools";
import { MemoryStore } from "./src/memory/store";
import { MemoryService, setBotMemoryPage, withMemory } from "./src/memory/service";
import { registerMemory } from "./src/memory/register";
import { BotPageState, registerGroupTool } from "./src/bot-page-state";
import { BotCacheWarmer } from "./src/bot-cache";
import { botControlRefusal, Bots, SKILL_NAME } from "./src/bot";
import { ThemeStore } from "./src/theme/store";
import { forestContract } from "./src/theme/forest/contract";
import { ForestWeather } from "./src/theme/forest/weather";
import { builtinOptionStores, readThemeOptions, themeOptionsContract, writeThemeOption } from "./src/theme/options-contract";
import { readPreview, readView, tonightContract, writePreview, writeView } from "./src/theme/tonight/contract";
import { ThemeService } from "./src/theme/service";
import { ThemeGpuRouter } from "./src/theme/gpu-server";
import { THEME_GPU_CHANNEL } from "./src/theme/gpu";
import { THEME_TOOLS, themeTools } from "./src/theme/agent-tools";
import { runThemeCli } from "./src/theme/cli";
import { PresenceStore } from "./src/presence/store";
import { PresenceService } from "./src/presence/service";
import { PRESENCE_CHECK_CHANNEL, PresenceCheckRouter } from "./src/presence/check-router";
import { PRESENCE_TOOLS, presenceTools } from "./src/presence/agent-tools";
import { runPresenceCli } from "./src/presence/cli";
import { presenceAskText } from "./src/presence/contract";
import { SideThreads } from "./src/bot-side-threads";
import { alertBot, parseSchedule, Runners } from "./src/runners";
import { nudgeReason, BotNudges, type NudgeOwner } from "./src/bot-nudge";
import { workerApprovalRpc } from "./src/worker-approvals";

/** The note on a "stopped after failing" line in a Bot's chat: the Bot triages it (docs/needs-you/REDO.md). */
const STOPPED_NOTE = "Studio notice: something you own stopped after failing. You decide what the user sees: if you can fix it (resume it, retry it), do. If the user must act, tell them in one or two short lines what stopped and what to do. If it needs nothing from them, reply exactly [PASS].";
import { AutoResume, type ResumeTarget } from "./src/auto-resume";
import { ThreadResume, type ThreadOwner } from "./src/thread-resume";
import { BotOwnedThreads } from "./src/bot-owned";
import { registerBotThreads } from "./src/bot-threads-server";
import { BotSignal, type BotChange } from "./src/bot-signal";
import { BOT_THREADS_CHANNEL } from "./src/bot-threads-contract";
import { readMirroredSince, readMirrorLive } from "./src/mirror-live";
import { registerLiveActivity } from "./src/live-activity";
import { ThreadSeeds } from "./src/thread-seeds";
import { registerBotFinish } from "./src/bot-finish";
import { studioInstructions } from "./src/agent-instructions";
import { activityOf, conversationInstructions } from "./src/bot-threads";
import { newTabRecents, newTabSearch, VISUAL_CHAT_PLUGIN_ID, type EntryRow, type NewTabSearchSources, type NewTabSources } from "./src/newtab";
import { automationRefId, parseAutomationRefId } from "./src/automation-table-contract";
import { ITEM_KINDS, type TabKindId } from "./src/tab-kinds";
import { Automations } from "./src/automations";
import { lintSkill, patchText, REVIEW_TOOLS, SkillLearning } from "./src/skill-learning";
import { parseDuration, type Schedule } from "./src/schedule";
import { itemAtPath, TabStore } from "./src/tabs";
import { formatWorkspace, openHrefs, WorkspacePresence, type WorkspaceCommand } from "./src/workspace-presence";
import { WORKSPACE_CHANNEL } from "./src/ids";
import { TagStore, type ItemRef, type Tag } from "./src/tags";
import { StarStore } from "./src/stars";
import { planMove } from "./src/move-items";
import { backgroundKinds, compileQuery, parseQuery, type Filter, type Query } from "./src/query";
import { ThreadTitles } from "./src/thread-titles";
import { withTagHint } from "./src/create-tag-hint";
import { excerpt, SearchIndex, tokens, type SearchHit } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
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
import { registerAuth } from "./src/auth/register";
import { AUTH_USAGE, authCli } from "./src/auth/cli";
import { createLiveBbPool, registerAccounts } from "./src/accounts/register";
import { registerOnboarding } from "./src/onboarding-register";
import { ACCOUNTS_USAGE, accountsCli } from "./src/accounts/cli";
import { formatSetup, SetupService } from "./src/setup";
import { setupContract } from "./src/setup-contract";
import { BackupService, formatBackup, formatRestore, restoreFailed } from "./src/backup/service";
import { studioDataBackup } from "./src/backup/studio-data";
import { backupFileName, registerBackup } from "./src/backup/register";
import { readFile as readTextFile, stat as statPath } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { registerDesktopToolsIfEnabled } from "./src/desktop/server";

/** How often Studio re-checks plugin health on its own. */
const HEALTH_INTERVAL_MS = 3 * 60_000;

export default async function plugin(bb: BbPluginApi) {
  registerQuietTurnClassifier(bb);
  await registerChat(bb);
  const changes = new ChangeLog();
  // Built-ins can publish while registration awaits settings. Flush once the hub is ready.
  let servicesReady!: () => void;
  const ready = new Promise<void>((resolve) => { servicesReady = resolve; });
  const notifyBuiltin = async (pluginId: string, ids?: string[]) => {
    await ready;
    try { await studioChanged({ pluginId, ids }); }
    catch (error) { bb.log.warn(`Studio changes for ${pluginId} could not be recorded; retrying: ${errorText(error)}`); throw error; }
  };
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const themes = new ThemeStore(db);
  // Pages and Apps: the item index (src/item-index.ts). Triggers keep it in
  // step; this check puts right whatever one missed, before anything reads it.
  const itemIndex = new ItemIndex(db);
  try {
    const healed = itemIndex.heal();
    if (healed.written || healed.removed) bb.log.info(`Item index repaired: ${healed.written} row(s) written, ${healed.removed} removed.`);
  } catch (error) { bb.log.warn(`Item index check failed: ${error instanceof Error ? error.message : String(error)}`); }
  // The one trigger engine: everything Studio does on a schedule registers here.
  const triggers = new TriggerEngine(db, { warn: (message) => bb.log.warn(message) });
  let disposed = false;
  bb.onDispose(() => { disposed = true; triggers.stop(); });
  // Studio's own scheduler for agent runs (src/triggers/scheduler.ts): the
  // Bot's check-in, runners and check-in and reminder automations run on the
  // engine, not BB's automations plugin. A run ends when its thread settles.
  const scheduler = new EngineScheduler({ db, sdk: bb.sdk, engine: triggers, warn: (message) => bb.log.warn(message) });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => scheduler.threadSettled(thread.id, "succeeded", lastAssistantText));
  bb.events.on("thread.failed", ({ thread, error }) => scheduler.threadSettled(thread.id, "failed", error));
  const services = new StudioServices(db);
  const recordActivity = (event: Parameters<StudioServices["recordActivity"]>[0]) => {
    const id = services.recordActivity(event);
    changes.append(null);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" });
    return id;
  };
  // Create tools nudge agents to tag what they make (src/create-tag-hint.ts).
  const tagNames = new TagStore(db);
  // Tools by family (src/family-tools.ts): each type's tools keep their names
  // and say which family tool does the same; pages_* also take designs and
  // whiteboards. The book lets a family tool run a type's own handler.
  const toolBook = new ToolBook();
  // Setup → Kinds loads below; until then every type counts as on.
  let typeIsOn = (_type: ItemType): boolean => true;
  const familyDeps = { book: toolBook, typeOn: (type: ItemType) => typeIsOn(type) };
  const registerTool = bb.agents.registerTool.bind(bb.agents);
  bb.agents.registerTool = ((tool: Parameters<typeof registerTool>[0]) => {
    const named = familyTool(withTagHint(tool as never, () => tagNames.list().map((tag) => tag.name)) as AgentTool, familyDeps);
    toolBook.add(named);
    return registerTool(named as never);
  }) as typeof bb.agents.registerTool;
  // Kinds built into Studio (docs/merging-add-ons.md); the hub calls them in-process.
  let appCards = false;
  const artifacts = registerArtifacts(bb, db, services, notifyBuiltin, () => appCards);
  bb.onDispose(() => artifacts.dispose());
  const drawings = registerDraw(bb, db, services, notifyBuiltin);
  bb.onDispose(() => drawings.dispose());
  const designs = registerDesign(bb, db, services, notifyBuiltin);
  bb.onDispose(() => designs.dispose());
  const dashboards = registerDashboards(bb, db, notifyBuiltin);
  bb.onDispose(() => dashboards.dispose());
  // Mini apps' `playground.bb.studio.list` reads the collection through the hub, made below.
  const minis = registerMinis(bb, db, services, notifyBuiltin, {
    appCards: () => appCards,
    artifactSource: (id) => {
      const artifact = artifacts.store.get(id);
      if (!artifact) return null;
      if (artifactVersionType(artifact.version) !== "html") throw new Error("Only an HTML artifact can become a mini app.");
      const bytes = artifacts.store.bytes(artifact.version.sha256);
      if (!bytes) return null;
      return { title: artifactTitle(artifact), html: bytes.toString("utf8"), state: artifacts.liveState(id), projectId: artifact.project_id };
    },
    studioList: async ({ query, kind, limit }) => {
      const { items } = await hub.overview();
      const needle = query?.trim().toLowerCase() ?? "";
      return items
        .filter((item) => !item.archived && (!kind || item.kind === kind) && (!needle || item.title.toLowerCase().includes(needle)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((item) => ({ id: `${item.pluginId}:${item.id}`, kind: item.kind, title: item.title, href: item.href ?? null, updatedAt: item.updatedAt ?? null }));
    },
  });
  bb.onDispose(() => minis.dispose());
  // Studio's settings (src/settings): BB draws only the API keys; everything
  // else is in Studio's own storage, shown in Studio's grouped sections. On the
  // first load after the move, the old values migrate once. `settings` merges
  // both under the keys Talk, Pages, Explore, Reactions, Decisions,
  // thread resume, hands-free voice and Todos always used.
  const { settings, store: studioSettings } = await registerSettings(bb, STUDIO_PLUGIN_ID);
  const code = registerCode(bb, db);
  // The agent's hands on its conversation's workbench (src/workbench-agent): the tools run here, the window showing the conversation does the work.
  let entryTitle: (kind: "automation" | "todo" | "record", id: string) => Promise<string | null> = async () => null;
  registerWorkbenchAgent(bb, {
    itemTitle: (id) => itemIndex.get(id)?.title ?? searchIndex.titleOf(id),
    // `bots` is made further down; a tool is only called once the plugin has loaded.
    botName: (id) => bots.stored(id)?.name ?? null,
    entryTitle: (kind, id) => entryTitle(kind, id),
  });
  // BB allows one message.dispatch hook per plugin; Decisions owns it and asks
  // the runner guard (assigned below, once runners exist) first.
  let runnerDispatch: (context: { thread: { id: string } }) => Promise<{ action: "reject"; message: string } | null> = async () => null;
  const decisions = await registerDecisions(bb, settings, (context) => runnerDispatch(context));
  let settingValues: Record<string, unknown> = await settings.get();
  appCards = settingValues.appCards === true;
  const explore = registerExploreBuiltin(bb, db, settingValues);
  settings.onChange((next) => {
    settingValues = next;
    appCards = next.appCards === true;
    explore.update(next);
  });
  registerThreadExportHook(bb, () => ({ enabled: settingValues.exportDeletedThreads === true, folder: typeof settingValues.exportDeletedThreadsFolder === "string" ? settingValues.exportDeletedThreadsFolder : "" }));
  const skillsRegistry = createSkillsRegistryGate({ hooks: (bb as { experimental_hooks?: object }).experimental_hooks, kv: bb.storage.kv, approval: hostApproval(bb) });
  bb.rpc.register(skillsRegistryContract, {
    "skillsRegistry.state": () => skillsRegistry.state(),
    "skillsRegistry.set": ({ enabled }) => skillsRegistry.set(enabled),
  });
  // Reactions keep only settings: copy the old plugin's once, in the background.
  const reactionsImport = {
    plugins: bb.sdk.plugins,
    kv: bb.storage.kv,
    settings: { get: () => settings.get(), set: (values: Record<string, unknown>) => settings.experimental_set(values) },
  };
  void importReactionsSettings(reactionsImport).then((applied) => { if (applied) bb.log.info(`Copied Studio Reactions settings (${applied.join(", ") || "none changed"}).`); })
    .catch((error) => bb.log.warn(`Couldn't copy Studio Reactions settings: ${errorText(error)}`));
  const pages = registerPages(bb, db, {
    snapshotsPerPage: () => Number(settingValues.snapshotsPerPage ?? STUDIO_SETTINGS.snapshotsPerPage.default),
  }, {
    created: (ref, threadId) => services.created(ref, threadId),
    linkThread: (thread) => services.linkThread(thread),
    replaceLinks: (ref, source, links) => services.replaceLinks(ref, source, links),
    recordActivity,
  }, notifyBuiltin, {
    items: async () => {
      const { items, providers } = await hub.overview();
      return items.filter((item) => item.pluginId !== "pages" && !item.archived)
        .map((item) => indexItem(item.pluginId, item, providers.find((provider) => provider.pluginId === item.pluginId)!))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
    },
    create: async (pluginId, kind, projectId) => {
      const [{ item }, info] = await Promise.all([
        hub.call(pluginId, "studio_create", { kind, projectId }),
        hub.call(pluginId, "studio_describe", null),
      ]);
      return indexItem(pluginId, item, info);
    },
    drawing: drawings.getDrawing,
    saveDrawing: drawings.saveDrawing,
    artifact: artifacts.getArtifact,
    artifactText: artifacts.readText,
    recording: (id) => {
      const recording = recordings.store.recording(id);
      return recording ? { recording, segments: recordings.store.segments(id) } : null;
    },
  });
  bb.onDispose(() => pages.dispose());
  // Whiteboards: drawings live in pages. Drawings in no page move into a
  // "Drawings" page, once each (src/draw/server/whiteboards.ts).
  drawings.connectPages(pages.whiteboards);
  await moveOrphanDrawings(bb, drawings, pages.whiteboards).catch((error) => bb.log.warn(`Couldn't move drawings into a Drawings page: ${errorText(error)}`));
  const recordings = await registerTalk(bb, db, settings as unknown as TalkSettingsHandle, pages.notes, notifyBuiltin);
  bb.onDispose(() => recordings.dispose());

  // BB takes one agent configuration per plugin: the built-in kinds' tools in
  // every session, with Pages' instructions and the Next row's (Explore's), as
  // the Pages plugin gave them.
  // Setup → Kinds: built-in kinds the user turned off, and who opens and
  // creates each (src/kinds.ts).
  const kindSettings = new KindSettingsStore(bb.storage.kv as never);
  await kindSettings.load();
  typeIsOn = (type) => builtinOn(kindSettings.current, itemType(type)!.pluginId);
  const hub = new StudioHub(bb.sdk, [
    { pluginId: "studio-code", name: "VS Code", handlers: code.provider },
    { pluginId: "pages", name: "Pages", handlers: pages.provider },
    { pluginId: "artifacts", name: "Artifacts", handlers: artifacts.provider },
    { pluginId: "excalidraw", name: "Whiteboards", handlers: drawings.provider },
    { pluginId: "design", name: "Designs", handlers: designs.provider },
    { pluginId: "talk", name: "Recordings", handlers: recordings.provider },
    { pluginId: "minis", name: "Mini apps", handlers: minis.provider },
  ], {
    builtinOn: (pluginId) => builtinOn(kindSettings.current, pluginId),
    route: (providers) => routeProviders(providers, kindSettings.current),
    itemTypes: (pluginId) => itemIndex.types(pluginId),
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
  const BOT_TOOLS = ["bot_get", "bot_set", "bot_pause", "bot_resume", "bot_stop", "bot_activity"] as const;
  /** Only the Bot's own thread gets these: its skills and its history. */
  const BOT_OWN_TOOLS = ["bot_profile_update", "bot_skill_list", "skill_search", "bot_skill_view", "bot_skill_write", "bot_skill_patch", "bot_skill_delete", "bot_skill_lint", "bot_history_search", "bot_threads_list", "runner_create", "runner_update", "runner_migrate", "runner_pause", "runner_resume", "runner_delete", "runner_list", "runner_run_now", "automation_list", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_run_now", "automation_delete"] as const;
  /**
   * Every conversation of a Bot gets these too (src/bot-threads-server.ts):
   * its conversations and workers, and raising something with the user. A
   * side thread ("Reply in thread") is a conversation now, with the Bot's
   * full tools: the old read-only side-thread rule is gone.
   */
  const CONVERSATION_TOOLS = ["bot_conversations", "bot_needs_you", "bot_activity_lookup", "bot_finish_done", CONTINUE_TOOL] as const;
  for (const tool of appTools({ ...familyDeps, index: itemIndex })) bb.agents.registerTool(tool as never);
  /** Only a runner's thread gets this (src/runners.ts). */
  const RUNNER_TOOLS = ["runner_report"] as const;
  const KIND_TOOLS: Record<string, readonly string[]> = { page: PAGE_TOOLS, artifact: ARTIFACT_TOOLS, drawing: DRAW_TOOLS, design: DESIGN_TOOLS, recording: TALK_TOOLS, mini: MINI_TOOLS };
  // BB takes one agent configuration per plugin: the built-in kinds' tools in
  // every session, with Pages' instructions and the Next row's (Explore's), as
  // the Pages plugin gave them. A kind turned off gives neither, from the next
  // session start or resume on (BB doesn't change a running session).
  // Memory (src/memory): every Bot conversation and worker also gets the memory tools and the core profile, at MEMORY_SLOT.
  bb.agents.configure(withMemory(() => memoryService, (context) => isCanvasThreadOrigin(context.origin) || !!learning.review(context.thread.id) || typeof context.pluginMetadata?.botReview === "string", (context) => {
    if (Date.now() - routesCheckedAt > 30_000) void refreshRoutes();
    // A Visual Chat thread works with that plugin's canvas tools only (src/voice/live/canvas-plugin.ts).
    if (isCanvasThreadOrigin(context.origin)) return { tools: [], skills: [], instructions: "" };
    const off = new Set(kindSettings.current.off);
    const tools = BUILTIN_KINDS.filter((each) => !off.has(each.kind)).flatMap((each) => [...(KIND_TOOLS[each.kind] ?? [])]);
    // The apps family's tools, while any app type is on.
    if (ITEM_TYPES.some((each) => each.family === "app" && !off.has(each.kind))) tools.push(...APP_TOOLS);
    tools.push(...CODE_TOOLS, ...WORKBENCH_TOOLS);
    // A skill review fork (src/skill-learning.ts) gets the skill tools and the Memory page's, nothing else of Studio's.
    if (learning.review(context.thread.id) || typeof context.pluginMetadata?.botReview === "string") return { tools: [...REVIEW_TOOLS, ...CODE_TOOLS], skills: ["studio-code"], instructions: "" };
    // The Bot's own thread is told who it is; paused or stopped, it gets no Studio tools but its own.
    // Every conversation of a Bot (src/bot-threads.ts) is that Bot: Main, a fork
    // (a side thread from "Reply in thread" included) and a thread Patrick
    // started. BB sets a fork's session up while it's made, before Studio
    // records it: a side chat's metadata says whose it is from the start.
    // A conversation from + New says whose it is in its metadata too (bot_conversation_start).
    const sideBotId = typeof context.pluginMetadata?.botSideThread === "string" ? context.pluginMetadata.botSideThread
      : typeof context.pluginMetadata?.botConversation === "string" ? context.pluginMetadata.botConversation : sideThreads.forThread(context.thread.id)?.botId;
    const conversation = botThreads.store.get(context.thread.id);
    const conversationBotId = conversation?.kind === "conversation" ? conversation.botId : sideBotId ?? null;
    const own = bots.forThread(context.thread.id, context.pluginMetadata);
    const asConversation = !own && conversationBotId ? bots.stored(conversationBotId) : null;
    const bot = own ?? (asConversation ? { ...asConversation, threadId: context.thread.id } : null);
    // An external bot's agent has its own memory and tools; Studio's don't reach it.
    if (bot?.kind === "external") return { tools: [], skills: [], instructions: bots.instructions(bot) };
    if (bot && bot.state !== "active") return { tools: [...BOT_TOOLS, ...CODE_TOOLS], skills: ["studio-code"], instructions: bots.instructions(bot) };
    // A runner is told its job and how to report; it reports with runner_report only.
    const runner = bot ? null : runners.forThread(context.thread.id, context.pluginMetadata);
    const which = bot ? conversationNote(context.thread.id) : "";
    // Short pointers for Pages, mini apps and the Next row; their long guidance is in the studio skill (src/agent-instructions.ts).
    const instructions = studioInstructions({
      bot: bot ? bots.instructions(bot) : "", conversation: which, runner: runner ? runners.instructions(runner) : "",
      pages: !off.has("page"), minis: !off.has("mini"), appCards, work: true, endOfReply: explore.endOfReply(), routing: routingInstructions(kindRoutes, kindSettings.current),
    });
    return { tools: [...tools, ...BOT_TOOLS, ...LOOP_TOOLS, ...WORK_TOOLS, ...(bot ? [...BOT_OWN_TOOLS, ...CONVERSATION_TOOLS, ...THEME_TOOLS, ...PRESENCE_TOOLS] : []), ...(runner ? RUNNER_TOOLS : [])], skills: ["studio-code", "studio"], instructions };
  }));
  /** Which conversation a Bot's session is in (src/bot-threads.ts conversationInstructions); "" before Studio has placed it. */
  const conversationNote = (threadId: string): string => {
    const rec = botThreads.store.get(threadId);
    if (!rec || rec.kind !== "conversation") return "";
    const title = (id: string) => botThreads.store.get(id)?.title ?? null;
    return conversationInstructions(rec, rec.title ?? "this conversation", rec.forkedFrom ? title(rec.forkedFrom.threadId) : null);
  };
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
  const threadTitles = new ThreadTitles(async (threadId) => ((await bb.sdk.threads.get({ threadId })) as { title?: string | null }).title ?? "");
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
      return { ...item, tags: assigned.get(keys[index]!) ?? [], starredAt: starredAt.get(keys[index]!) ?? null, createdBy: createdBy.get(keys[index]!) ?? null, thread: threadId ? { id: threadId, title: titles.get(threadId) ?? "" } : null };
    });
  };
  const workspace = new WorkspacePresence();
  const searchIndex = new SearchIndex(db, hub, () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }));
  bb.onDispose(() => searchIndex.dispose());
  async function studioChanged({ pluginId, ids, removed }: { pluginId: string; ids?: string[]; removed?: string[] }) {
    await searchIndex.changed(pluginId, ids, removed);
    await recordProviderChanges(hub, changes, pluginId, ids, removed);
    bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId, ids, removed });
    return { ok: true };
  }
  servicesReady();
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
      const complete = await services.reconcileThread(threadId, () => bb.sdk.threads.get({ threadId }),
        (error) => bb.log.warn(`Thread ${threadId} unavailable: ${errorText(error)}`));
      if (complete) pendingThreadChecks.delete(threadId);
    }
  })().finally(() => { reconcilingThreads = null; });
  await reconcileThreads();
  let lastReconcile = Date.now();
  // Thread events keep linked threads current; this pass only catches what was missed, so it is rare where BB reports interruptions itself.
  const hostEvents = { listening: false };
  triggers.every("thread-reconcile", 60_000, () => (hostEvents.listening && Date.now() - lastReconcile < 30 * 60_000 ? undefined : (lastReconcile = Date.now(), reconcileThreads().catch((error) => bb.log.warn(`Thread reconciliation failed: ${errorText(error)}`)))));
  bb.onDispose(async () => { await reconcilingThreads; });
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

  // Each project's optional lead thread and its heartbeat (src/project-lead.ts).
  // The heartbeat of the personal project is the Bot's check-in, under its name.
  const projectLeads: ProjectLeads = new ProjectLeads({ db, sdk: bb.sdk, scheduler, changed: tagsChanged, personalPrompt: (): string => bots.prompt(), botPrompt: (key) => bots.promptFor(key) });
  // The user's Bot (src/bot.ts): the personal project's lead, with a name, avatar and state.
  // Its Memory page is a Studio page in the personal project; a shared skill goes to BB's user skills.
  let loopsEnabled = () => false;
  // When the BB Studio copy's import from bb ran (null without one), read at most every 30 s.
  const importedAt = (() => { let readAt = 0, value: number | null = null; return () => { if (Date.now() - readAt > 30_000) { value = readImportedAt(bb.server.experimental_dataDir); readAt = Date.now(); } return value; }; })();
  const botSignal = new BotSignal((event) => bb.realtime.publish(BOT_THREADS_CHANNEL, event), 250);
  bb.onDispose(() => botSignal.dispose());
  const bots: Bots = new Bots({
    loopsEnabled: () => loopsEnabled(),
    importedAt,
    db, sdk: bb.sdk, leads: projectLeads, changed: tagsChanged,
    presenceChanged: (botId) => botSignal.add([{ botId, kinds: ["presence"] }]),
    memory: {
      exists: (pageId) => { const page = pages.store.meta(pageId); return !!page && !page.archived_at; },
      // A new Bot's memory page is its core profile (src/memory).
      create: ({ botId, botName }) => memoryService.newProfile(botId, botName),
      addCheckin: (pageId, line) => pages.addCheckin(pageId, line),
      retitle: (pageId, from, to) => pages.retitle(pageId, from, to),
    },
    userSkillsDir: join(bb.server.experimental_dataDir, "skills"),
    // Side threads show as their reply's row, not as work the Bot started.
    hiddenThreads: () => new Set([...learning.reviewThreads(), ...sideThreads.threadIds()]),
    ownedThreads: (botId) => ownedThreads.owned(botId),
    claimChains: () => ownedThreads.claimChains(),
    runners: { threads: (botId) => runners.threads(botId), pauseAll: (botId, onPaused) => runners.pauseAll(botId, onPaused), restore: (id) => runners.restore(id) },
    automations: {
      pauseAll: (botId, onPaused) => automations.pauseAll(botId, onPaused),
      restore: (id) => automations.restore(id),
      follow: async (botId) => { const bot = automationBot(botId); if (bot) await automations.follow(bot); },
      scheduled: (botId) => automations.scheduled(botId),
    },
  });
  const themeGpu = new ThemeGpuRouter((request) => { void bb.realtime.publish(THEME_GPU_CHANNEL, request as never); });
  bb.onDispose(() => themeGpu.dispose());
  const themeService = new ThemeService({
    store: themes,
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, appearance: bot.appearance ?? null })),
    setAppearance: (botId, appearance) => bots.setAppearance({ botId, appearance }),
    measure: (theme) => themeGpu.measure(theme),
  });
  const presenceChecks = new PresenceCheckRouter((request) => { void bb.realtime.publish(PRESENCE_CHECK_CHANNEL, request as never); });
  bb.onDispose(() => presenceChecks.dispose());
  const presenceService = new PresenceService({
    store: new PresenceStore(db),
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, presence: bots.presenceOf(bot.id) })),
    setPresence: async (botId, presence) => bots.setPresence({ botId, presence }),
    measure: (presence) => presenceChecks.measure(presence),
  });
  const themeBot = (ref: string | null | undefined, fallback: string | undefined): { id: string; name: string } | string => {
    const all = bots.list();
    if (!all.length) return "No Bots yet.";
    if (ref) {
      const wanted = ref.trim().toLowerCase();
      const found = all.find((bot) => bot.id === ref) ?? all.find((bot) => bot.name.toLowerCase() === wanted);
      return found ? { id: found.id, name: found.name } : `No Bot ${ref}. Bots: ${all.map((bot) => `${bot.name} (${bot.id})`).join(", ")}.`;
    }
    const found = all.find((bot) => bot.id === fallback) ?? all.find((bot) => bot.primary) ?? all[0]!;
    return { id: found.id, name: found.name };
  };
  const loops = registerLoops(bb, db, async (text) => {
    const bot = bots.stored();
    if (!bot?.threadId || bot.state !== 'active') throw new Error('An active Bot chat is required');
    await bb.sdk.threads.send({threadId:bot.threadId,mode:'auto',input:[{type:'text',text,mentions:[],visibility:'agent-only'}]} as never);
  }, async (loop) => {
    const bot = bots.stored();
    if (!bot?.threadId) throw new Error('A Bot chat is required');
    await bb.sdk.plugins.callRpc({pluginId:'mobile',method:'notify',outputSchema:z.unknown(),input:{title:loop.title,body:loop.why,kind:'turn-finished',threadId:bot.threadId,botId:bot.id,conversationId:bot.threadId,projectId:PERSONAL_PROJECT_ID,category:'BB_LOOP',loopId:loop.id,loopKind:loop.kind,actions:loopPushActions(loop.kind),...(loop.kind==='decide'&&loop.options.length?{options:loop.options.slice(0,4).map(o=>o.slice(0,120))}:{}),coalesceKey:loop.id} as never});
  }, settings, loopTimeZone, (name, everyMs, work) => triggers.every(name, everyMs, work));
  loopsEnabled = loops.enabled;
  const work = registerWorkCards(bb, db);
  // The Bot's runners (src/runners.ts): long-lived threads on their own schedules, quiet unless they report.
  const runners: Runners = new Runners({
    db, sdk: bb.sdk, scheduler, changed: tagsChanged,
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
  triggers.every("thread-sweeps", 5 * 60_000, () => { sweepOwned(); resumeSweep(); if (!hostEvents.listening) threadResumeSweep(); });
  bb.onDispose(() => { ownedThreads.dispose(); });
  void runners.hideThreads().catch((error) => bb.log.warn(`Hiding runner threads failed: ${errorText(error)}`)).finally(sweepOwned);
  // A Bot's automations (src/automations.ts): check-ins, reminders, watchers, and its runners in the same list.
  const automationBot = (botId?: string) => { const bot = bots.stored(botId); return bot ? { id: bot.id, name: bot.name, threadId: bot.threadId, state: bot.state, primary: bot.primary !== false, kind: bot.kind ?? "studio" } : null; };
  const automations: Automations = new Automations({
    db, sdk: bb.sdk, scheduler, changed: tagsChanged,
    copiedReminder: (id) => loops.enabled() && !!db.prepare("SELECT 1 FROM bot_loops WHERE id = ?").get(reminderLoopId(id)),
    bot: automationBot,
    // With bb's automations plugin off (a BB Studio copy), watchers run here and bb's rows are read from its data file (src/automation-table.ts).
    bbFile: () => bbFromFile(join(bb.server.experimental_dataDir, "plugins", "automations", "data.db")),
    importedAt,
    watcherDir: join(bb.server.experimental_dataDir, "plugins", STUDIO_PLUGIN_ID, "watchers"),
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
  bb.rpc.register(scheduledContract, {
    "loops.scheduled": async ({ threadId }) => ({
      items: scheduledItems({
        loops: loops.store.all(),
        bots: await Promise.all(bots.list().map(async (bot) => ({ id: bot.id, name: bot.name, threadId: bot.threadId, primary: bot.primary !== false, automations: await automations.list(bot.id).catch(() => []), table: (await automationTableFor(bot.id).catch(() => null))?.rows ?? [] }))),
        threadId,
      }),
    }),
  });
  // BB automations (watchers', adopted runners') BB turned off after a
  // transient failure come back on (src/auto-resume.ts; Studio's own schedules
  // are skipped there), at most three times a day each; past that,
  // a line in the owning Bot's chat for it to triage. At startup, on the five-minute sweep, and soon after a
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
          note: STOPPED_NOTE,
          push: { botId: bot.id, title: `${bot.name} · ${target.name}`, body: line, coalesceKey: `auto-resume:${target.automationId}` },
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
  // marker, at most twice an hour each; past that, a line in the owning Bot's
  // chat for it to triage (a Bot's thread) or a phone push (any other).
  const botPushIds = (threadId: string) => botThreads.pushIds(threadId);
  const threadOwner = (threadId: string): ThreadOwner | null => {
    const bot = bots.list().find((each) => bots.chain(each.id).includes(threadId))
      ?? (() => { const runner = runners.forThread(threadId); return runner ? bots.stored(runner.bot_id) : null; })()
      ?? bots.list().find((each) => ownedThreads.owned(each.id).has(threadId));
    return bot ? { botId: bot.id, name: bot.name, threadId: bot.threadId ?? null, active: bot.state === "active" } : null;
  };
  // A thread a Bot owns starts waiting on an answer: one note to the Bot (src/bot-nudge.ts).
  // Owned: the Bot's chain, a runner, a thread it owns, or one started (up to a few levels) by any of those.
  const nudgeOwner = async (thread: { id: string }): Promise<NudgeOwner | null> => {
    const known = (id: string) => { const owner = threadOwner(id); return owner?.threadId ? { botId: owner.botId, botThreadId: owner.threadId, active: owner.active } : null; };
    const direct = known(thread.id);
    if (direct) return { ...direct, self: bots.list().some((bot) => bots.chain(bot.id).includes(thread.id)) };
    let ids = [thread.id];
    for (let depth = 0; depth < 4 && ids.length; depth++) {
      const parents = (await Promise.all(ids.map((id) => bb.sdk.threads.get({ threadId: id }).catch(() => null))))
        .flatMap((each) => each ? [each.parentThreadId, each.sourceThreadId, each.lifecycleOwnerThreadId].filter((id): id is string => !!id) : []);
      for (const id of parents) { const owner = known(id); if (owner) return { ...owner, self: false }; }
      ids = [...new Set(parents)];
    }
    return null;
  };
  // A worker's question goes to the conversation that started it (else Main),
  // which shows as needing the user until the worker stops waiting
  // (src/bot-threads.ts). A conversation's own question is its own mark.
  const conversationOwner = async (thread: { id: string }): Promise<NudgeOwner | null> => {
    const rec = botThreads.store.get(thread.id);
    const bot = rec ? bots.stored(rec.botId) : null;
    if (rec && bot?.threadId) {
      if (rec.kind === "conversation") return { botId: bot.id, botThreadId: thread.id, active: bot.state === "active", self: true };
      const target = rec.ownerConversationId ? botThreads.store.get(rec.ownerConversationId) : null;
      return { botId: bot.id, botThreadId: target && target.archivedAt === null ? target.threadId : bot.threadId, active: bot.state === "active", self: false };
    }
    return nudgeOwner(thread);
  };
  const nudges = new BotNudges({
    db, sdk: bb.sdk, owner: conversationOwner, log: (message) => bb.log.warn(message),
    raised: (thread, owner, interaction) => { botThreads.store.setNeedsYou(owner.botThreadId, nudgeReason(thread, interaction), thread.id); },
    cleared: (threadId) => { botThreads.store.clearNeedsYouFrom(threadId); },
  });
  bb.events.on("interaction.pending", ({ thread, interaction }) => void nudges.pending(thread, interaction as never).catch((error) => bb.log.warn(`Bot nudge: ${errorText(error)}`)));
  bb.events.on("interaction.pending", ({ thread, interaction }) => void botThreads.approvalPush(thread, interaction as never).then((push) => push && bb.sdk.plugins.callRpc({
    pluginId: "mobile", method: "notify", outputSchema: z.unknown(), input: push as never,
  })).catch((error) => bb.log.warn(`Worker approval push failed: ${errorText(error)}`)));
  bb.events.on("thread.active", ({ thread }) => void nudges.settled(thread.id).catch(() => {}));
  bb.events.on("thread.idle", ({ thread }) => void nudges.settled(thread.id).catch(() => {}));
  const threadResume = new ThreadResume({
    db, sdk: bb.sdk, owner: threadOwner, log: (message) => bb.log.warn(message),
    enabled: () => settingValues.autoResumeThreads !== false,
    exhausted: async (thread, owner, line) => {
      if (owner?.threadId) {
        tagsChanged();
        await alertBot(bb.sdk, {
          botThreadId: owner.threadId, line: `⚠️ ${line}`,
          note: STOPPED_NOTE,
          push: { botId: owner.botId, title: `${owner.name} · ${thread.title}`, body: line, coalesceKey: `thread-resume:${thread.id}` },
        });
        return;
      }
      await bb.sdk.plugins.callRpc({
        pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
        input: { title: `Stopped: ${thread.title}`, body: line, kind: "turn-finished", threadId: thread.id, ...(thread.projectId ? { projectId: thread.projectId } : {}), coalesceKey: `thread-resume:${thread.id}`, ...botPushIds(thread.id) } as never,
      }).catch((error) => bb.log.warn(`Thread resume notice failed: ${errorText(error)}`));
    },
  });
  const threadResumeSweep = () => void threadResume.sweep().catch((error) => bb.log.warn(`Thread resume sweep failed: ${errorText(error)}`));
  bb.onDispose(() => threadResume.dispose());
  bb.events.on("thread.failed", ({ thread }) => threadResume.failed(thread.id));
  bb.events.on("thread.idle", ({ thread }) => threadResume.idle(thread.id));
  bb.events.on("thread.archived", ({ thread }) => threadResume.settled(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => threadResume.settled(thread.id));
  // On a BB with host events Studio hears about interrupted turns and host
  // daemons as they happen; otherwise it watches BB's realtime socket and
  // keeps the periodic sweeps.
  const checkMachinesNow = () => void runners.checkMachines().catch(error => bb.log.warn(`Runner machines: ${errorText(error)}`));
  hostEvents.listening = listenForHostEvents(bb, {
    turnInterrupted: (threadId, reason) => { if (cutOffByHost(reason)) threadResume.failed(threadId); },
    hostConnected: () => { threadResume.hostConnected(); checkMachinesNow(); },
    hostDisconnected: () => checkMachinesNow(),
  });
  if (!hostEvents.listening && typeof bb.sdk.subscribe === "function") {
    try {
      const unsubscribe = bb.sdk.subscribe({ event: "host:changed", callback: (event) => { if (event.changes.includes("host-connected")) { threadResume.hostConnected(); checkMachinesNow(); } } });
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
  for (const event of ["thread.idle", "thread.active"] as const) bb.events.on(event, ({ thread }) => void sideThreads.recount(thread.id).catch((error) => bb.log.warn(`Thread replies: ${errorText(error)}`)));
  void sideThreads.recountAll().catch((error) => bb.log.warn(`Thread replies: ${errorText(error)}`));
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
  // Memory (src/memory): the core profile, memory records and their tools, and the automatic one-time split of an old Memory page.
  const memoryService: MemoryService = new MemoryService({
    store: new MemoryStore(db, () => bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" })),
    bots: { list: () => bots.list(), pageId: (botId) => bots.stored(botId)?.memoryPageId ?? null, setPage: (botId, pageId) => setBotMemoryPage(db, botId, pageId) },
    pages: {
      meta: (pageId) => { const page = pages.store.meta(pageId); return page && !page.archived_at ? { title: page.title, updatedAt: page.updated_at } : null; },
      markdown: (pageId) => pages.markdown(pageId),
      create: ({ title, markdown, icon }) => pages.createPage({ projectId: PERSONAL_PROJECT_ID, title, icon, markdown }),
    },
    threads: { get: async (threadId) => { const thread = await bb.sdk.threads.get({ threadId }).catch(() => null); return thread ? { title: thread.title || thread.titleFallback || "", archived: !!thread.archivedAt } : null; } },
    // Studio's record of conversations and workers (src/bot-threads.ts) decides a thread's Bot and role first.
    botThread: (threadId) => { const rec = botThreads.store.get(threadId); return rec ? { botId: rec.botId, kind: rec.kind, isMain: rec.isMain, title: rec.title } : null; },
    acting: (threadId) => acting(threadId),
    sideBot: (threadId) => sideThreads.forThread(threadId)?.botId ?? null,
    runnerName: (threadId) => runners.forThread(threadId)?.name ?? null,
    ownedBot: (threadId) => bots.list().find((bot) => ownedThreads.owned(bot.id).has(threadId))?.id ?? null,
    chainBot: (threadId) => bots.list().find((bot) => bots.chain(bot.id).includes(threadId))?.id ?? null,
    ownBot: (threadId, metadata) => bots.forThread(threadId, metadata)?.id ?? null,
    runnerBot: (threadId, metadata) => runners.forThread(threadId, metadata)?.bot_id ?? null,
    changed: tagsChanged,
    log: (message) => bb.log.warn(message),
  });
  registerMemory(bb, memoryService);
  // Every Bot with an old Memory page and no core profile yet is split once, on its own, soon after start.
  // The rail holds only BB's global things; Studio's pages open from the Bot sidebar (src/rail-arrangement.ts). Once per install.
  const railStart = setTimeout(() => {
    if (disposed) return;
    void arrangeRailOnce({
      kv: bb.storage.kv,
      list: () => bb.sdk.system.uiPreferences.list() as never,
      set: (input) => bb.sdk.system.uiPreferences.set(input as never),
    }).catch((error: unknown) => bb.log.warn(`Studio couldn't arrange the rail: ${error instanceof Error ? error.message : String(error)}`));
  }, 3_000);
  bb.onDispose(() => clearTimeout(railStart));
  const footerStart = setTimeout(() => {
    if (disposed) return;
    void arrangeFooterOnce({
      kv: bb.storage.kv,
      list: () => bb.sdk.system.uiPreferences.list() as never,
      set: (input) => bb.sdk.system.uiPreferences.set(input as never),
    }).catch((error: unknown) => bb.log.warn(`Studio couldn't arrange the sidebar footer: ${error instanceof Error ? error.message : String(error)}`));
    void retireLegacyThemeOnce({
      kv: bb.storage.kv,
      get: () => bb.sdk.theme.get(),
      set: (themeId) => bb.sdk.theme.set(themeId),
    }).catch((error: unknown) => bb.log.warn(`Studio couldn't move BB off the old BB Studio palette: ${error instanceof Error ? error.message : String(error)}`));
  }, 3_000);
  bb.onDispose(() => clearTimeout(footerStart));
  const memorySplitStart = setTimeout(() => { if (!disposed) memoryService.autoSplitAll(); }, 2_000);
  bb.onDispose(() => clearTimeout(memorySplitStart));
  const maintenance = new BotMaintenance({
    db, sdk: bb.sdk, scheduler, changed: tagsChanged,
    bots: () => bots.list(), owned: (id) => ownedThreads.owned(id), refreshOwned: () => ownedThreads.sweep(),
    memory: (id) => { if (memoryService.split(id).state === "needed") return null; const pageId = bots.memoryPage(id); if (!pageId) return null; const page = pages.store.meta(pageId); return page ? { id: pageId, markdown: pages.markdown(pageId) ?? "", updatedAt: page.updated_at } : null; },
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
    // Main plus the conversations active in the last two hours; idle ones go cold.
    conversations: () => botThreads.store.listed().flatMap((rec) => (rec.kind === "conversation" && !rec.isMain ? [{ botId: rec.botId, threadId: rec.threadId, lastActiveAt: Math.max(rec.latest?.at ?? 0, rec.createdAt) }] : [])),
  });
  bb.events.on("thread.idle", ({ thread }) => void warmer.idle(thread.id).catch(() => {}));
  bb.events.on("thread.failed", ({ thread }) => warmer.failed(thread.id));
  triggers.every("cache-warm", 60_000, () => warmer.tick().catch((error) => bb.log.warn(`Cache warming tick failed: ${errorText(error)}`)));
  // One Bot, many conversations (src/bot-threads.ts): every thread's Bot and
  // kind, filled once from what exists, kept current from BB's events, and
  // Studio's own facts (chats, side threads, runners, leads) applied again
  // every two minutes.
  type ForkPoint = (threadId: string) => Promise<{ sourceThreadId: string; sourceTurnId: string | null } | null>;
  const forkPointHook = (): ForkPoint | null => {
    const hooks = (bb as { experimental_hooks?: object }).experimental_hooks;
    const lookup = hooks ? Object.entries(hooks).find(([key]) => key === "experimental_threadForkPoint")?.[1] : undefined;
    return typeof lookup === "function" ? (threadId) => (lookup as ForkPoint).call(hooks, threadId) : null;
  };
  let botThreadsSignal: ReturnType<typeof setTimeout> | null = null;
  bb.onDispose(() => { if (botThreadsSignal) clearTimeout(botThreadsSignal); });
  const botThreadsChanged = (changes: readonly BotChange[]) => {
    botThreadsSignal ??= setTimeout(() => { botThreadsSignal = null; bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }); }, 250);
    botSignal.add(changes);
  };
  const threadSeeds = new ThreadSeeds(db);
  const botThreads = registerBotThreads(bb, db, {
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, avatar: bot.avatar, shape: bot.shape ?? null, color: bot.color ?? null, primary: !!bot.primary, threadId: bot.threadId, appearance: bot.appearance ?? null, presence: bots.presenceOf(bot.id) })),
    signals: () => ({
      bots: bots.list().map((bot) => ({ id: bot.id, threadId: bot.threadId, chain: bots.chain(bot.id) })),
      sideThread: (threadId) => sideThreads.forThread(threadId),
      runnerBot: (threadId) => runners.forThread(threadId)?.bot_id ?? null,
      leadThreads: new Set(projectLeads.list().flatMap((lead) => (lead.projectId !== PERSONAL_PROJECT_ID && lead.leadThreadId ? [lead.leadThreadId] : []))),
      internal: learning.reviewThreads(),
      managedBot: (threadId) => ownedThreads.ownerOf(threadId),
    }),
    items: () => itemIndex.list({ limit: 2000 }),
    originThreads: () => services.originThreads(),
    creatorThreads: () => services.creatorThreads(),
    // Many events in a row reload open views once.
    changed: botThreadsChanged,
    log: (message) => bb.log.warn(message),
    actingBot: async (threadId) => (await acting(threadId))?.botId ?? null,
    // Where BB forked a thread: the fork's `experimental_threadForkPoint`, read by name as src/kit/quiet-turns.ts reads its hooks.
    ...(typeof forkPointHook() === "function" ? { forkPoint: (threadId: string) => forkPointHook()!(threadId) } : {}),
    // What bb is doing with the threads BB Studio mirrors: their copies here always look idle (src/mirror-live.ts).
    mirrorLive: (threadIds) => readMirrorLive(bb.server.experimental_dataDir, threadIds),
    mirrored: (since) => readMirroredSince(bb.server.experimental_dataDir, since),
    sideThreads,
    seeds: threadSeeds,
    defaultModel: (botId) => bots.defaultModel(botId),
  });
  registerContinueNew(bb, {
    conversation: (threadId) => { const rec = botThreads.store.get(threadId); return rec ? { botId: rec.botId, kind: rec.kind, isMain: rec.isMain, title: rec.title } : null; },
    thread: async (threadId) => await bb.sdk.threads.get({ threadId }).catch(() => null) as { projectId?: string | null; environmentId?: string | null } | null,
    timeline: async (threadId) => ((await bb.sdk.threads.timeline({ threadId, segmentLimit: 40 } as never)) as unknown as { rows?: { kind?: string; role?: string; messageSeq?: number; initiator?: string }[] }).rows ?? [],
    defaultModel: (botId) => bots.defaultModel(botId),
    spawn: async (request) => await bb.sdk.threads.spawn(request as never) as { id: string; projectId?: string | null },
    recordConversation: (threadId, botId) => { botThreads.store.recordConversation(threadId, botId); },
    focus: (botId) => botThreads.store.setFocus(botId),
    card: (id) => work.store.find(id),
    moveCard: (id, threadId) => work.store.move(id, threadId),
    changed: (threadId) => botThreads.threadChanged(threadId),
  });
  const onboarding = registerOnboarding(bb, { db, bots, errorText });
  // Awareness (src/live-activity.ts): what each conversation and worker is
  // doing now, the per-turn digest of the others, and bot_activity_lookup.
  const liveActivity = registerLiveActivity(bb, db, { threads: botThreads.store, actingBot: async (threadId) => (await acting(threadId))?.botId ?? null, log: (message) => bb.log.warn(message), seeds: threadSeeds });
  // Finishing a conversation (src/bot-finish.ts): its summary to memory, Main gets the card, then archived.
  const botFinish = registerBotFinish(bb, {
    db, threads: botThreads.store, mainOf: (botId) => bots.stored(botId)?.threadId ?? null,
    isBotThread: (threadId) => bots.list().some((bot) => bots.chain(bot.id).includes(threadId)),
    memory: {
      add: ({ botId, topic, text, threadId, title }) => { memoryService.store.add({ botId, topic, text, source: { kind: "conversation", id: threadId, title, section: null } }); },
      count: (botId, threadId, since) => (db.prepare("SELECT COUNT(*) AS n FROM memory_records WHERE bot_id = ? AND source_id = ? AND created_at >= ?").get(botId, threadId, since ?? 0) as { n: number }).n,
    },
    changed: botThreadsChanged,
    log: (message) => bb.log.warn(message),
  });
  const botThreadsStart = setTimeout(() => void botThreads.start().then(() => liveActivity.start()).catch((error) => bb.log.warn(`Conversations and workers start: ${errorText(error)}`)), 5_000);
  bb.onDispose(() => clearTimeout(botThreadsStart));
  triggers.every("bot-threads", 2 * 60_000, () => botThreads.reconcile());
  triggers.every("mirror-catch-up", 60_000, () => void botThreads.catchUp());
  triggers.every("bot-finish", 60_000, () => botFinish.finish.sweep());
  /** A Studio bot's id for its learning settings (the primary without one). */
  const pageState = new BotPageState(db);
  const pageBotId = (botId?: string) => { const bot = bots.stored(botId); if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first."); return bot.id; };
  const pageStateView = (botId: string) => ({ groupNames: pageState.groupNames(botId), dismissed: pageState.dismissed(botId) });
  const learnerId = (botId?: string) => { const bot = bots.stored(botId); if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first."); bots.requireStudio(bot.id, "skill learning"); return bot.id; };
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => void learning.idle(thread, lastAssistantText).catch((error) => bb.log.warn(`Skill learning: ${errorText(error)}`)));
  // A cache-warming ping isn't a new turn by the user: it leaves a running review alone.
  bb.events.on("thread.active", ({ thread }) => { if (!warmer.pinging(thread.id)) void learning.active(thread.id).catch(() => {}); });
  bb.events.on("thread.failed", ({ thread, error }) => void learning.failed(thread.id, error).catch(() => {}));
  // Watchers' findings and end dates, once a minute; Maintenance and stuck reviews too.
  void runners.checkMachines().catch(error => bb.log.warn(`Runner machines: ${errorText(error)}`));
  void runners.retryCleanup();
  triggers.every("automations", 60_000, () => {
    if (!hostEvents.listening) void runners.checkMachines().catch(error => bb.log.warn(`Runner machines: ${errorText(error)}`));
    void runners.retryCleanup();
    void automations.tick().catch((error) => bb.log.warn(`Automations tick failed: ${errorText(error)}`));
    void maintenance.tick().catch((error) => bb.log.warn(`Maintenance tick failed: ${errorText(error)}`));
    void learning.tick().catch((error) => bb.log.warn(`Skill learning tick failed: ${errorText(error)}`));
  });
  // Moves Spaces' leads to projects, retires old heartbeat automations and turns
  // migrated heartbeats back on; whatever fails is retried next startup.
  // It waits for the move to Studio's scheduler (below), which reads the same rows.
  const leadsReady = () => projectLeads.finishMoves()
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

  /**
   * Starred items, newest-starred first, with their current titles. An item
   * whose add-on is down keeps its star but isn't listed until it's back.
   */
  const starredItems = async (): Promise<StarredItemView[]> => {
    const refs = stars.list();
    if (!refs.length) return [];
    const providers = await hub.providers();
    const kindIcons = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.icon])));
    const items = (await Promise.all([...new Set(refs.map((ref) => ref.pluginId))].map((pluginId) =>
      hub.get(pluginId, refs.filter((ref) => ref.pluginId === pluginId).map((ref) => ref.id)).catch(() => []),
    ))).flat();
    const byKey = new Map(items.map((item) => [`${item.pluginId}:${item.id}`, item]));
    return refs.flatMap((ref) => {
      const item = byKey.get(`${ref.pluginId}:${ref.id}`);
      if (!item) return [];
      return [{ pluginId: item.pluginId, id: item.id, title: untitled(item.title), icon: item.icon, kind: item.kind, kindIcon: kindIcons.get(`${item.pluginId}:${item.kind}`) ?? "File", href: item.href, projectId: item.projectId, starredAt: ref.starredAt }];
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
  // Studio's rows on the side panel's New Tab page (src/newtab.ts): every kind of the tab kinds registry the server can list.
  const NEW_TAB_ITEM_KINDS = ITEM_KINDS.map((each) => each.tabKind as string);
  const itemKindsOf = (kinds: readonly TabKindId[]) => ITEM_KINDS.filter((each) => kinds.includes(each.id)).map((each) => each.tabKind as string);
  const itemRows = (hits: readonly SearchHit[]) => hits.map((hit) => ({ id: hit.ref.id, title: hit.title, updatedAt: hit.updatedAt }));
  const botThreadRows = async (records: readonly { threadId: string; kind: "conversation" | "worker"; title: string | null; updatedAt: number }[]) => {
    const titles = await threadTitles.titles(records.filter((rec) => !rec.title?.trim()).map((rec) => rec.threadId));
    return records.map((rec) => ({ threadId: rec.threadId, kind: rec.kind, title: rec.title?.trim() || titles.get(rec.threadId) || "", updatedAt: rec.updatedAt }));
  };
  const visualChatBoards = async () => (await bb.sdk.plugins.callRpc({
    pluginId: VISUAL_CHAT_PLUGIN_ID, method: "canvas.list", input: null as never,
    outputSchema: z.object({ canvases: z.array(z.object({ threadId: z.string(), title: z.string(), updatedAt: z.number() })) }),
  })).canvases;
  const botRows = () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, updatedAt: bot.updatedAt ?? 0 }));
  const automationTableFor = async (botId?: string) => {
    const bot = bots.stored(botId);
    if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first.");
    const all = bots.list();
    const dataDir = bb.server.experimental_dataDir;
    const overview = await bb.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null as never, outputSchema: z.unknown() }).then((value) => ({ value }), () => null);
    const scheduleStatus = (id: string) => { const key = scheduleKey(id); if (!key || !scheduler.has(key)) return null; const status = scheduler.status(key); return { lastRunAt: status.lastRunAt, lastRunStatus: status.lastRunStatus }; };
    return automationTable({
      botId: bot.id, primaryBotId: bots.primaryId(), bots: all,
      studio: [...automations.builtinEntries(bot.id), ...readStudioEntries(db, scheduleStatus)],
      bb: overview ? bbFromOverview(overview.value) : bbFromFile(join(dataDir, "plugins", "automations", "data.db")),
      threadOwners: readThreadOwners(db, all.map((each) => ({ botId: each.id, threadId: each.threadId }))),
      importedAt: importedAt(), bbPlugin: overview ? "on" : "off",
    });
  };
  entryTitle = async (kind, id) => {
    if (kind === "todo") { try { return loops.store.get(id).title; } catch { return null; } }
    if (kind === "record") return memoryService.store.get(id)?.topic ?? null;
    const ref = parseAutomationRefId(id);
    if (!ref || !bots.list().some((bot) => bot.id === ref.botId)) return null;
    return (await automationTableFor(ref.botId)).rows.find((row) => row.id === ref.rowId)?.name ?? null;
  };
  const entryRows = async (query: string, limit: number): Promise<EntryRow[]> => {
    const all = bots.list();
    const todos = loops.store.all().filter((loop) => loop.closedAt === null).map((loop): EntryRow => ({ kind: "todo", id: loop.id, title: loop.title, updatedAt: loop.updatedAt }));
    const tables = await Promise.all(all.map((bot) => automationTableFor(bot.id).catch(() => null)));
    const rows = tables.flatMap((table) => (table?.rows ?? []).map((row): EntryRow => ({ kind: "automation", id: automationRefId(table!.botId, row.id), title: row.name, updatedAt: row.lastRunAt ?? 0 })));
    const found = await Promise.all(all.map((bot) => memoryService.list({ botId: bot.id, query, limit, includeReplaced: false }).catch(() => ({ records: [] }))));
    const records = found.flatMap((each) => each.records.map((record): EntryRow => ({ kind: "record", id: record.id, title: `${record.topic}: ${record.text.replace(/\s+/g, " ").slice(0, 120)}`, updatedAt: record.updatedAt })));
    return [...todos, ...rows, ...records];
  };
  const newTabSources: NewTabSources = {
    items: (limit) => itemRows(searchIndex.recent(limit, { kinds: NEW_TAB_ITEM_KINDS })),
    botThreads: async (limit) => botThreadRows(botThreads.store.recent(limit).map((rec) => ({ ...rec, updatedAt: activityOf(rec, null) }))),
    boards: visualChatBoards,
    bots: botRows,
  };
  const newTabSearchSources: NewTabSearchSources = {
    items: (query, limit) => searchIndex.search(query, { kinds: NEW_TAB_ITEM_KINDS, limit }).map((hit) => ({ row: { id: hit.ref.id, title: hit.title, updatedAt: hit.updatedAt }, score: hit.score })),
    itemsOfKinds: (kinds, limit) => kinds.length ? itemRows(searchIndex.recent(limit, { kinds: itemKindsOf(kinds) })) : [],
    botThreads: async (query, limit) => {
      const hits = await externalResults(bb, query, { kinds: ["thread"], limit: limit * 3 });
      const found = hits.flatMap((hit) => {
        const rec = botThreads.store.get(hit.ref.id);
        return rec && rec.archivedAt === null ? [{ hit, rec }] : [];
      });
      const rows = await botThreadRows(found.map(({ hit, rec }) => ({ threadId: rec.threadId, kind: rec.kind, title: rec.title ?? hit.title, updatedAt: hit.updatedAt })));
      return rows.map((row, index) => ({ row, score: found[index]!.hit.score }));
    },
    boards: visualChatBoards,
    bots: botRows,
    entries: entryRows,
  };
  // Set once hands-free voice is wired, further down.
  let voiceSearch: ((query: string, limit: number) => SearchHit[]) | null = null;
  bb.rpc.register(rpcContract, {
    overview: () => overview(),
    search: ({ query }) => contentSearch(query),
    searchStatus: () => searchIndex.status(),
    searchRetry: () => searchIndex.retry(),
    searchAll: async ({ query, kinds: named, projectId, limit }) => {
      await searchIndex.ensure();
      // "apps", "pages", "doc" and "whiteboard" name kinds too (src/item-model.ts).
      const kinds = named ? kindsNamed(named) : undefined;
      // Recent items leave out background kinds unless they're asked for; a search still finds them.
      const skip = query.trim() || kinds?.length ? [] : [...backgroundKinds(await hub.providers())];
      const studio = query.trim() ? searchIndex.search(query, { kinds, projectId, limit }) : searchIndex.recent(limit, { kinds, projectId, skip });
      const others = query.trim() ? await externalResults(bb, query, { kinds, projectId, limit }) : [];
      // Voice threads are hidden under the Bot, which BB's thread search skips: Studio finds them in their transcripts.
      const voice = query.trim() && (!kinds?.length || kinds.includes("thread")) && (projectId === undefined || projectId === PERSONAL_PROJECT_ID)
        ? (voiceSearch?.(query, limit) ?? []).filter((hit) => !others.some((other) => other.ref.id === hit.ref.id)) : [];
      return [...studio, ...others, ...voice].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit)
        .map((hit) => {
          // A thread is a conversation or a worker of a Bot: the Search panel lists them apart.
          const threadKind = hit.kind === "thread" ? botThreads.store.get(hit.ref.id)?.kind : undefined;
          return { ...hit, ...familyAndType(hit.ref.pluginId, hit.kind), ...(threadKind ? { threadKind } : {}) };
        });
    },
    newtab_recents: async ({ threadId }) => {
      await searchIndex.ensure();
      return { entries: await newTabRecents(newTabSources, { threadId }) };
    },
    newtab_search: async ({ query, threadId, limit }) => {
      await searchIndex.ensure();
      return { entries: await newTabSearch(newTabSearchSources, { query, threadId, ...(limit ? { limit } : {}) }) };
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
    starItems: ({ items, starred }) => {
      stars.set(items, starred);
      tagsChanged();
      return { ok: true };
    },
    starred: async () => ({ items: await starredItems() }),
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
    // One Bot, many conversations (src/bot-threads-server.ts) and Finish (src/bot-finish.ts).
    ...botThreads.rpc,
    ...botFinish.rpc,
    // A worker's approval as a card in its conversation (src/worker-approvals.ts).
    ...workerApprovalRpc({
      sdk: bb.sdk as never,
      title: (threadId, thread) => botThreads.store.get(threadId)?.title?.trim() || thread?.title?.trim() || thread?.titleFallback?.trim() || "A worker",
      resolved: (threadId) => { botThreads.threadChanged(threadId); botThreads.store.clearNeedsYouFrom(threadId); void nudges.settled(threadId).catch(() => {}); },
    }),
    bot_get: ({ botId }) => bots.get(botId),
    bot_create: (input) => bots.create(input),
    bot_set: (input) => bots.set(input),
    bot_set_appearance: (input) => {
      if (input.appearance && !themes.get(input.appearance.themeId)) throw new Error(`No theme ${input.appearance.themeId}.`);
      return bots.setAppearance(input);
    },
    themes_list: () => ({ themes: themeService.entries() }),
    presences_list: () => ({ presences: presenceService.entries() }),
    bot_set_presence: ({ botId, presence }) => {
      if (!presenceService.exists(presence.form)) throw new Error(`No presence ${presence.form}.`);
      return { presence: bots.setPresence({ botId, presence }) };
    },
    presence_ask: async ({ botId, prompt }) => {
      const threadId = bots.list().find((bot) => bot.id === botId)?.threadId ?? null;
      if (!threadId) return { sent: false };
      await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text: presenceAskText(prompt), mentions: [] }] } as never);
      return { sent: true };
    },
    presence_check_claim: ({ requestId }) => ({ go: presenceChecks.claim(requestId) }),
    presence_check_reply: ({ requestId, results }) => ({ ok: presenceChecks.reply(requestId, results) }),
    theme_gpu_claim: ({ requestId }) => ({ go: themeGpu.claim(requestId) }),
    theme_gpu_reply: ({ requestId, results }) => ({ ok: themeGpu.reply(requestId, results) }),
    bot_set_default_model: ({ botId, providerId, model, reasoning }) => bots.setDefaultModel({ botId, providerId, model, ...(reasoning ? { reasoning } : {}) }),
    thread_model: async ({ threadId }) => ({ model: await bots.threadModel(threadId) }),
    // Every automation of one Bot as one table (src/automation-table.ts): Studio's rows with the bb automations behind them, and bb's own attributed to a Bot.
    bot_automation_table: ({ botId }) => automationTableFor(botId),
    bot_profile_changes: ({ botId }) => ({ changes: bots.profileChanges(botId) }),
    bot_profile_revert: ({ botId, changeId }) => bots.revertChange(botId, changeId),
    bot_set_thread: ({ threadId }) => bots.setThread(threadId),
    bot_set_run: (run) => bots.setRun(run),
    bot_pause: ({ botId }) => bots.pause(botId),
    bot_resume: ({ botId }) => bots.resume(botId),
    bot_stop: ({ botId }) => bots.stop(botId),
    bot_maintenance_threads: async ({ botId }) => ({ threads: await maintenance.olderThreads(learnerId(botId)) }),
    bot_maintenance_get: ({ botId }) => maintenance.view(learnerId(botId)),
    bot_maintenance_set: ({ botId, ...patch }) => maintenance.set(learnerId(botId), patch),
    bot_maintenance_run: ({ botId, dryRun }) => maintenance.run(learnerId(botId), { dryRun }),
    bot_attention: ({ botId }) => bots.attentionView(botId),
    bot_page_state: ({ botId }) => pageStateView(pageBotId(botId)),
    bot_calendar_group_rename: ({ botId, key, name }) => { const id = pageBotId(botId); pageState.renameGroup(id, key, name, "user"); return pageStateView(id); },
    bot_run_dismiss: ({ botId, automationId, runId }) => { const id = pageBotId(botId); pageState.dismiss(id, automationId, runId); return pageStateView(id); },
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
    bot_side_threads: async ({ threadId }) => ({ chat: sideThreads.isChat(threadId) || !!botThreads.store.get(threadId), threads: await sideThreads.list(threadId) }),
    bot_side_threads_for_bot: async ({ botId }) => { const bot = bots.stored(botId); return { threads: bot ? await sideThreads.forBot(bot.id) : [] }; },
    bot_listed_threads: () => ({ threadIds: [...new Set([...ownedThreads.all(), ...sideThreads.threadIds()])] }),
    bot_side_thread_open: async ({ threadId, messageId }) => { const opened = await botThreads.messageThreads.reply({ threadId, messageId }); return { threadId: opened.threadId, created: opened.created }; },
    bot_thread_owner: async ({ threadId }) => ({ botId: ownedThreads.ownerOf(threadId) ?? runners.forThread(threadId)?.bot_id ?? await botThreads.owner(threadId) }),
    bot_thread_release: ({ threadId }) => ownedThreads.release(threadId),
    bot_welcome: onboarding.bot_welcome,
    bot_welcome_opened: onboarding.bot_welcome_opened,
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
    bot_skill_history: ({ botId, before, name }) => ({ versions: bots.skillHistory(botId, before, name) }),
    bot_skill_revert: ({ botId, versionId }) => { bots.revertSkill(versionId, botId); return { reverted: true }; },
    bot_automations: async ({ botId }) => ({ automations: await automations.list(botId) }),
    bot_automation_create: ({ botId, ...input }) => automations.create(input as never, botId),
    bot_automation_update: ({ botId, ...input }) => automations.update(input as never, botId),
    bot_automation_pause: ({ botId, id }) => automations.setState(id, "paused", botId),
    bot_automation_resume: ({ botId, id }) => automations.setState(id, "active", botId),
    bot_automation_run_now: ({ botId, id }) => automations.runNow(id, botId),
    bot_automation_delete: ({ botId, id }) => automations.delete(id, botId),
    bot_automation_runs: async ({ botId, id, limit }) => ({ runs: await automations.runs(id, botId, limit) }),
    bot_run_link: ({ botId, automationId, runId }) => automations.runLink(automationId, runId, botId),
    bot_runners: async ({ botId }) => { const [list, adoptable] = await Promise.all([runners.list(botId), runners.adoptable(botId)]); return { runners: list, adoptable }; },
    bot_runner_create: ({ botId, ...input }) => { bots.requireStudio(botId, "runners"); return runners.create(input, botId); },
    bot_runner_update: async ({ botId, ...input }) => { automations.guardRunner(input.id, botId); return runners.update(input, botId); },
    bot_runner_migrate: ({ botId, ...input }) => runners.migrate(input, botId),
    bot_runner_machines: () => runners.machines(),
    bot_runner_preflight: ({ botId, ...input }) => runners.preflight(input, botId),
    bot_runner_install_provider: ({ botId, ...input }) => runners.installProvider(input, botId),
    bot_runner_pause: async ({ botId, id }) => { automations.guardRunner(id, botId); return runners.setState(id, "paused", botId); },
    bot_runner_resume: async ({ botId, id }) => { automations.guardRunner(id, botId); return runners.setState(id, "active", botId); },
    bot_runner_run_now: async ({ botId, id }) => { automations.guardRunner(id, botId); return runners.runNow(id, botId); },
    bot_runner_delete: async ({ botId, id }) => { automations.guardRunner(id, botId); return runners.delete(id, botId); },
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
    recentThreads: async () => ({ threads: await recentThreads() }),
    studio_changed: studioChanged,
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
      // An id alone: the index says whose it is; an id it doesn't have yet is read from its prefix.
      const pluginId = "pluginId" in input ? input.pluginId : "path" in input ? null : itemIndex.get(input.id)?.pluginId ?? typeOfId(input.id)?.pluginId ?? null;
      const item = "path" in input
        ? await itemForPath(input.path)
        : pluginId ? (await hub.get(pluginId, [input.id]))[0] ?? null : null;
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
      family: ITEM_FAMILIES.map((family) => family.id as string),
      type: ITEM_TYPES.map((type) => type.type as string),
      project: ["global", ...names.projects.map((project) => project.name)],
      tag: ["none", ...names.tags.map((tag) => tag.name)],
      is: ["archived", "template", "starred"],
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
    const everything = named || options.all || (options.threadId !== undefined && (projectLeads.chiefThreadId() === options.threadId || !!bots.forThread(options.threadId) || !!botThreads.store.conversationBot(options.threadId)));
    const inScope = (item: HubItem) => everything || item.projectId === null || item.projectId === options.projectId;
    const labels = new Map(data.providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.label])));
    const text = compiled.text.toLowerCase();
    const eligible = data.items.filter((item) => inScope(item) && compiled.test(item));
    const content = compiled.text ? await contentSearch(compiled.text, eligible.map((item) => `${item.pluginId}:${item.id}`)) : null;
    const contentKeys = new Set(content?.keys);
    const picked: ListedItem[] = eligible
      .filter(
        (item) =>
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
      "List the user's BB Studio items — pages (docs, designs, whiteboards), apps (mini apps, artifacts), Talk recordings and anything else a Studio add-on provides — newest first. It lists this thread's project's items and global ones (the user's Bot, the personal project's lead, sees every project); a project: filter or allProjects lists beyond that. Each line has a link and the item's #tags, and a content match shows the text that matched; open or mention it to work with the item.",
    parameters: z.object({
      query: z
        .string()
        .max(500)
        .optional()
        .describe('Words match titles and content. Filters: family:<page|app> type:<doc|design|whiteboard|mini|artifact> kind:<kind> project:<name|global> tag:<name|none> is:archived is:template is:starred; quote names with spaces, repeat a field for any of its values, prefix - to exclude. E.g. kind:page -tag:draft project:"Q4 launch" pricing'),
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
  // A conversation of a Bot (src/bot-threads.ts) is that Bot's own thread, whichever conversation it is.
  const acting = async (threadId: string | undefined): Promise<Awaited<ReturnType<typeof bots.actingFor>>> => {
    const conversation = threadId ? botThreads.store.get(threadId) : null;
    if (conversation?.kind === "conversation" && bots.stored(conversation.botId)) return { botId: conversation.botId, via: "own" };
    return bots.actingFor(threadId, (id) => runners.forThread(id)?.bot_id);
  };
  const selfBot = async (threadId: string | undefined) => (await acting(threadId))?.botId;
  for (const tool of themeTools({
    service: themeService,
    creator: async (threadId) => { const bot = themeBot(undefined, await selfBot(threadId)); return typeof bot === "string" ? { name: "Agent", botId: null } : { name: bot.name, botId: bot.id }; },
    resolveBot: async (ref, threadId) => themeBot(ref, await selfBot(threadId)),
  })) bb.agents.registerTool(tool as never);
  for (const tool of presenceTools({
    service: presenceService,
    creator: async (threadId) => { const bot = themeBot(undefined, await selfBot(threadId)); return typeof bot === "string" ? { name: "Agent", botId: null } : { name: bot.name, botId: bot.id }; },
    resolveBot: async (ref, threadId) => themeBot(ref, await selfBot(threadId)),
  })) bb.agents.registerTool(tool as never);
  registerDesktopToolsIfEnabled(bb, process.env, async (threadId) => { const bot = themeBot(undefined, await selfBot(threadId)); return typeof bot === "string" ? "Agent" : bot.name; });
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
  registerBotProfileTools(bb, { bots, acting });
  // Hands-free voice (src/voice/live): a speech-to-speech voice agent on the
  // phone whose tools run here, relaying visibly to the Bot and threads.
  const voiceLive = new VoiceLive({
    db,
    key: () => openaiKey(settingValues),
    settings: () => settingValues,
    // The composer menu's quick settings; the returned values are current at once (onChange follows).
    saveSettings: async (values) => { settingValues = await settings.experimental_set(values); },
    cos: () => { const bot = bots.stored(); return bot ? { name: bot.name, threadId: bot.threadId ?? null } : null; },
    // The session's identity seed (src/voice/live/identity.ts): cheap sources only, read once at start.
    seed: async (threadId) => {
      const projectNames = bb.sdk.projects.list({ includePersonal: true }).then((list) => new Map((list as { id: string; name: string }[]).map((project) => [project.id, project.name]))).catch(() => new Map<string, string>());
      return gatherSeed(threadId, {
        bots: () => bots.list().map((bot) => ({ name: bot.name, role: bot.role ?? null, threadId: bot.threadId, memoryPageId: bot.memoryPageId ?? null, primary: !!bot.primary })),
        memory: (pageId) => pages.markdown(pageId) ?? null,
        leadOf: async (id) => { const lead = projectLeads.list().find((each) => each.leadThreadId === id && each.projectId !== PERSONAL_PROJECT_ID); return lead ? (await projectNames).get(lead.projectId) ?? lead.projectId : null; },
        runnerOf: (id) => { const runner = runners.forThread(id); return runner ? { name: runner.name, job: runner.job } : null; },
        thread: async (id) => {
          const thread = await bb.sdk.threads.get({ threadId: id }) as { title?: string | null; titleFallback?: string | null; projectId?: string | null };
          const projectId = thread.projectId ?? null;
          const project = projectId && projectId !== PERSONAL_PROJECT_ID ? (await projectNames).get(projectId) ?? null : null;
          return { title: thread.title || thread.titleFallback || "this thread", project };
        },
        recent: async (id) => {
          const page = await bb.sdk.threads.timeline({ threadId: id, segmentLimit: "4" } as never) as { rows?: { kind: string; role?: string; text?: string; children?: unknown[] }[] };
          const messages: SeedMessage[] = [];
          const visit = (rows: { kind: string; role?: string; text?: string; children?: unknown[] }[]) => {
            for (const row of rows) {
              if (row.kind === "conversation" && (row.role === "user" || row.role === "assistant") && row.text) messages.push({ role: row.role, text: row.text });
              if (Array.isArray(row.children)) visit(row.children as never);
            }
          };
          visit(page.rows ?? []);
          return messages;
        },
        loops: () => {
          if (!loopsEnabled()) return null;
          const groups = loops.store.groups();
          return { needsYouNow: groups.needsYouNow.map((loop) => loop.title), comingUp: groups.comingUp.map((loop) => loop.title) };
        },
      });
    },
    resolve: async (name) => {
      const bot = bots.stored();
      const projects = new Map(((await bb.sdk.projects.list({ includePersonal: true }).catch(() => [])) as { id: string; name: string }[]).map((project) => [project.id, project.name]));
      const leads = projectLeads.list().filter((lead) => lead.projectId !== PERSONAL_PROJECT_ID && lead.leadThreadId).map((lead) => ({ project: projects.get(lead.projectId) ?? lead.projectId, threadId: lead.leadThreadId! }));
      const threads = ((await bb.sdk.threads.list({ archived: false, limit: 100 }).catch(() => [])) as { id: string; title?: string | null; titleFallback?: string | null; latestAttentionAt?: number }[])
        .sort((a, b) => (b.latestAttentionAt ?? 0) - (a.latestAttentionAt ?? 0)).map((thread) => ({ id: thread.id, title: thread.title || thread.titleFallback || "" })).filter((thread) => thread.title);
      return resolveTarget(name, { cos: bot ? { name: bot.name, threadId: bot.threadId ?? null } : null, leads, threads });
    },
    latestReply: async (threadId) => {
      const [thread, output] = await Promise.all([bb.sdk.threads.get({ threadId }), bb.sdk.threads.output({ threadId })]);
      return { title: (thread as { title?: string | null }).title || threadId, text: output.output ?? "" };
    },
    loops: {
      groups: () => loops.store.groups(),
      get: (id) => loops.store.get(id),
      act: (id, action, options) => loops.act({ id, action, ...(options?.snooze ? { snooze: options.snooze as never } : {}), ...(options?.owner ? { owner: options.owner } : {}) }),
      add: (text) => loops.add(text),
      restore: (id, before) => loops.store.update(id, (before.owner ? before : { status: before.status, trigger: before.trigger }) as never),
    },
    threads: {
      stop: async (threadId) => { await bb.sdk.threads.stop({ threadId }); },
      archive: async (threadId) => { await bb.sdk.threads.archive({ threadId }); },
    },
    automations: {
      list: async () => (await automations.list()).map((each) => ({ id: each.id, name: each.name, state: each.state })),
      pause: async (id) => { await automations.setState(id, "paused"); },
      remove: async (id) => { await automations.delete(id); },
    },
    openThread: async ({ title, text, note }) => (await bb.sdk.threads.spawn({
      projectId: PERSONAL_PROJECT_ID, title,
      // As the Bot's chat: the personal project's default environment (a host one needs a host id).
      environment: { type: "project-default" },
      pluginMetadata: { voiceLive: true },
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }],
    } as never)).id,
    // Voice threads live under the Bot, like its other threads: hidden from BB's main list, in its Recent.
    claim: async (threadId) => { const bot = bots.stored(); if (bot) await ownedThreads.claim(threadId, bot.id); },
    send: ({ threadId, senderThreadId, text, note, mode }) => bb.sdk.threads.send({
      threadId, mode, ...(senderThreadId ? { senderThreadId } : {}),
      input: [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }],
    } as never).then(() => undefined),
    push: async ({ title, body, threadId, coalesceKey }) => {
      await bb.sdk.plugins.callRpc({
        pluginId: "mobile", method: "notify", outputSchema: z.unknown(),
        input: { title, body: body.slice(0, 4000), kind: "turn-finished", threadId, projectId: PERSONAL_PROJECT_ID, coalesceKey, ...botPushIds(threadId) } as never,
      });
    },
    publish: (signal) => bb.realtime.publish(VOICE_LIVE_CHANNEL, signal),
    // Started from a Canvas plugin thread, the voice edits that canvas's board while it talks,
    // through the plugin's RPCs (its own data; nothing of it lives in Studio).
    canvas: {
      tools: async (threadId) => {
        const answer = await bb.sdk.plugins.callRpc({ pluginId: CANVAS_PLUGIN_ID, method: "canvas.voice", input: { threadId }, outputSchema: canvasVoiceOutput, signal: AbortSignal.timeout(5000) });
        return { tools: answer.tools, note: answer.instructions };
      },
      run: async (threadId, name, args) => (await bb.sdk.plugins.callRpc({ pluginId: CANVAS_PLUGIN_ID, method: "canvas.voiceRun", input: { threadId, name, args: args as never }, outputSchema: canvasVoiceRunOutput, signal: AbortSignal.timeout(10_000) })).output,
    },
    // Staged BBs only: a scripted mock server stands in for OpenAI (scripts/voice-mock).
    mockUrl: () => process.env.STUDIO_VOICE_MOCK_URL?.trim() || null,
    warn: (message) => bb.log.warn(message),
  });
  registerVoiceLive(bb, voiceLive);
  registerWindowRelay(bb);
  registerGroupTool(bb, { state: pageState, acting, jobs: async (botId) => (await automations.list(botId)).map((job) => ({ id: job.id, name: job.name })) });
  voiceSearch = (query, limit) => {
    const words = tokens(query);
    return voiceLive.search(query, limit).map((hit) => ({
      ref: { pluginId: "__bb__", id: hit.threadId }, kind: "thread", title: hit.title, snippet: excerpt(hit.text, words),
      href: `/threads/${hit.threadId}`, projectId: PERSONAL_PROJECT_ID, updatedAt: hit.at, score: 1,
    }));
  };
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
  // bot_threads_list is an alias of bot_conversations now (src/bot-threads-server.ts): side threads are conversations.
  bb.agents.registerTool({
    name: "bot_activity", description: "What the user's Bot is doing: what waits on the user in its chat, threads in progress (and which wait on an answer), scheduled check-ins and automations, and recently completed threads it started.", parameters: z.object({}),
    execute: async (_input, ctx) => {
      const activity = await bots.activity(await selfBot(ctx.threadId));
      const lines = [
        ...(activity.attention ? [`Waiting on the user in your chat: ${/^\d+$/.test(activity.attention.reason) ? `${activity.attention.count} (questions, todos and unread replies)` : activity.attention.reason}`] : []),
        ...listThreads("Waiting on an answer (yours to handle, or bring to the user)", activity.inProgress.filter((each) => each.waitingFor)),
        ...listThreads("In progress", activity.inProgress.filter((each) => !each.waitingFor)),
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
    if (bot) return bot.id;
    // Any conversation of a Bot is the Bot: its skills, history and schedules work there too.
    const conversation = botThreads.store.conversationBot(threadId);
    if (conversation && bots.stored(conversation)) return conversation;
    throw new Error("Only the user's Bot has its own skills and history.");
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
    name: "skill_search",
    description: "Search your own skills by words: their names, descriptions and full text. Returns the best matches first; load one with bot_skill_view before you follow it.",
    parameters: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).optional() }),
    execute: ({ query, limit }, ctx) => {
      const hits = bots.searchSkills(query, limit ?? 5, ownBot(ctx.threadId));
      if (!hits.length) return `No skill of yours matches "${query}".`;
      return hits.map((hit, index) => `${index + 1}. ${hit.name}: ${hit.description} (matched ${hit.fields.join(", ")})${hit.snippet ? `\n   ${hit.snippet}` : ""}`).join("\n");
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
  let machineCheckTimer: ReturnType<typeof setTimeout> | null = null;
  bb.onDispose(() => { if (machineCheckTimer) clearTimeout(machineCheckTimer); });
  runnerDispatch = async context => {
    if (runners.isMovingThread(context.thread.id)) return { action: "reject", message: "Runner is moving to another machine; this run was skipped." };
    const runner = runners.forThread(context.thread.id);
    if (runner && !await runners.available(runner.id, false)) {
      // Leave core's admission lock before pausing the automation or alerting the Bot.
      if (!machineCheckTimer) machineCheckTimer = setTimeout(() => {
        machineCheckTimer = null;
        void runners.checkMachines().catch(error => bb.log.warn(`Runner machines: ${errorText(error)}`));
      }, 0);
      return { action: "reject", message: "Machine offline; this runner run was skipped." };
    }
    return null;
  };
  const describeRunner = (runner: Awaited<ReturnType<typeof runners.list>>[number]) =>
    `- ${runner.name} (${runner.id}, ${runner.state}${runner.machineName ? `, ${runner.machineName}${runner.machineOffline ? " — machine offline" : ""}` : ""}${runner.adopted ? ", adopted" : ""}): ${runner.schedule.cadence}${runner.schedule.cadence === "custom" ? ` ${runner.schedule.cron}` : ` at ${runner.schedule.time}`}${runner.nextRunAt ? `, next ${new Date(runner.nextRunAt).toLocaleString()}` : ""}. Job: ${runner.job}${runner.lastReport ? `\n  Last report (${runner.lastLevel}): ${runner.lastReport}` : ""}${runner.threadId ? `\n  Thread: /threads/${runner.threadId}` : ""}`;
  /** Schedule changes made in a conversation other than Main are noted in Main, quietly. */
  const SCHEDULE_CHANGES = new Set(["runner_create", "runner_update", "runner_migrate", "runner_pause", "runner_resume", "runner_delete", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_delete"]);
  const noteScheduleChange = async (name: string, threadId: string | undefined, botId: string, result: string) => {
    const main = bots.stored(botId)?.threadId;
    const rec = threadId ? botThreads.store.get(threadId) : null;
    if (!main || !threadId || threadId === main || rec?.kind !== "conversation") return;
    const title = (rec.title ?? (await bb.sdk.threads.get({ threadId }).then((thread) => (thread as { title?: string | null }).title ?? null, () => null)) ?? "another conversation").replace(/[[\]]/g, "");
    const first = result.split("\n").find((line) => line.trim() && !/^Made/.test(line)) ?? result;
    await alertBot(bb.sdk, {
      botThreadId: main,
      line: `🗓 ${name.replace(/_/g, " ")} from [${title}](/threads/${threadId}): ${first.replace(/^- /, "").slice(0, 300)}`,
      note: "A schedule change you made in another conversation, noted here so Main has every schedule change. Don't reply or act on it; reply exactly [PASS].",
    }).catch((error) => bb.log.warn(`Noting a schedule change in Main failed: ${errorText(error)}`));
  };
  const runnerTool = (name: string, description: string, parameters: z.ZodObject, execute: (input: never, botId: string) => Promise<string>) =>
    bb.agents.registerTool({ name, description, parameters, execute: async (input, ctx) => {
      try {
        const botId = ownBot(ctx.threadId);
        const result = await execute(input as never, botId);
        if (SCHEDULE_CHANGES.has(name) && !result.startsWith("{")) void noteScheduleChange(name, ctx.threadId, botId, result);
        return result;
      } catch (error) { if (error instanceof RunnerPreflightError) return JSON.stringify({ warnings: error.warnings, blocked: error.blocked, confirmRequired: !error.blocked }); throw error; }
    } });
  runnerTool("runner_create", "Make a runner: a long-lived thread that does a recurring job on its own schedule and stays quiet unless it has something to report (it tells you or the user through runner_report). Use it when a task becomes recurring, so your chat stays for the user. Its first run starts now.",
    z.object({ name: z.string().trim().min(1).max(60), job: z.string().trim().min(1).max(2000).describe("A short instruction: what to check or do each run, and what counts as worth reporting"), schedule: scheduleParam, machine: z.string().nullable().optional(), confirm: z.boolean().optional() }),
    async (input: { name: string; job: string; schedule: z.infer<typeof scheduleParam>; machine?: string | null; confirm?: boolean }, botId) => `Made the runner:\n${describeRunner(await runners.create({ ...input, schedule: parseSchedule(input.schedule) }, botId))}`);
  runnerTool("runner_update", "Change a runner's name, job or schedule.",
    z.object({ id: z.string().min(1).describe("Runner id or name"), name: z.string().trim().min(1).max(60).optional(), job: z.string().trim().min(1).max(2000).optional(), schedule: scheduleParam.optional(), machine: z.string().nullable().optional(), confirm: z.boolean().optional() }),
    async (input: { id: string; name?: string; job?: string; schedule?: z.infer<typeof scheduleParam>; machine?: string | null; confirm?: boolean }, botId) => describeRunner(await runners.update({ ...input, schedule: input.schedule ? parseSchedule(input.schedule) : undefined }, botId)));
  runnerTool("runner_migrate", "Move a runner to a machine (host id or name); null moves it to the server. Keeps its schedule and reports. Refuses during a run. Review preflight warnings and retry with confirm: true. Installation and sign-in on the target are required.",
    z.object({ id: z.string().min(1), machine: z.string().nullable(), confirm: z.boolean().optional() }),
    async (input: { id: string; machine: string | null; confirm?: boolean }, botId) => describeRunner(await runners.migrate(input, botId)));
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
  runnerTool("automation_create", "Schedule something for yourself. kind checkin: wakes your thread on a schedule with an instruction. reminder: once, with schedule.at or schedule.in (\"tomorrow 9:00 remind me…\", \"in 2h check the deploy\"); with Todos on it becomes a todo you own with that time, listed on the Todos page. watcher: a script on a schedule that wakes you only when it prints something (zero tokens otherwise). runner: a recurring job in its own thread.",
    z.object({ kind: z.enum(["checkin", "reminder", "watcher", "runner"]), name: z.string().trim().min(1).max(60), ...automationFields, schedule: toolSchedule }),
    async (input: AutomationToolInput & { kind: "checkin" | "reminder" | "watcher" | "runner"; name: string }, botId) => {
      const schedule = toSchedule(input.schedule!);
      if (input.kind === "reminder" && schedule.type === "once" && loops.enabled()) {
        const bot = bots.stored(botId);
        const owner = !bot || bot.primary !== false || !bot.threadId ? "cos" : `thread:${bot.threadId}`;
        const todo = loops.store.add({ title: input.name, why: input.instruction?.trim() ?? "", owner, kind: "do", trigger: { type: "time", at: schedule.at } });
        return `Made a todo (a reminder is a todo you own): ${todo.title}, due ${new Date(schedule.at).toISOString()}, id ${todo.id}. Change it with todos_update.`;
      }
      return `Made:\n${describeAutomation(await automations.create({ kind: input.kind, name: input.name, schedule, ...automationChanges(input) } as never, botId))}`;
    });
  runnerTool("automation_update", "Change an automation's name, instruction, schedule, model or script.",
    z.object({ id: z.string().min(1).describe("Automation id or name"), name: z.string().trim().min(1).max(60).optional(), ...automationFields }),
    async (input: AutomationToolInput & { id: string }, botId) => describeAutomation(await automations.update({ id: input.id, ...automationChanges(input) } as never, botId)));
  runnerTool("automation_pause", "Pause an automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "paused", botId)));
  runnerTool("automation_resume", "Resume a paused automation.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.setState(id, "active", botId)));
  runnerTool("automation_run_now", "Run an automation now, outside its schedule.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => describeAutomation(await automations.runNow(id, botId)));
  runnerTool("automation_delete", "Delete an automation. Only when the user asks or it's no longer needed.", z.object({ id: z.string().min(1) }), async ({ id }: { id: string }, botId) => { await automations.delete(id, botId); return "Deleted."; });
  bb.agents.registerTool({
    name: "runner_report",
    description: "Report from this run. log: kept in this thread and the Bot's Activity. tell: one short line to the user in the Bot's chat. urgent: tell plus a phone push, and the Bot decides whether to bring it to the user; only when the user must act now. With nothing new, don't call it and finish without a final message.",
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
  const liveBb = createLiveBbPool(bb.server.experimental_dataDir, bb.server.loopbackBaseUrl);
  const auth = registerAuth(bb, undefined, liveBb.signIn());
  const accounts = registerAccounts(bb, db, auth, liveBb);
  const forestWeather = new ForestWeather({ kv: bb.storage.kv });
  bb.rpc.register(forestContract, {
    "theme.weather": ({ timeZone }) => forestWeather.sky(timeZone),
    "theme.weather.city": ({ city }) => forestWeather.setCity(city),
  });
  bb.rpc.register(tonightContract, {
    "theme.sky": async ({ timeZone }) => ({ place: await forestWeather.place(timeZone), previewAt: await readPreview(bb.storage.kv), view: await readView(bb.storage.kv) }),
  });
  const themeOptionStores = builtinOptionStores(bb.storage.kv);
  bb.rpc.register(themeOptionsContract, {
    "theme.options": ({ themeId }) => readThemeOptions(themeOptionStores, themeId),
    "theme.options.set": ({ themeId, id, value }) => writeThemeOption(themeOptionStores, themeId, id, value),
  });
  triggers.every("plugin-health", HEALTH_INTERVAL_MS, () => health.check().then(() => {}).catch((error) => bb.log.warn(`Plugin health check failed: ${errorText(error)}`)));
  bb.onDispose(() => { health.dispose(); });
  // Every schedule is registered by now: start the one tick.
  // First, once: check-ins, runners and reminders still on BB's automations
  // move to Studio's scheduler (src/triggers/migrate.ts). The engine starts
  // after, so nothing fires half-moved; it starts even when the move fails.
  void moveToScheduler({ db, sdk: bb.sdk, scheduler, leadOf: (key) => bots.threadForRunKey(key) ?? projectLeads.storedLead(key), warn: (message) => bb.log.warn(message) })
    .then((moved) => { if (moved) { bb.log.info(`Moved ${moved} schedule(s) from BB automations to Studio's scheduler.`); tagsChanged(); } })
    .catch((error) => bb.log.warn(`Moving schedules to Studio's scheduler failed; retrying next startup: ${errorText(error)}`))
    .finally(() => {
      if (disposed) return;
      triggers.start();
      void leadsReady();
      void automations.tick().catch((error) => bb.log.warn(`Automations startup failed: ${errorText(error)}`));
    });
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
      kinds: kindRowViews(routes, settings),
      frontend: frontendState(routes, settings),
    };
  };
  bb.rpc.register(kindsContract, {
    "kinds.state": () => kindsState(),
    "kinds.update": async ({ kind, on, use }) => {
      const pluginIds = rowKinds(kind).map((each) => BUILTIN_KINDS.find((builtin) => builtin.kind === each)!.pluginId);
      const before = pluginIds.map((pluginId) => builtinOn(kindSettings.current, pluginId));
      await kindSettings.update(kind, { on, use });
      for (const member of rowKinds(kind)) bb.log.info(`Studio kind ${member}: ${kindSettings.current.off.includes(member) ? "off" : "on"}, open and create with ${kindSettings.current.use[member] ?? "automatic"}.`);
      // Search drops an off kind's hits and indexes it again when it's back on.
      pluginIds.forEach((pluginId, index) => { if (before[index] !== builtinOn(kindSettings.current, pluginId)) void searchIndex.changed(pluginId).catch(() => {}); });
      changes.append(null);
      for (const pluginId of pluginIds) bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId });
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
        // A backup carries no item index: restored rows index themselves (the triggers), and this checks them.
        try { itemIndex.heal(); } catch (error) { bb.log.warn(`Item index check after restore failed: ${errorText(error)}`); }
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
      minis: { name: "Studio Mini apps", handlers: minis.backup },
    },
  });
  registerBackup(bb, backups, join(bb.server.experimental_dataDir, "plugins", STUDIO_PLUGIN_ID));
  /** A CLI path, relative to where the command ran. */
  const cliPath = (path: string, cwd: string | undefined) => (isAbsolute(path) ? path : resolvePath(cwd ?? homedir(), path));

  bb.cli.register({
    name: "studio",
    summary: "BB Studio: pages, recordings, drawings, designs, artifacts and other add-ons' items",
    commands: [
      { name: "settings", summary: "List, read and change Studio's settings (API keys: bb plugin config studio)", usage: SETTINGS_USAGE },
      { name: "decisions", summary: "Jev, fallback model and Smart Queue", usage: "bb studio decisions <status|recent|classify|check|fallback>" },
      { name: "list", summary: "List items in the current project and global ones", usage: "bb studio list [query…] [--all] [--json], e.g. bb studio list kind:page -tag:draft pricing, or family:app for every app" },
      { name: "tags", summary: "List tags and how many items have each", usage: "bb studio tags" },
      { name: "starred", summary: "List starred items, newest-starred first", usage: "bb studio starred [--json]" },
      { name: "move", summary: "Move items to a project", usage: "bb studio move <item-link|plugin:id>… --project <name|id|global>" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
      { name: "health", summary: "Check every plugin for setup problems and failures", usage: "bb studio health [--json]" },
      { name: "auth", summary: "Show signed-out providers and Account Pooler accounts, and sign in again", usage: AUTH_USAGE },
      { name: "accounts", summary: "Every Account Pooler account (BB Studio's and bb's) and local login: status, quota, pinned threads and warnings", usage: ACCOUNTS_USAGE },
      { name: "setup", summary: "Show which BB Studio add-ons are installed and working, and the commands to finish setup", usage: "bb studio setup [--json]" },
      { name: "reindex", summary: "Rebuild the Studio search index", usage: "bb studio reindex" },
      { name: "backup", summary: "Save every Studio item, from every add-on, into one .zip file", usage: "bb studio backup [--out <file|folder>]" },
      { name: "restore", summary: "Restore a Studio backup; shows what would change first", usage: "bb studio restore <file> [--dry-run | --yes]" },
      { name: "artifacts", summary: "Save and read artifacts: save, list, show, export, delete", usage: "bb studio artifacts <save|list|show|export|delete> …" },
      { name: "whiteboards", summary: "Create, read and edit whiteboards (old name: drawings)", usage: "bb studio whiteboards <list|create|show|rename|delete|merge|remove-elements> …" },
      { name: "designs", summary: "List and read designs: list, show, html, rename, delete", usage: "bb studio designs <list|show|html|rename|delete> …" },
      { name: "recordings", summary: "Read Talk recordings and their transcripts: list, show, transcript, notes", usage: "bb studio recordings <list|show|transcript|notes> …" },
      { name: "pages", summary: "Read and write pages: list, show, create, append; explore stats for the Next row", usage: "bb studio pages <list|show|create|append|explore> …" },
      { name: "minis", summary: "List mini apps, read their records and state, and run their actions", usage: "bb studio minis <list|show|data|state|watch|actions|do> …" },
      { name: "theme", summary: "List, show, check, create, update, apply and delete Bot themes", usage: "bb studio theme <list|show|create|update|apply|check|delete|template> …" },
      { name: "presence", summary: "List, show, check, create, update, apply and delete Bot presences", usage: "bb studio presence <list|show|create|update|apply|check|delete|template> …" },
      { name: "work", summary: "Live work cards: create one, update it in place, show and list a conversation's In flight cards", usage: "bb studio work <create|update|show|list> …" },
    ],
    async run(argv, ctx) {
      // Built-in kinds' commands (`bb artifacts …` before the merge).
      if (argv[0] === "settings") return settingsCli(argv.slice(1), studioSettings);
      if (argv[0] === "decisions") return decisions.cli(argv.slice(1));
      if (argv[0] === "auth") return authCli(argv.slice(1), auth, { signal: ctx.signal });
      if (argv[0] === "accounts") return accountsCli(argv.slice(1), { accounts: accounts.service, auth }, { signal: ctx.signal });
      if (argv[0] === "artifacts") return artifacts.cli(argv.slice(1), ctx);
      // `drawings` is the old name of `whiteboards`; both stay.
      if (argv[0] === "whiteboards" || argv[0] === "drawings") return drawings.cli(argv.slice(1), ctx);
      if (argv[0] === "designs") return designs.cli(argv.slice(1), ctx);
      if (argv[0] === "minis") return minis.cli(argv.slice(1));
      if (argv[0] === "recordings") return recordings.cli(argv.slice(1));
      if (argv[0] === "presence") return runPresenceCli(argv.slice(1), { service: presenceService, readFile: (path) => readTextFile(cliPath(path, ctx.cwd), "utf8"), resolveBot: async (ref) => themeBot(ref, await selfBot(ctx.threadId ?? undefined)) });
      if (argv[0] === "theme") return runThemeCli(argv.slice(1), { service: themeService, readFile: (path) => readTextFile(cliPath(path, ctx.cwd), "utf8"), resolveBot: async (ref) => themeBot(ref, await selfBot(ctx.threadId ?? undefined)), weather: { sky: () => forestWeather.sky(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null), setCity: (city) => forestWeather.setCity(city) }, sky: { place: () => forestWeather.place(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null), preview: () => readPreview(bb.storage.kv), setPreview: (at) => writePreview(bb.storage.kv, at), view: () => readView(bb.storage.kv), setView: (view) => writeView(bb.storage.kv, view), now: () => Date.now(), zoneOffsetMinutes: () => -new Date().getTimezoneOffset() } });
      if (argv[0] === "work") return runWorkCli(argv.slice(1), work, ctx);
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
        starred: { flags: ["--json"] },
        health: { flags: ["--json"] },
        setup: { flags: ["--json"] },
        move: { options: ["--project"] },
        backup: { options: ["--out"] },
        restore: { flags: ["--dry-run", "--yes"] },
      };
      const parsed = parseCliArgs(raw, SPECS[command ?? ""] ?? {});
      const known = ["list", "tags", "starred", "move", "providers", "health", "setup", "reindex", "backup", "restore"].includes(command ?? "");
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
          case "starred": {
            const starred = await starredItems();
            if (flag("--json")) return { exitCode: 0, stdout: `${JSON.stringify(starred, null, 2)}\n` };
            if (!starred.length) return { exitCode: 0, stdout: "No starred items. Star one from its header or its row's menu.\n" };
            return { exitCode: 0, stdout: `${starred.map((item) => `${item.icon ? `${item.icon} ` : ""}${item.title} (${item.kind}, starred ${relativeTime(item.starredAt)}) ${item.href}`).join("\n")}\n` };
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
            return usage("bb studio <list|tags|starred|move|providers|health|setup|reindex|backup|restore|pages|artifacts|whiteboards|designs|recordings|minis|theme|presence|decisions|work> …");
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}
