import { registerBotSkillTools } from "./src/server/skill-tools";
import { registerBotTools } from "./src/server/bot-tools";
import { registerScheduleTools } from "./src/server/schedule-tools";
import { registerCollectionTools } from "./src/server/collection-tools";
import { registerListTools } from "./src/server/list-tools";
import { setupVoiceLive } from "./src/server/voice-live";
import { registerPlatformRpcs } from "./src/server/platform-rpcs";
import { registerStudioCli } from "./src/server/cli";
import { registerStudioRpc } from "./src/server/rpc";
import { setupHubWiring } from "./src/server/hub-wiring";
import { registerWorkCards } from "./src/work/register";
import { STRAND_NOTE_TOOL } from "./src/strands/contract";
import { phoneActs, registerUserTasks } from "./src/tasks/user";
import { registerTasks } from "./src/tasks/register";
import { adoptAtStart } from "./src/tasks/migrate";
import { retireAgentTasks } from "./src/tasks/retire";
import { asFact, linkAtStart, listThreadFacts, ThreadDirectory } from "./src/tasks/links";
import { SpawnLinks } from "./src/tasks/spawn";
import { AutomationTasks, readSources } from "./src/tasks/automations";
import { areaItemRef, Areas, leadsFrom, ownNameWords, runnersFrom, type AreaLead } from "./src/areas/areas";
import { rpcErrorStatus } from "./src/kit/server/index";
import { AreaStore } from "./src/areas/store";
import { AREA_TOOLS, registerAreas } from "./src/areas/register";
import { assertTasksReady, cardNeedsUser, TaskStore, taskTitle, tasksUnavailable } from "./src/tasks/store";
import { withToolLabel } from "./src/tool-labels";
import { CONTINUE_TOOL, registerContinueNew } from "./src/continue-new";
import { registerLoops } from './src/loops/register';
import { scheduledContract, scheduledItems } from "./src/loops/scheduled";
import { automationTable, bbFromFile, bbFromOverview, readImportedAt, readStudioEntries, readThreadOwners } from "./src/automation-table";
import { arrangeRailOnce } from "./src/rail-arrangement";
import { arrangeFooterOnce } from "./src/footer-arrangement";
import { retireLegacyThemeOnce } from "./src/theme/legacy-theme";
import { indexItem } from "./src/kit/server/studio-index";
import { CODE_TOOLS, registerCode } from "./src/code/server";
import { registerWorkbenchAgent, WORKBENCH_TOOLS } from "./src/workbench-agent/server";
import { cutOffByHost, listenForHostEvents } from "./src/kit/host-events";
import { registerThreadExportHook } from "./src/thread-export-hook";
import { createSkillsRegistryGate } from "./src/skills-registry";
import { skillsRegistryContract } from "./src/skills-registry-contract";
import { hostApproval } from "./src/kit/host-approval";
import { registerQuietTurnClassifier } from "./src/kit/quiet-turns";
import { pushLevels, quietByDefault, repliesAllowed } from "./src/push-levels";
import { fromAnotherThread, MainPushes } from "./src/main-push";
import { STRAND_PUSH_ACTIVE_MS, STRAND_PUSH_EVERY_MS, STRAND_PUSH_KEY, StrandPushes } from "./src/strands/push";
import { registerDecisions } from "./src/decisions/server";
import { registerToolGateway, type ToolGateway } from "./src/tool-gateway/server/register";
import { sessionTitlePrefix } from "./src/decisions/server/classifier";
import { ON_DEMAND_EXTRAS, scopeEntries, scopeTools, trioInstructions, type Scope, type ScopeKind } from "./src/tool-scope";
import { registerScopedTools, ScopeMemory } from "./src/tool-scope-tools";
import { slim, slimmedIfSmaller } from "./src/slim-schema";
import { createMergedShownCache, INTERNAL_RENAMES, mergedTools, presentScope } from "./src/merged-tools";
import { LeanStore, leanFor } from "./src/context-lean";
import { isAcpAgent, noteCatalog, refreshProviderFamilies } from "./src/provider-family";
import { ToolDeliveryStore } from "./src/tool-delivery";
import { createMoveProvider } from "./src/move-provider/register";
import { contextLeanContract } from "./src/context-lean-contract";
import { requireAppWindow } from "./src/tool-gateway/server/caller";
import { registerRouter } from "./src/router/register";
import { BotMaintenance } from "./src/bot-maintenance";
import { registerChat } from "./src/chat/server";
import { ARTIFACT_TOOLS, registerArtifacts } from "./src/artifacts/server";
import { DRAW_TOOLS, moveOrphanDrawings, registerDraw } from "./src/draw/server";
import { DESIGN_TOOLS, registerDesign } from "./src/design/server";
import { registerDashboards } from "./src/dashboards/server";
import { MINI_TOOLS, registerMinis } from "./src/minis/server";
import { displayTitle as artifactTitle, versionType as artifactVersionType } from "./src/artifacts/server/store";
import { FILE_KIND_LABELS, isArtifactId } from "./src/artifacts/shared";
import { registerTalk, TALK_TOOLS, type TalkSettingsHandle } from "./src/talk/server";
import { PAGE_TOOLS, registerPages } from "./src/pages/server";
import { registerExploreBuiltin } from "./src/explore/server";
import { importReactionsSettings } from "./src/reactions/server";
import { builtinItemAt } from "./src/builtins";
import { BUILTIN_KINDS, builtinOn, KindSettingsStore, resolveKinds, routeProviders, routingInstructions, type KindRoute } from "./src/kinds";
import { registerSettings } from "./src/settings/register";
import { loopTimeZone } from "./src/settings/constants";
import { STUDIO_SETTINGS } from "./src/settings/schema";
import { registerWindowRelay } from "./src/windows/server";
import { isCanvasThreadOrigin } from "./src/voice/live/canvas-plugin";
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
import { experimental_PluginRpcRefusal } from "@get-bb/plugin-sdk";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "./src/kit/contract";
import { untitled } from "./src/kit/format";
import { z } from "zod";
import { type SidebarView, type StarredItemView, type TabView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { ChangeLog } from "./src/changes";
import { isPanelVisible } from "./src/sidebar";
import { TriggerEngine } from "./src/triggers/engine";
import { EngineScheduler, scheduleKey } from "./src/triggers/scheduler";
import { moveToScheduler } from "./src/triggers/migrate";
import { MIGRATIONS } from "./src/migrations";
import { ItemIndex } from "./src/item-index";
import { ITEM_TYPES, itemType, type ItemType } from "./src/item-model";
import { APP_TOOLS, appTools, familyTool, ToolBook, type AgentTool } from "./src/family-tools";
import { MemoryService, withMemory } from "./src/memory/service";
import { registerMemory } from "./src/memory/register";
import { ALWAYS_ON_CAP } from "./src/core-skill";
import { BotPageState, registerGroupTool } from "./src/bot-page-state";
import { BotCacheWarmer } from "./src/bot-cache";
import { Bots, MAIN_HEAL_MS } from "./src/bot";
import { ThemeStore } from "./src/theme/store";
import { ThemeService } from "./src/theme/service";
import { ThemeGpuRouter } from "./src/theme/gpu-server";
import { THEME_GPU_CHANNEL } from "./src/theme/gpu";
import { THEME_TOOLS } from "./src/theme/agent-tools";
import { PresenceStore } from "./src/presence/store";
import { PresenceService } from "./src/presence/service";
import { PRESENCE_CHECK_CHANNEL, PresenceCheckRouter } from "./src/presence/check-router";
import { PRESENCE_TOOLS } from "./src/presence/agent-tools";
import { SideThreads } from "./src/bot-side-threads";
import { alertBot, Runners } from "./src/runners";
import { ensureColumns, ensureTables } from "./src/schema-columns";
import { nudgeReason, BotNudges, type NudgeOwner } from "./src/bot-nudge";

/** The note on a "stopped after failing" line in a Bot's chat: the Bot triages it (docs/needs-you/REDO.md). */
const STOPPED_NOTE = "Studio notice: something you own stopped after failing. You decide what the user sees: if you can fix it (resume it, retry it), do. If the user must act, tell them in one or two short lines what stopped and what to do. If it needs nothing from them, reply exactly [PASS].";
/** A Studio alert line the user reads as is: the Bot doesn't answer it. */
const STUDIO_LINE_NOTE = "Studio notice, already shown to the user as is. Don't reply or acknowledge it; reply exactly [PASS].";
import { AutoResume, type ResumeTarget } from "./src/auto-resume";
import { ThreadResume, type ThreadOwner } from "./src/thread-resume";
import { BotOwnedThreads } from "./src/bot-owned";
import { recordingFiles, registerBotThreads } from "./src/bot-threads-server";
import { BotSignal, type BotChange } from "./src/bot-signal";
import { BOT_THREADS_CHANNEL } from "./src/bot-threads-contract";
import { readMirroredSince, readMirrorLive } from "./src/mirror-live";
import { registerLiveActivity } from "./src/live-activity";
import { ThreadSeeds } from "./src/thread-seeds";
import { MoveHandoffs } from "./src/provider-move/handoff";
import { moveProviderContract } from "./src/provider-move/contract";
import { registerBotFinish } from "./src/bot-finish";
import { askModel } from "./src/kit/decisions";
import type { ModelSelection } from "./src/decisions/contract";
import { studioInstructions } from "./src/agent-instructions";
import { activityOf, conversationInstructions, conversationTitle, workerStatus } from "./src/bot-threads";
import { registerStrands } from "./src/strands/register";
import { STUDIO_KEY_SETTINGS } from "./src/settings/keys";
import { VISUAL_CHAT_PLUGIN_ID, type EntryRow, type NewTabSearchSources, type NewTabSources } from "./src/newtab";
import { automationRefId, parseAutomationRefId } from "./src/automation-table-contract";
import { ITEM_KINDS, type TabKindId } from "./src/tab-kinds";
import { Automations } from "./src/automations";
import { REVIEW_TOOLS, SkillLearning } from "./src/skill-learning";
import { itemAtPath } from "./src/tabs";
import { TagStore, type ItemRef } from "./src/tags";
import { planMove } from "./src/move-items";
import { withTagHint } from "./src/create-tag-hint";
import type { SearchHit } from "./src/search-index";
import { externalResults } from "./src/search-external";
import { StudioServices } from "./src/services";
import { PERSONAL_PROJECT_ID, ProjectLeads } from "./src/project-lead";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";

import { HEALTH_REALTIME_CHANNEL, healthSchemas } from "./src/kit/health";
import { HealthMonitor } from "./src/health";
import { healthContract } from "./src/health-contract";
import { registerAuth } from "./src/auth/register";
import { createLiveBbPool, registerAccounts } from "./src/accounts/register";
import { registerOnboarding } from "./src/onboarding-register";
import { claimFirstLoad, finishStudioImport } from "./src/studio-data/start";
import { studioDataStatus } from "./src/studio-data/preview";
import { studioDataContract } from "./src/studio-data/contract";

const WORKER_LEVELS_KEY = "push-levels:workers-input-only";

/** How often Studio re-checks plugin health on its own. */
const HEALTH_INTERVAL_MS = 3 * 60_000;

export default async function plugin(bb: BbPluginApi) {
  // "Bring over BB Studio data" from bb is applied here, before Studio opens
  // its database (src/studio-data/start.ts). A failure leaves the journal for
  // the next start and this install's data as it was.
  await finishStudioImport({ dataDir: bb.server.experimental_dataDir, kv: bb.storage.kv, migrate: (database, statements) => bb.storage.migrate(database, statements), migrations: MIGRATIONS, log: bb.log, firstLoad: claimFirstLoad(), threads: { archive: (threadId) => bb.sdk.threads.archive({ threadId }), unarchive: (threadId) => bb.sdk.threads.unarchive({ threadId }) } })
    .catch((error) => bb.log.warn(`BB Studio data from bb could not be applied; this install's data is unchanged: ${errorText(error)}`));
  registerQuietTurnClassifier(bb);
  await registerChat(bb);
  const changes = new ChangeLog();
  // Built-ins can publish while registration awaits settings. Flush once the hub is ready.
  let servicesReady!: () => void;
  const ready = new Promise<void>((resolve) => { servicesReady = resolve; });
  let studioChangedFn!: (input: { pluginId: string; ids?: string[]; removed?: string[] }) => Promise<{ ok: true }>;
  const notifyBuiltin = async (pluginId: string, ids?: string[]) => {
    await ready;
    try { await studioChangedFn({ pluginId, ids }); }
    catch (error) { bb.log.warn(`Studio changes for ${pluginId} could not be recorded; retrying: ${errorText(error)}`); throw error; }
  };
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  // Tables and columns added by checking, not by index (src/schema-columns.ts).
  ensureTables(db);
  ensureColumns(db);
  adoptAtStart(db, bb.log);
  // Strands replaced tasks: open agent tasks close as "Moved to strands", after a backup (src/tasks/retire.ts).
  if (!tasksUnavailable(db)) {
    try {
      const retired = retireAgentTasks(db);
      if (retired.closed.length) bb.log.info(`Tasks: ${retired.closed.length} open agent task(s) moved to strands; backup at ${retired.backup ?? "none"}${retired.pruned.length ? `; ${retired.pruned.length} older backup(s) removed` : ""}.`);
      if (retired.backupError) bb.log.warn(`Tasks: the backup before moving agent tasks to strands failed (${retired.backupError}); nothing was closed. The next start tries again.`);
    } catch (error) { bb.log.warn(`Tasks: moving agent tasks to strands failed: ${errorText(error)}`); }
  }
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
  /** True while the merged tools register, so pages_read and code_comments register under their own names. */
  let mergedRegistration = false;
  // Internal handlers kept in toolBook for pages_* / apps_* / legacy tests, not exposed to agent sessions.
  const INTERNAL_ONLY_TOOLS = new Set(["artifacts_save", "artifacts_list", "artifacts_read", "artifacts_live", "minis_create", "minis_list", "minis_read", "minis_live", "work_card_create", "work_card_update", "work_card_get", "design_list", "design_read", "design_create", "whiteboard_list", "whiteboard_get", "whiteboard_create"]);
  bb.agents.registerTool = ((tool: Parameters<typeof registerTool>[0]) => {
    const family = familyTool(withTagHint(tool as never, () => tagNames.list().map((tag) => tag.name)) as AgentTool, familyDeps);
    // pages_read and code_comments become merged tools (src/merged-tools.ts); their own handlers stay in the book under internal names.
    const internal = INTERNAL_RENAMES[family.name] && !mergedRegistration ? INTERNAL_RENAMES[family.name]! : null;
    const named = internal ? { ...family, name: internal } : family;
    toolBook.add(named);
    if (internal || INTERNAL_ONLY_TOOLS.has(named.name)) return undefined as never;
    return registerTool(withToolLabel(named) as never);
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
  let entryTitle: (kind: "automation" | "todo", id: string) => Promise<string | null> = async () => null;
  const threadWorkspace = registerWorkbenchAgent(bb, db, {
    itemTitle: (id) => itemIndex.get(id)?.title ?? searchIndex.titleOf(id),
    // `bots` is made further down; a tool is only called once the plugin has loaded.
    botName: (id) => bots.stored(id)?.name ?? null,
    entryTitle: (kind, id) => entryTitle(kind, id),
  });
  // BB allows one message.dispatch hook per plugin; Decisions owns it and asks
  // the runner guard (assigned below, once runners exist) first.
  let runnerDispatch: (context: { thread: { id: string } }) => Promise<{ action: "reject"; message: string } | null> = async () => null;
  const decisions = await registerDecisions(bb, settings, (context) => runnerDispatch(context));
  // The model router (src/router): Auto in the pickers, rules picked by Jev, the usage-limit notice.
  // Auto reports whether its pick runs lean (Settings › Agent context); the lean settings load further down.
  const leanRef: { store: LeanStore | null } = { store: null };
  // Which providers are ACP agents (src/provider-family.ts): the router, Lean and moves ask synchronously.
  // Not awaited: BB answers `providers.list` only once every plugin has loaded, this one included.
  void refreshProviderFamilies(bb.sdk.providers, true);
  const modelRouter = await registerRouter(bb, { systemOne: decisions.ask.systemOne }, { lean: (providerId, model) => leanFor(leanRef.store?.current ?? {}, providerId, model) });
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
  bb.rpc.register(studioDataContract, {
    "studioData.status": () => studioDataStatus(bb.server.experimental_dataDir, db, MIGRATIONS),
  });
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
    threads: (ref) => services.threads(ref),
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
    version: () => changes.current(),
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
  const BOT_TOOLS = ["bot_get", "bot_profile_update", "bot_state", "bot_activity"] as const;
  /** Every conversation of a Bot gets these, Main included: the Bot's skills, history and schedules (conversations make schedules too). */
  const BOT_OWN_TOOLS = ["bot_skill_list", "bot_skill_view", "bot_skill_edit", "bot_skill_lint", "bot_history_search", "runner_migrate", "automation_list", "automation_create", "automation_update", "automation_pause", "automation_resume", "automation_run_now", "automation_delete"] as const;
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
  // Tool Gateway (src/tool-gateway): its 3 tools, only while a server this provider and project may use is approved and on.
  let toolGateway: ToolGateway | null = null;
  // Set once strands' push is up: a Tool Gateway request makes a strand need the user.
  let toolGatewayRequested = () => {};
  // Tool scope (src/tool-scope.ts): each thread kind loads its own tools; the
  // rest come on demand, natively deferred (Claude Code; Codex when BB has the
  // `defer` flag) or through studio_tool_* (other providers, and lean mode), which
  // then also reach Tool Gateway's MCP tools.
  const leanModes = new LeanStore(bb.storage.kv as never);
  leanRef.store = leanModes;
  await leanModes.load().catch((error) => bb.log.warn(`Lean context settings unreadable; using Auto: ${errorText(error)}`));
  // Tool delivery per provider (src/tool-delivery.ts): `bbs studio tool-delivery <provider> <mode>`.
  const toolDelivery = new ToolDeliveryStore(bb.storage.kv as never);
  await toolDelivery.load().catch((error) => bb.log.warn(`Tool delivery settings unreadable; using the defaults: ${errorText(error)}`));
  const scopes = new ScopeMemory();
  const deferSupported = (bb as { experimental_hooks?: { experimental_features?: { deferredAgentTools?: unknown } } }).experimental_hooks?.experimental_features?.deferredAgentTools === true;
  const slimCache = new Map<string, Record<string, unknown> | null>();
  const slimFor = (name: string): Record<string, unknown> | null => {
    if (!slimCache.has(name)) {
      let slimmed: Record<string, unknown> | null = null;
      try { slimmed = slimmedIfSmaller(toolBook.get(name)?.parameters.toJSONSchema?.()); } catch { /* Shown as registered. */ }
      slimCache.set(name, slimmed);
    }
    return slimCache.get(name)!;
  };
  const fullSchema = (name: string): Record<string, unknown> | null => {
    try { const schema = toolBook.get(name)?.parameters.toJSONSchema?.(); return schema && typeof schema === "object" ? schema as Record<string, unknown> : null; } catch { return null; }
  };
  /** A Studio Decisions classifier thread (src/decisions/server/classifier.ts): a one-shot JSON answer, no tools. */
  const isClassifier = (title: string | null | undefined) => typeof title === "string" && title.startsWith(sessionTitlePrefix);
  const isLead = (threadId: string) => { try { return projectLeads.list().some((lead) => lead.leadThreadId === threadId); } catch { return false; } };
  /** A merged tool's schema for the ops this thread may run (src/merged-tools.ts), slimmed; null for any other tool. */
  const mergedShown = createMergedShownCache({
    base: (name) => slimFor(name) ?? fullSchema(name),
    slim,
    book: toolBook as never,
  });
  /** The configure() entries for a scope in old names: merged names, each merged tool showing only the ops it may run. */
  const presentedEntries = (scope: Scope) => {
    const presented = presentScope(scope);
    // Through the search trio (or with nothing on demand), a loaded merged tool shows only its loaded ops: the
    // others still run (BB checks the full schema, and the op check allows them) and studio_tool_describe shows them.
    // Claude Code and Codex defer what isn't loaded anyway, so they see every allowed op.
    const shownOps = scope.delivery === "trio" || scope.delivery === "none" ? presented.loadedOps : presented.ops;
    const shown = {
      slim: (name: string) => mergedShown(name, shownOps.has(name) ? shownOps : presented.ops) ?? slimFor(name),
      schema: (name: string) => mergedShown(name, presented.ops) ?? slimFor(name) ?? fullSchema(name),
    };
    return { entries: scopeEntries({ ...scope, loaded: presented.loaded, onDemand: presented.onDemand }, shown), onDemand: presented.onDemand };
  };
  /** A fixed list (a skill review fork, a paused Bot): remembered as its scope, offered under the merged names. */
  const fixedTools = (context: { thread: { id: string }; provider: { id: string; model: string } }, names: readonly string[]) => {
    const scope: Scope = { kind: "worker", loaded: [...names], onDemand: [], delivery: "none", gateway: false };
    scopes.remember(context.thread.id, scope, { providerId: context.provider.id, model: context.provider.model });
    return presentedEntries(scope).entries as never;
  };
  const configureStudio = (context: Parameters<Parameters<typeof bb.agents.configure>[0]>[0]) => {
    if (Date.now() - routesCheckedAt > 30_000) void refreshRoutes();
    // A Visual Chat thread works with that plugin's canvas tools only (src/voice/live/canvas-plugin.ts).
    if (isCanvasThreadOrigin(context.origin)) return { tools: [], skills: [], instructions: "" };
    if (isClassifier(context.thread.title)) { scopes.remember(context.thread.id, { kind: "classifier", loaded: [], onDemand: [], delivery: "none", gateway: false }, { providerId: context.provider.id, model: context.provider.model }); return { tools: [], skills: [], instructions: "" }; }
    const off = new Set(kindSettings.current.off);
    const tools = BUILTIN_KINDS.filter((each) => !off.has(each.kind)).flatMap((each) => [...(KIND_TOOLS[each.kind] ?? [])]);
    // The apps family's tools, while any app type is on.
    if (ITEM_TYPES.some((each) => each.family === "app" && !off.has(each.kind))) tools.push(...APP_TOOLS);
    tools.push(...CODE_TOOLS, ...WORKBENCH_TOOLS);
    // A skill review fork (src/skill-learning.ts) gets the skill tools and the Memory page's, nothing else of Studio's.
    if (learning.review(context.thread.id) || typeof context.pluginMetadata?.botReview === "string") { const names = [...REVIEW_TOOLS, ...CODE_TOOLS]; return { tools: fixedTools(context, names), skills: ["studio-code"], instructions: "", rescope: (extra: readonly string[]) => ({ tools: fixedTools(context, [...names, ...extra]), instructions: "" }) }; }
    // The Bot's own thread is told who it is; paused or stopped, it gets no Studio tools but its own.
    // Every conversation of a Bot (src/bot-threads.ts) is that Bot: Main, a fork
    // (a side thread from "Reply in thread" included) and a thread the user
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
    if (bot && bot.state !== "active") {
      // A paused or stopped Bot: its own tools only; withMemory adds its always-on skills to the instructions.
      const names = [...BOT_TOOLS, ...CODE_TOOLS];
      const text = bots.instructions(bot);
      return { tools: fixedTools(context, names), skills: ["studio-code"], instructions: text, rescope: (extra: readonly string[]) => ({ tools: fixedTools(context, [...names, ...extra]), instructions: text }) };
    }
    // A runner is told its job and how to report; it reports with runner_report only.
    const runner = bot ? null : runners.forThread(context.thread.id, context.pluginMetadata);
    const which = bot ? conversationNote(context.thread.id) : "";
    let gateway: { tools: string[]; instructions: string } = { tools: [], instructions: "" };
    try { gateway = toolGateway?.agentConfiguration({ providerId: context.provider.id, projectId: context.project.id }) ?? gateway; } catch { /* Tool Gateway never breaks Studio's configure(). */ }
    const full = [...tools, ...BOT_TOOLS, STRAND_NOTE_TOOL, ...AREA_TOOLS, ...(bot ? [...BOT_OWN_TOOLS, ...CONVERSATION_TOOLS, ...THEME_TOOLS, ...PRESENCE_TOOLS] : []), ...(runner ? RUNNER_TOOLS : []), ...gateway.tools];
    const kind: ScopeKind = own ? "main" : runner ? "runner" : bot ? "conversation" : isLead(context.thread.id) ? "lead" : conversation?.kind === "worker" ? "worker" : "conversation";
    const lean = leanFor(leanModes.current, context.provider.id, context.provider.model);
    // Short pointers for Pages, mini apps and the Next row; their long guidance is in the studio skill (src/agent-instructions.ts).
    // strand_note is Main's, a conversation's and a lead's; a lean session lists no Studio skill, so no pointer sends it to one.
    const instructions = studioInstructions({
      bot: bot ? bots.instructions(bot, { skillsSlot: true }) : "", conversation: which, runner: runner ? runners.instructions(runner) : "",
      pages: !off.has("page"), minis: !off.has("mini"), appCards, endOfReply: explore.endOfReply(), routing: routingInstructions(kindRoutes, kindSettings.current),
      strands: kind === "main" || kind === "conversation" || kind === "lead", skills: !lean,
    });
    // `extra`: tools a wrapper adds to this session's scope (none today; src/memory/service.ts adds instructions only).
    const build = (extra: readonly string[]) => {
      const scope = scopeTools({ kind, full: [...full, ...extra], providerId: context.provider.id, lean, deferSupported, extras: kind === "runner" ? [] : ON_DEMAND_EXTRAS, delivery: toolDelivery.modeFor(context.provider.id) });
      scopes.remember(context.thread.id, scope, { providerId: context.provider.id, model: context.provider.model });
      const presented = presentedEntries(scope);
      const trio = scope.delivery === "trio" ? trioInstructions(presented.onDemand, scope.gateway) : "";
      return { tools: presented.entries as never, instructions: [instructions, scope.gateway ? "" : gateway.instructions, trio].filter(Boolean).join("\n\n").trim() };
    };
    return { ...build([]), skills: lean ? [] : ["studio-code", "studio", ...(bot ? ["themes", "presences"] : [])], rescope: build };
  };
  const configureSession = withMemory(() => memoryService, (context) => isCanvasThreadOrigin(context.origin) || isClassifier(context.thread.title) || !!learning.review(context.thread.id) || typeof context.pluginMetadata?.botReview === "string", configureStudio);
  bb.agents.configure(configureSession);
  // Settings › Agent context (src/context-lean.ts): Auto / Lean / Full per provider.
  const conversationFull = (): string[] => {
    const off = new Set(kindSettings.current.off);
    const kindTools = BUILTIN_KINDS.filter((each) => !off.has(each.kind)).flatMap((each) => [...(KIND_TOOLS[each.kind] ?? [])]);
    const apps = ITEM_TYPES.some((each) => each.family === "app" && !off.has(each.kind)) ? APP_TOOLS : [];
    return [...kindTools, ...apps, ...CODE_TOOLS, ...WORKBENCH_TOOLS, ...BOT_TOOLS, STRAND_NOTE_TOOL, ...AREA_TOOLS, ...BOT_OWN_TOOLS, ...CONVERSATION_TOOLS, ...THEME_TOOLS, ...PRESENCE_TOOLS];
  };
  const leanRows = async () => {
    let catalog: { id: string; displayName?: string; enabled?: boolean; info?: { family?: string | null } | null }[] = [];
    try { catalog = await bb.sdk.providers.catalog() as typeof catalog; noteCatalog(catalog); } catch { /* Stored rows only. */ }
    const names = new Map(catalog.filter((entry) => entry.enabled !== false).map((entry) => [entry.id, entry.displayName || entry.id]));
    for (const id of Object.keys(leanModes.current)) if (!names.has(id)) names.set(id, id);
    const count = (scope: ReturnType<typeof scopeTools>) => scope.loaded.length + (scope.delivery === "trio" ? 3 : scope.delivery === "none" ? 0 : scope.onDemand.length);
    return [...names].map(([id, name]) => {
      const full = conversationFull();
      const leanScope = scopeTools({ kind: "conversation", full, providerId: id, lean: true, deferSupported, extras: ON_DEMAND_EXTRAS });
      const fullScope = scopeTools({ kind: "conversation", full, providerId: id, lean: false, deferSupported, extras: ON_DEMAND_EXTRAS, delivery: toolDelivery.modeFor(id) });
      const fullDelivery = fullScope.delivery === "all" ? "native" as const : fullScope.delivery === "defer" ? "defer" as const : "search" as const;
      return { id, name, acp: isAcpAgent(id), mode: leanModes.current[id] ?? "auto", tools: { lean: count(leanScope), full: count(fullScope) }, fullDelivery };
    }).sort((a, b) => Number(a.acp) - Number(b.acp) || a.name.localeCompare(b.name));
  };
  bb.rpc.register(contextLeanContract, {
    "contextLean.get": async () => ({ providers: await leanRows() }),
    // Only BB Studio's own app window changes it, as with Tool Gateway (src/tool-gateway/server/caller.ts).
    "contextLean.set": async ({ providerId, mode }, context?: unknown) => {
      requireAppWindow(context);
      const rows = await leanRows();
      if (!rows.some((row) => row.id === providerId)) throw new experimental_PluginRpcRefusal({ code: "invalid", message: `No provider ${providerId}.` });
      await leanModes.set(providerId, mode);
      return { providers: await leanRows() };
    },
  });
  // Studio reloaded mid-session: the thread's scope again, from its real provider, model, title and origin,
  // through withMemory, as at session start.
  const recomputeScope = async (threadId: string, projectId: string | undefined): Promise<Scope | null> => {
    try {
      const thread = await bb.sdk.threads.get({ threadId }) as { projectId?: string; providerId?: string; model?: string | null; title?: string | null; parentThreadId?: string | null; sourceThreadId?: string | null; originKind?: string | null; originPluginId?: string | null } | null;
      if (!thread?.providerId) return null;
      configureSession({
        thread: { id: threadId, title: thread.title ?? null, parentThreadId: thread.parentThreadId ?? null, sourceThreadId: thread.sourceThreadId ?? null },
        project: { id: thread.projectId ?? projectId ?? "", kind: "regular", name: "", gitRemoteUrl: null },
        provider: { id: thread.providerId, model: thread.model ?? "", capabilities: { supportsNativeUserQuestion: false } },
        origin: { kind: thread.originKind ?? null, pluginId: thread.originPluginId ?? null }, pluginMetadata: {},
      } as never);
    } catch { return null; }
    return scopes.get(threadId) ?? null;
  };
  registerScopedTools(bb as never, {
    book: toolBook as never,
    scopes,
    schemaFor: (name, ops) => mergedShown(name, ops) ?? slimFor(name) ?? fullSchema(name) ?? {},
    recompute: recomputeScope,
  });
  /** Which conversation a Bot's session is in (src/bot-threads.ts conversationInstructions); "" before Studio has placed it. */
  const conversationNote = (threadId: string): string => {
    const rec = botThreads.store.get(threadId);
    if (!rec || rec.kind !== "conversation") return "";
    const title = (id: string) => botThreads.store.get(id)?.title ?? null;
    return conversationInstructions(rec, rec.title ?? "this conversation", rec.forkedFrom ? title(rec.forkedFrom.threadId) : null);
  };
  const {
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
  } = await setupHubWiring({
    bb,
    db,
    hub,
    changes,
    services,
    triggers,
    onStudioChangedReady: (fn) => {
      studioChangedFn = fn;
      servicesReady();
    },
  });

  // Each project's optional lead thread and its heartbeat (src/project-lead.ts).
  // The heartbeat of the personal project is the Bot's check-in, under its name.
  // A project's lead thread deleted or archived: one line in the Bot's chat with what to do, not a heartbeat that just stops.
  const leadLost = (projectId: string, why: "deleted" | "archived", heartbeatWasOn: boolean) => void (async () => {
    const bot = bots.stored();
    if (!bot?.threadId) return;
    const name = ((await bb.sdk.projects.list({ includePersonal: true }).catch(() => [])) as { id: string; name: string }[]).find((project) => project.id === projectId)?.name ?? projectId;
    await alertBot(bb.sdk, { botThreadId: bot.threadId, line: `⚠️ ${name}'s lead thread was ${why}${heartbeatWasOn ? ", so its heartbeat is off" : ""}. Pick a new lead in Studio › Setup › Project leads to turn it back on.`, note: STUDIO_LINE_NOTE });
  })().catch((error) => bb.log.warn(`Couldn't tell the Bot that ${projectId}'s lead is gone: ${errorText(error)}`));
  const projectLeads: ProjectLeads = new ProjectLeads({ db, sdk: bb.sdk, scheduler, changed: tagsChanged, personalPrompt: (): string => bots.prompt(), botPrompt: (key) => bots.promptFor(key), leadLost });
  // The user's Bot (src/bot.ts): the personal project's lead, with a name, avatar and state.
  // Its Memory page is a Studio page in the personal project; a shared skill goes to BB's user skills.
  // When the BB Studio copy's import from bb ran (null without one), read at most every 30 s.
  const importedAt = (() => { let readAt = 0, value: number | null = null; return () => { if (Date.now() - readAt > 30_000) { value = readImportedAt(bb.server.experimental_dataDir); readAt = Date.now(); } return value; }; })();
  const botSignal = new BotSignal((event) => bb.realtime.publish(BOT_THREADS_CHANNEL, event), 250);
  bb.onDispose(() => botSignal.dispose());
  const bots: Bots = new Bots({
    importedAt,
    db, sdk: bb.sdk, leads: projectLeads, changed: tagsChanged,
    presenceChanged: (botId) => botSignal.add([{ botId, kinds: ["presence"] }]),
    memory: {
      exists: (pageId) => { const page = pages.store.meta(pageId); return !!page && !page.archived_at; },
      // The old core profile page, read once to move its text into the always-on skill (src/core-skill-migrate.ts).
      markdown: (pageId) => pages.markdown(pageId),
      retitle: (pageId, from, to) => pages.retitle(pageId, from, to),
    },
    userSkillsDir: join(bb.server.experimental_dataDir, "skills"),
    providerStates: async () => { const { primaryHostId } = await bb.sdk.system.config(); return (await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined)).providers; },
    // Side threads show as their reply's row, not as work the Bot started.
    hiddenThreads: () => new Set([...learning.reviewThreads(), ...sideThreads.threadIds()]),
    ownedThreads: (botId) => ownedThreads.owned(botId),
    claimChains: () => ownedThreads.claimChains(),
    // Read when a Main moves, after the conversation records are registered below.
    mainMoved: (botId, threadId) => botThreads.store.setMain(botId, threadId),
    conversationBot: (threadId) => botThreads.store.get(threadId)?.botId ?? null,
    revive: (key) => scheduler.revive(key),
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
  const postToBot = async (text: string) => {
    const bot = bots.stored();
    // Plain words with the action: the Todos page and task tools show this as is.
    if (!bot) throw new Error('Make your Bot first; todos are posted in its chat.');
    if (bot.state !== 'active') throw new Error(`${bot.name} is ${bot.state}. Resume it (Bot settings) and todos will be posted in its chat.`);
    if (!bot.threadId) throw new Error(`${bot.name} has no Main conversation. Pick one in Bot settings (or start a new one), and todos will be posted there.`);
    await bb.sdk.threads.send({threadId:bot.threadId,mode:'auto',input:[{type:'text',text,mentions:[],visibility:'agent-only'}]} as never);
  };
  // When a strand's "needs you" push went out, by Bot: Main's own reply push stays quiet for a few minutes after it.
  const taskPushedAt = new Map<string, number>();
  const loops = registerLoops(bb, db, postToBot, () => loopTimeZone(process.env, studioSettings.current().todosTimeZone));
  // Old work cards' RPCs, for older phones. A task handed to the user doesn't push: a strand turning "needs you" does (src/strands/push.ts).
  registerWorkCards(bb, db);
  const taskThreads = new ThreadDirectory(db);
  const linkStore = new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const spawnLinks = new SpawnLinks({ store: linkStore, dir: taskThreads, thread: async (threadId) => asFact(await bb.sdk.threads.get({ threadId }).catch(() => null)), log: (message) => bb.log.warn(message) });
  const threadFacts = () => listThreadFacts(bb.sdk as never);
  registerTasks(bb, db, postToBot, undefined, undefined, { links: spawnLinks, check: async () => (await userTasks.check()).problems });
  // A request for an MCP server makes no to-do: it is "needs you" on its strand (src/strands/states.ts), which pushes once.
  toolGateway = await registerToolGateway(bb, {
    db,
    dataDir: bb.server.experimental_dataDir,
    pluginId: STUDIO_PLUGIN_ID,
    todos: {
      create: async () => { toolGatewayRequested(); return null; },
      close: async () => {},
    },
  });
  { const gateway = toolGateway; bb.onDispose(() => gateway.dispose()); }
  const userTasks = registerUserTasks(bb, db, {
    zone: () => loopTimeZone(process.env, studioSettings.current().todosTimeZone),
    dir: taskThreads,
    facts: threadFacts,
    post: postToBot,
    send: async (threadId, text) => { await bb.sdk.threads.send({threadId,mode:'auto',input:[{type:'text',text,mentions:[],visibility:'agent-only'}]} as never); },
    thread: async (threadId) => (await bb.sdk.threads.get({ threadId })) as never,
    loopAct: (x) => loops.actDirect(x),
    reopenLoop: (id) => loops.store.update(id, { status: 'surfaced' }),
    snoozeLoopUntil: (id, at) => loops.store.update(id, { status: 'snoozed', trigger: { type: 'time', at } }),
    held: () => [],
  });
  loops.routeActs(phoneActs(userTasks));
  const automationTasks = new AutomationTasks(new TaskStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); }), {
    sources: () => readSources(db, bots.list().map((bot) => ({ id: bot.id, name: bot.name, threadId: bot.threadId, heartbeatKey: bots.heartbeatKey(bot.id) }))),
    log: (message) => bb.log.warn(message),
    zone: () => loopTimeZone(process.env, studioSettings.current().todosTimeZone),
    nudge: async (threadId, text) => { await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [], visibility: "agent-only" }] } as never); },
  });
  const taskStep = <T,>(name: string, work: () => T): T | null => {
    if (tasksUnavailable(db)) return null;
    try { return work(); } catch (error) { bb.log.warn(`Automation tasks: ${name} failed: ${errorText(error)}`); return null; }
  };
  let automationSyncQueued = false;
  const syncAutomationTasks = () => {
    if (automationSyncQueued) return;
    automationSyncQueued = true;
    queueMicrotask(() => { automationSyncQueued = false; taskStep("sync", () => automationTasks.sync()); });
  };
  const automationsChanged = () => { tagsChanged(); syncAutomationTasks(); };
  scheduler.onRunStart((key, threadId) => taskStep("run start", () => automationTasks.started(key, threadId)));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => { if (taskStep("run end", () => automationTasks.settle(thread.id, lastAssistantText, "succeeded")) || runners.forThread(thread.id)) areaStep("run end", () => areas.sync()); });
  bb.events.on("thread.failed", ({ thread, error }) => { if (taskStep("run end", () => automationTasks.settle(thread.id, typeof error === "string" ? error : null, "failed")) || runners.forThread(thread.id)) areaStep("run end", () => areas.sync()); });
  // The Bot's runners (src/runners.ts): long-lived threads on their own schedules, quiet unless they report.
  const runners: Runners = new Runners({
    db, sdk: bb.sdk, scheduler, changed: automationsChanged,
    reported: (runnerId, threadId, level, summary) => { const note = taskStep("report", () => automationTasks.report(runnerId, threadId, level, summary)); areaStep("report", () => areas.reported(runnerId, level)); return note; },
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
    db, sdk: bb.sdk, scheduler, changed: automationsChanged,
    findings: (watcherId, finding, raw, at, failed) => (tasksUnavailable(db) ? null : automationTasks.watcherRun(watcherId, finding, raw, at, failed)),
    bot: automationBot,
    notify: async (botId, line) => { const bot = bots.stored(botId); if (bot?.threadId) await alertBot(bb.sdk, { botThreadId: bot.threadId, line, note: STUDIO_LINE_NOTE }); },
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
  taskStep("adopt", () => {
    const moved = automationTasks.sync({ backup: true });
    if (moved.created || moved.updated || moved.closed) bb.log.info(`Automation tasks: ${moved.created} made, ${moved.updated} updated, ${moved.closed} closed; backup at ${moved.backup ?? "none"}.`);
    if (moved.backupError) bb.log.warn(`Automation tasks: the backup before mapping failed (${moved.backupError}); mapped anyway.`);
  });
  void threadFacts().then((facts) => { taskStep("links", () => linkAtStart(linkStore, facts, taskThreads, bb.log)); }, (error) => bb.log.warn(`Task links: threads could not be listed: ${errorText(error)}`));
  // No task is made for a new worker any more (strands replaced tasks): a worker joins the strand of the turn that started it.
  const areaStore = new AreaStore(db, () => { void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); });
  const areas = new Areas(areaStore, new TaskStore(db), {
    bot: () => { const bot = bots.stored(); return bot ? { id: bot.id, name: bot.name } : null; },
    runners: () => runnersFrom(db),
    caller: (threadId) => {
      const runner = runners.forThread(threadId);
      if (runner) return { kind: "runner", runnerId: runner.id };
      const own = bots.forThread(threadId);
      if (own) return { kind: "bot", botId: own.id, main: true };
      const conversation = botThreads.store.conversationBot(threadId);
      return conversation && bots.stored(conversation) ? { kind: "bot", botId: conversation, main: false } : { kind: "thread" };
    },
    zone: () => loopTimeZone(process.env, studioSettings.current().todosTimeZone),
    leads: () => areaLeads,
    userWords: () => areaUserWords,
  });
  const areaUserWords = ownNameWords();
  let areaLeads: AreaLead[] = [];
  let areaLeadsRead = false;
  const areaStep = <T,>(name: string, work: () => T): T | null => (areaLeadsRead ? taskStep(`areas ${name}`, work) : null);
  const syncAreas = (why: string) => areaStep(why, () => { const out = areas.sync(); if (out.created.length) bb.log.info(`Areas: made ${out.created.join(", ")}.${out.problems.length ? ` Notes: ${out.problems.join("; ")}` : ""}`); return out; });
  registerAreas(bb, areas, (work) => { assertTasksReady(db); return work(); });
  const readAreaLeads = async () => {
    try {
      const projects = await bb.sdk.projects.list();
      const found = await Promise.all(leadsFrom(db, new Map(projects.map((p) => [p.id, p.name])), PERSONAL_PROJECT_ID).map(async (lead) => {
        const thread = await bb.sdk.threads.get({ threadId: lead.thread }).catch((error: unknown) => { if (rpcErrorStatus(error) === 404) return null; throw error; });
        return thread && !(thread as { archivedAt?: unknown }).archivedAt ? lead : null;
      }));
      areaLeads = found.filter((lead): lead is AreaLead => !!lead);
    } catch (error) { bb.log.warn(`Areas: leads could not be read; kept the last list: ${errorText(error)}`); }
    areaLeadsRead = true;
    syncAreas("sync");
  };
  void readAreaLeads();
  triggers.every("area-leads", 30 * 60_000, () => { void readAreaLeads(); });
  triggers.every("automation-tasks", 60_000, () => { syncAutomationTasks(); areaStep("sync", () => areas.sync()); });
  triggers.every("automation-tasks-prune", 60 * 60_000, () => { taskStep("prune", () => automationTasks.prune()); });
  bb.rpc.register(scheduledContract, {
    "loops.scheduled": async ({ threadId }) => ({
      items: scheduledItems({
        // To-dos are gone: none are listed, and a reminder is listed (and runs) as its automation.
        loops: [],
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
  // A deleted thread: its handoff, delivery note and transcript folder go (src/provider-move/handoff.ts forget).
  bb.events.on("thread.deleted", ({ thread }) => void moveHandoffs.forget(thread.id).catch(() => undefined));
  // Archived from its menu (or BB's): the Bot's lists drop it, and bring it back unarchived.
  bb.events.on("thread.archived", ({ thread }) => sideThreads.touched(thread.id));
  bb.events.on("thread.unarchived", ({ thread }) => sideThreads.touched(thread.id));
  const learning: SkillLearning = new SkillLearning({
    db, sdk: bb.sdk, changed: tagsChanged,
    bots: () => bots.list().map(learningBot),
    bot: (botId) => { const bot = bots.stored(botId); return bot ? learningBot(bot) : null; },
    conversations: (botId) => botThreads.store.conversations(botId).map((rec) => rec.threadId),
    skills: (botId) => bots.skills(botId).map((skill) => ({ name: skill.name, description: skill.description, body: bots.skill(skill.name, botId)?.body ?? "", state: skill.state ?? "active", pinned: !!skill.pinned, usedAt: skill.usedAt ?? null, updatedAt: skill.updatedAt, alwaysOn: !!skill.alwaysOn })),
    setState: (botId, name, state) => { bots.setSkillState(name, state, botId); },
    log: (message) => bb.log.warn(message),
  });
  // Memory (src/memory): each Bot's always-on skills in every conversation and worker, and the memory RPC kept for the phone.
  const memoryService: MemoryService = new MemoryService({
    bots: { list: () => bots.list() },
    alwaysOn: (botId) => bots.alwaysOnSkills(botId),
    onDemand: (botId) => bots.onDemandSkills(botId),
    // Studio's record of conversations and workers (src/bot-threads.ts) decides a thread's Bot and role first.
    botThread: (threadId) => { const rec = botThreads.store.get(threadId); return rec ? { botId: rec.botId, kind: rec.kind, isMain: rec.isMain, title: rec.title } : null; },
    sideBot: (threadId) => sideThreads.forThread(threadId)?.botId ?? null,
    ownedBot: (threadId) => bots.list().find((bot) => ownedThreads.owned(bot.id).has(threadId))?.id ?? null,
    chainBot: (threadId) => bots.list().find((bot) => bots.chain(bot.id).includes(threadId))?.id ?? null,
    ownBot: (threadId, metadata) => bots.forThread(threadId, metadata)?.id ?? null,
    runnerBot: (threadId, metadata) => runners.forThread(threadId, metadata)?.bot_id ?? null,
  });
  registerMemory(bb, {
    bot: (botId) => { const bot = botId ? bots.stored(botId) : bots.stored(); if (!bot) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first."); bots.requireStudio(bot.id, "Memory"); return { id: bot.id, name: bot.name }; },
    alwaysOn: (botId) => bots.alwaysOnSkills(botId),
    budget: (botId) => bots.skillBudget(botId),
    oldPage: (botId) => bots.memoryPage(botId),
  });
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
  // Every Studio Bot gets its always-on core skill, from its core profile page when it has one (once; src/core-skill-migrate.ts).
  const coreSkillStart = setTimeout(() => {
    if (disposed) return;
    let failed = false;
    for (const bot of bots.list()) {
      try {
        const moved = bots.ensureCore(bot.id);
        if (moved && moved.state !== "done") bb.log.info(`Always-on skill for ${bot.id}: ${moved.state} ${moved.skill} (${moved.chars} characters${moved.chars > ALWAYS_ON_CAP ? ", over the budget: kept whole" : ""}).`);
      } catch (error) { failed = true; bb.log.warn(`Always-on skill for ${bot.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    // Then, and only when every Bot's copy is in (its marker), the retired memory tables go.
    if (!failed) {
      try {
        const retired = bots.retireMemoryTables();
        if (retired?.dropped.length) bb.log.info(`Retired memory tables dropped: ${retired.dropped.join(", ")}.`);
      } catch (error) { bb.log.warn(`Dropping the retired memory tables: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }, 2_500);
  bb.onDispose(() => clearTimeout(coreSkillStart));
  const maintenance = new BotMaintenance({
    db, sdk: bb.sdk, scheduler, changed: tagsChanged,
    bots: () => bots.list(), owned: (id) => ownedThreads.owned(id), refreshOwned: () => ownedThreads.sweep(),
    memory: (id) => { const core = bots.coreSkill(id); return core ? { id: core.name, markdown: core.body, updatedAt: core.updatedAt, totalChars: bots.skillBudget(id).chars, migrated: core.migrated, askedAt: core.tidyAskedAt } : null; },
    tidyAsked: (id, now) => bots.noteCoreTidyAsked(id, now),
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
    // Work that finishes after a reload changes nothing on screen: the new instance publishes.
    if (disposed) return;
    botThreadsSignal ??= setTimeout(() => { botThreadsSignal = null; bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" }); }, 250);
    botSignal.add(changes);
  };
  // A Bot's Main deleted or archived (from anywhere: BB's menu, the CLI, a tool): a new Main
  // takes over, and its heartbeat, check-ins and runner reports go there. At startup too, and
  // when a due run finds its Main gone (the scheduler asks before it turns the run off).
  const restoreMainFailed = (error: unknown) => bb.log.warn(`Couldn't start a new Main: ${errorText(error)}`);
  const mainGone = ({ thread }: { thread: { id: string } }) => {
    const bot = bots.list().find((each) => each.threadId === thread.id);
    if (bot) void bots.heal(bot.id, thread.id, (message) => bb.log.warn(message)).catch(restoreMainFailed);
  };
  bb.events.on("thread.deleted", mainGone);
  bb.events.on("thread.archived", mainGone);
  // A run's thread is gone: a Bot's Main gets a new Main, a runner a new thread (src/runners.ts rescue).
  scheduler.onThreadGone(async (threadId) => (await bots.rescueMain(threadId)) ?? (await runners.rescue(threadId).catch(() => null)) ?? (await projectLeads.leadGone(threadId).catch(() => null)));
  // A run's thread with no model falls back on its Bot's default model (src/thread-model.ts).
  scheduler.preferModel((threadId) => { const bot = bots.forThread(threadId); return bot ? bots.defaultModel(bot.id) : bots.defaultModel(); });
  const threadSeeds = new ThreadSeeds(db);
  // Secret values scrubbed from what Studio sends or keeps (strands, the move handoff's transcript).
  const knownSecrets = async () => {
    const values = await settings.get().catch(() => ({} as Record<string, unknown>));
    const keys = Object.keys(STUDIO_KEY_SETTINGS).map((key) => values[key]).filter((value): value is string => typeof value === "string");
    return [...keys, ...(toolGateway?.secretValues() ?? [])];
  };
  // A thread moved to another provider (src/provider-move/handoff.ts): its catch-up, prepared at move
  // time by the move command and handed over on the first turn after it. The transcript goes in the
  // thread's storage folder when it's on this machine, else in Studio's own folder.
  const moveHandoffs = new MoveHandoffs({
    listEvents: async ({ threadId, afterSeq, limit, types }) => await bb.sdk.threads.events.list({ threadId, afterSeq: String(afterSeq), order: "asc", limit: String(limit), types: [...types] as unknown as NonNullable<Parameters<typeof bb.sdk.threads.events.list>[0]["types"]> }) as { seq?: number; type?: string; createdAt?: number; data?: unknown }[],
    dirFor: async (threadId) => {
      const location = await bb.sdk.threads.storageLocation({ threadId }).catch(() => null);
      const root = location?.storageRootPath;
      return root && existsSync(root) ? join(root, "studio-move", threadId) : join(dirname(db.name), "move-provider", threadId);
    },
    secrets: knownSecrets,
    kv: bb.storage.kv,
    log: (message) => bb.log.warn(message),
  });
  bb.rpc.register(moveProviderContract, {
    "moveProvider.prepare": ({ threadId, from, to, historyTokens }) => moveHandoffs.prepare(threadId, { from, to, historyTokens }),
  });
  const pushRpc = (call: Parameters<typeof bb.sdk.plugins.callRpc>[0]) => bb.sdk.plugins.callRpc(call);
  const botThreads = registerBotThreads(bb, db, {
    tabCounts: (threadIds) => threadWorkspace.store.tabCounts(threadIds),
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, avatar: bot.avatar, shape: bot.shape ?? null, color: bot.color ?? null, primary: !!bot.primary, threadId: bot.threadId, appearance: bot.appearance ?? null, presence: bots.presenceOf(bot.id), state: bot.state })),
    signals: () => ({
      bots: bots.list().map((bot) => ({ id: bot.id, threadId: bot.threadId, chain: bots.chain(bot.id) })),
      sideThread: (threadId) => sideThreads.forThread(threadId),
      runnerBot: (threadId) => runners.forThread(threadId)?.bot_id ?? null,
      leadThreads: new Set(projectLeads.list().flatMap((lead) => (lead.projectId !== PERSONAL_PROJECT_ID && lead.leadThreadId ? [lead.leadThreadId] : []))),
      internal: learning.reviewThreads(),
      managedBot: (threadId) => ownedThreads.ownerOf(threadId),
    }),
    items: () => [...itemIndex.list({ limit: 2000 }), ...(builtinOn(kindSettings.current, "talk") ? recordingFiles(recordings.store.list({ limit: 500 })) : [])],
    originThreads: () => services.originThreads(),
    creatorThreads: () => services.creatorThreads(),
    starred: () => new Set(stars.map().keys()),
    fileFormats: () => new Map(artifacts.store.list().map((artifact) => [`artifacts:${artifact.id}`, artifactVersionType(artifact.version)] as const)),
    botItems: () => new Map(bots.list().flatMap((bot) => (bot.memoryPageId ? [[`pages:${bot.memoryPageId}`, bot.id] as const] : []))),
    // Many events in a row reload open views once.
    changed: botThreadsChanged,
    // A Bot's new lead, runner or agent thread pushes only questions and errors (src/push-levels.ts).
    becameWorker: (threadId) => void quietByDefault(pushRpc, [threadId]).catch(() => null),
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
  // Areas' items that need the user, by the conversation their area reports into: a lead's own
  // conversation; a runner's, or the Bot's, the Main. Read at most every 15 seconds.
  let areaAskCache: { at: number; byThread: Map<string, { id: string; kind: "area"; label: string; at: number }[]> } | null = null;
  const areaAsks = (threadId: string) => {
    if (!areaAskCache || Date.now() - areaAskCache.at > 15_000) {
      const byThread = new Map<string, { id: string; kind: "area"; label: string; at: number }[]>();
      const primaryMain = (bots.list().find((bot) => bot.primary) ?? bots.list()[0])?.threadId ?? null;
      const list = areaLeadsRead ? taskStep("areas for strands", () => areas.list()) ?? [] : [];
      for (const area of list) {
        const home = area.owner.kind === "lead" ? area.owner.thread : area.owner.kind === "bot" ? bots.stored(area.owner.botId)?.threadId ?? null : primaryMain;
        if (!home) continue;
        const at = Math.max(area.lastRun ?? 0, area.updatedAt);
        const asks = area.open.filter((item) => item.needsUser).map((item) => ({ id: `area:${areaItemRef(area.id, item.title)}`, kind: "area" as const, label: `${area.name}: ${item.title}`, at }));
        if (asks.length) byThread.set(home, [...(byThread.get(home) ?? []), ...asks]);
      }
      areaAskCache = { at: Date.now(), byThread };
    }
    return areaAskCache.byThread.get(threadId) ?? [];
  };
  // Strands (src/strands): each turn of a Bot's conversations sorted into a line of work, with live states.
  const strands = registerStrands(bb, db, {
    richSorting: () => studioSettings.current().strands_richSorting,
    // An area's item that needs the user, and the conversation's flag (bot_needs_you): "needs you" on their strand.
    extraAsks: (threadId) => {
      const flag = botThreads.store.get(threadId)?.needsYou ?? null;
      return [...areaAsks(threadId), ...(flag ? [{ id: `flag:${threadId}:${flag.at}`, kind: "flag" as const, label: flag.reason, at: flag.at }] : [])];
    },
    conversationOfWorker: (threadId) => { const rec = botThreads.store.get(threadId); return rec?.kind === "worker" ? rec.ownerConversationId : null; },
    decisions: decisions.ask,
    conversation: (threadId) => {
      const rec = botThreads.store.get(threadId);
      return rec && rec.kind === "conversation" && !rec.archivedAt ? { botId: rec.botId, lastActiveAt: Math.max(rec.activityAt ?? 0, rec.latest?.at ?? 0, rec.createdAt) } : null;
    },
    conversationsOf: async (botId) => {
      const recs = botThreads.store.listed(botId).filter((rec) => rec.kind === "conversation" && !rec.archivedAt);
      const facts = await botThreads.store.facts(recs.map((rec) => rec.threadId)).catch(() => new Map());
      return recs.map((rec) => ({ threadId: rec.threadId, title: conversationTitle(rec, facts.get(rec.threadId)), isMain: rec.isMain, lastActiveAt: Math.max(rec.activityAt ?? 0, rec.latest?.at ?? 0, rec.createdAt) }));
    },
    workers: async (threadId) => {
      const records = botThreads.store.workersOf(threadId);
      const facts = await botThreads.store.facts(records.map((rec) => rec.threadId));
      return records.map((rec) => {
        const fact = facts.get(rec.threadId);
        const status = workerStatus(fact);
        return { threadId: rec.threadId, title: rec.title?.trim() || fact?.title?.trim() || "Worker", status, createdAt: rec.createdAt,
          endedAt: status === "done" || status === "failed" ? rec.activityAt ?? fact?.updatedAt ?? rec.updatedAt : null };
      });
    },
    scope: {
      botOf: (threadId) => botThreads.store.get(threadId)?.botId ?? bots.list().find((bot) => bot.threadId === threadId)?.id ?? null,
      mainOf: (botId) => bots.stored(botId)?.threadId ?? null,
      defaultMain: () => (bots.list().find((bot) => bot.primary) ?? bots.list()[0])?.threadId ?? null,
    },
    secrets: knownSecrets,
    log: (message) => bb.log.warn(message),
  });
  // Startup, and every 5 minutes: a Bot whose Main was deleted or archived while Studio was off, or
  // when a new Main couldn't start (no host connected yet), gets a new Main. One thread read per Bot.
  const healMains = () => void bots.restoreMains((message) => bb.log.warn(message)).catch(restoreMainFailed);
  healMains();
  triggers.every("main-heal", MAIN_HEAL_MS, healMains);
  // Workers from before that default get it once, after the first classification settles.
  const quietWorkersOnce = setTimeout(() => void (async () => {
    if (await bb.storage.kv.get(WORKER_LEVELS_KEY)) return;
    const set = await quietByDefault(pushRpc, botThreads.store.listed().flatMap((rec) => (rec.kind === "worker" ? [rec.threadId] : [])));
    if (set === null) return;
    await bb.storage.kv.set(WORKER_LEVELS_KEY, { at: Date.now(), set: set.length });
  })().catch((error) => bb.log.warn(`Worker push levels: ${errorText(error)}`)), 60_000);
  quietWorkersOnce.unref?.();
  bb.onDispose(() => clearTimeout(quietWorkersOnce));
  // Main is hidden, so BB never pushes it: Studio pushes its replies meant for the user (src/main-push.ts).
  const mainPushes = new MainPushes({
    mainOf: (threadId) => { const bot = bots.list().find((each) => each.threadId === threadId); return bot ? { botId: bot.id, name: bot.name } : null; },
    thread: (threadId) => bb.sdk.threads.get({ threadId }).catch(() => null),
    lastRequest: async (threadId) => ((await bb.sdk.threads.events.list({ threadId, types: ["client/turn/requested"], order: "desc", limit: "1" } as never)) as { data?: unknown }[])[0]?.data ?? null,
    allowed: (threadId) => repliesAllowed(pushRpc, threadId),
    notify: async (input) => { await bb.sdk.plugins.callRpc({ pluginId: "mobile", method: "notify", outputSchema: z.unknown(), input: input as never }); },
    needsUser: (card) => { const store = new TaskStore(db); return cardNeedsUser(store.find(card.id), card.kind, store.find(card.id) ? store.history(card.id) : []); },
    pushedTaskSince: (botId, since) => (taskPushedAt.get(botId) ?? 0) >= since,
    // Only a reply that needs the user pushes (src/strands/reply.ts); untagged in time, it pushes as before.
    ...(strands.service ? {
      lastRequestSeq: (threadId: string) => strands.service!.newestRequest(threadId),
      replyTag: (threadId: string, requestSeq: number | null) => strands.service!.replyPush(threadId, 20_000, requestSeq),
    } : {}),
    defaultProjectId: PERSONAL_PROJECT_ID,
    log: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => mainPushes.dispose());
  // One push when a strand turns "needs you" (src/strands/push.ts), checked a little after anything that can
  // make one need the user, and every few minutes.
  if (strands.service) {
    const service = strands.service;
    const strandPushes = new StrandPushes({
      bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name })),
      overview: (botId) => service.needsYouCheck(botId, Date.now() - STRAND_PUSH_ACTIVE_MS),
      strandThread: (strandId) => service.store.get(strandId)?.threadId ?? null,
      // BB pushes a question or approval in a thread it shows, at the thread's level; a muted thread pushes nothing at all.
      bbPushesAsks: async (threadId) => {
        const level = (await pushLevels(pushRpc, [threadId]))?.get(threadId);
        if (level && [level.own, level.cap].includes("muted")) return true;
        const thread = await bb.sdk.threads.get({ threadId }).catch(() => null) as { visibility?: string } | null;
        return !!thread && thread.visibility !== "hidden";
      },
      startedByAnotherThread: async (threadId) => fromAnotherThread(((await bb.sdk.threads.events.list({ threadId, types: ["client/turn/requested"], order: "desc", limit: "1" } as never)) as { data?: unknown }[])[0]?.data ?? null),
      projectOf: async (threadId) => ((await bb.sdk.threads.get({ threadId }).catch(() => null)) as { projectId?: string | null } | null)?.projectId ?? null,
      notify: async (input) => { await bb.sdk.plugins.callRpc({ pluginId: "mobile", method: "notify", outputSchema: z.unknown(), input: input as never }); },
      load: async () => (await bb.storage.kv.get<string[]>(STRAND_PUSH_KEY)) ?? null,
      save: async (ids) => { await bb.storage.kv.set(STRAND_PUSH_KEY, ids); },
      defaultProjectId: PERSONAL_PROJECT_ID,
      pushed: (botId) => taskPushedAt.set(botId, Date.now()),
      log: (message) => bb.log.warn(message),
    });
    bb.onDispose(() => strandPushes.dispose());
    for (const event of ["interaction.pending", "thread.idle", "thread.failed"] as const) bb.events.on(event, () => strandPushes.poke());
    triggers.every("strands-push", STRAND_PUSH_EVERY_MS, () => strandPushes.poke());
    toolGatewayRequested = () => strandPushes.poke();
  }
  bb.events.on("thread.idle", (event) => mainPushes.idle(event));
  registerContinueNew(bb, {
    conversation: (threadId) => { const rec = botThreads.store.get(threadId); return rec ? { botId: rec.botId, kind: rec.kind, isMain: rec.isMain, title: rec.title } : null; },
    thread: async (threadId) => await bb.sdk.threads.get({ threadId }).catch(() => null) as { projectId?: string | null; environmentId?: string | null; providerId?: string | null; model?: string | null } | null,
    timeline: async (threadId) => ((await bb.sdk.threads.timeline({ threadId, segmentLimit: 40 } as never)) as unknown as { rows?: { kind?: string; role?: string; messageSeq?: number; initiator?: string }[] }).rows ?? [],
    defaultModel: (botId) => bots.defaultModel(botId),
    spawn: async (request) => await bb.sdk.threads.spawn(request as never) as { id: string; projectId?: string | null },
    recordConversation: (threadId, botId) => { botThreads.store.recordConversation(threadId, botId); },
    focus: (botId) => botThreads.store.setFocus(botId),
    changed: (threadId) => botThreads.threadChanged(threadId),
  });
  const onboarding = registerOnboarding(bb, { db, bots, errorText });
  // Awareness (src/live-activity.ts): what each conversation and worker is
  // doing now, the per-turn digest of the others, and bot_activity_lookup.
  const liveActivity = registerLiveActivity(bb, db, { threads: botThreads.store, actingBot: async (threadId) => (await acting(threadId))?.botId ?? null, log: (message) => bb.log.warn(message), seeds: threadSeeds, moves: moveHandoffs });
  // Finishing a conversation (src/bot-finish.ts): its summary to memory, Main gets the card, then archived.
  const botFinish = registerBotFinish(bb, {
    db, threads: botThreads.store, mainOf: (botId) => bots.stored(botId)?.threadId ?? null,
    isBotThread: (threadId) => bots.list().some((bot) => bots.chain(bot.id).includes(threadId)),
    changed: botThreadsChanged,
    log: (message) => bb.log.warn(message),
    reviewArchived: (botId, threadId) => { learning.archived(botId, threadId); },
    providerReady: async (providerId) => {
      const { primaryHostId } = await bb.sdk.system.config();
      const state = (await bb.sdk.system.providerStates(primaryHostId ? { hostId: primaryHostId } : undefined)).providers.find((each) => each.providerId === providerId);
      return !state || state.status === "ready";
    },
    summarize: async ({ threadId, prompt }) => {
      const pick = await bots.signedInModel() as { providerId?: string; model?: string; reasoningLevel?: string };
      const { primaryHostId } = await bb.sdk.system.config();
      if (!pick.providerId || !primaryHostId) return null;
      const modelSelection = pick.model ? { providerId: pick.providerId, model: pick.model, reasoningLevel: (pick.reasoningLevel ?? null) as ModelSelection["reasoningLevel"] } : undefined;
      const result = await askModel(bb, { caller: "finish", requestId: threadId, hostId: primaryHostId, providerId: pick.providerId, prompt, ...(modelSelection ? { modelSelection } : {}) }, AbortSignal.timeout(120_000));
      return result.text;
    },
  });
  const botThreadsStart = setTimeout(() => void botThreads.start().then(() => liveActivity.start()).catch((error) => bb.log.warn(`Conversations and workers start: ${errorText(error)}`)), 5_000);
  bb.onDispose(() => clearTimeout(botThreadsStart));
  triggers.every("bot-threads", 2 * 60_000, () => botThreads.reconcile());
  triggers.every("mirror-catch-up", 60_000, () => void botThreads.catchUp().catch((error) => { if (!disposed) bb.log.warn(`Mirrored threads catch-up: ${errorText(error)}`); }));
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
  void runners.retryCleanup().catch((error) => { if (!disposed) bb.log.warn(`Runner cleanup: ${errorText(error)}`); });
  triggers.every("automations", 60_000, () => {
    if (!hostEvents.listening) void runners.checkMachines().catch(error => bb.log.warn(`Runner machines: ${errorText(error)}`));
    void runners.retryCleanup().catch((error) => { if (!disposed) bb.log.warn(`Runner cleanup: ${errorText(error)}`); });
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
  const fileKindName = (id: string) => {
    const artifact = isArtifactId(id) ? artifacts.store.get(id) : null;
    return artifact ? FILE_KIND_LABELS[artifactVersionType(artifact.version)] : null;
  };
  const itemRows = (hits: readonly SearchHit[]) => hits.map((hit) => ({ id: hit.ref.id, title: hit.title, updatedAt: hit.updatedAt, kindName: fileKindName(hit.ref.id) }));
  const botThreadRows = async (records: readonly { threadId: string; kind: "conversation" | "worker"; title: string | null; updatedAt: number; isMain?: boolean }[]) => {
    const titles = await threadTitles.titles(records.filter((rec) => !rec.title?.trim()).map((rec) => rec.threadId));
    return records.map((rec) => ({ threadId: rec.threadId, kind: rec.kind, title: rec.title?.trim() || titles.get(rec.threadId) || "", updatedAt: rec.updatedAt, isMain: rec.isMain === true }));
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
    if (kind === "todo") { try { return loops.store.get(id).title; } catch { return taskTitle(db, id); } }
    const ref = parseAutomationRefId(id);
    if (!ref || !bots.list().some((bot) => bot.id === ref.botId)) return null;
    return (await automationTableFor(ref.botId)).rows.find((row) => row.id === ref.rowId)?.name ?? null;
  };
  const entryRows = async (_query: string, _limit: number): Promise<EntryRow[]> => {
    const all = bots.list();
    const todos = loops.store.all().filter((loop) => loop.closedAt === null).map((loop): EntryRow => ({ kind: "todo", id: loop.id, title: loop.title, updatedAt: loop.updatedAt }));
    const tables = await Promise.all(all.map((bot) => automationTableFor(bot.id).catch(() => null)));
    const rows = tables.flatMap((table) => (table?.rows ?? []).map((row): EntryRow => ({ kind: "automation", id: automationRefId(table!.botId, row.id), title: row.name, updatedAt: row.lastRunAt ?? 0 })));
    return [...todos, ...rows];
  };
  const newTabSources: NewTabSources = {
    items: (limit) => itemRows(searchIndex.recent(limit, { kinds: NEW_TAB_ITEM_KINDS })),
    botThreads: async (limit) => botThreadRows(botThreads.store.recent(limit).map((rec) => ({ ...rec, updatedAt: activityOf(rec, null) }))),
    boards: visualChatBoards,
    bots: botRows,
  };
  const newTabSearchSources: NewTabSearchSources = {
    items: (query, limit) => searchIndex.search(query, { kinds: NEW_TAB_ITEM_KINDS, limit }).map((hit) => ({ row: { id: hit.ref.id, title: hit.title, updatedAt: hit.updatedAt, kindName: fileKindName(hit.ref.id) }, score: hit.score })),
    itemsOfKinds: (kinds, limit) => kinds.length ? itemRows(searchIndex.recent(limit, { kinds: itemKindsOf(kinds) })) : [],
    botThreads: async (query, limit) => {
      const hits = await externalResults(bb, query, { kinds: ["thread"], limit: limit * 3 });
      const found = hits.flatMap((hit) => {
        const rec = botThreads.store.get(hit.ref.id);
        return rec && rec.archivedAt === null ? [{ hit, rec }] : [];
      });
      const rows = await botThreadRows(found.map(({ hit, rec }) => ({ threadId: rec.threadId, kind: rec.kind, title: rec.title ?? hit.title, updatedAt: hit.updatedAt, isMain: rec.isMain })));
      return rows.map((row, index) => ({ row, score: found[index]!.hit.score }));
    },
    boards: visualChatBoards,
    bots: botRows,
    entries: entryRows,
  };
  // Set once hands-free voice is wired, further down.
  let voiceSearch: ((query: string, limit: number) => SearchHit[]) | null = null;
  registerStudioRpc({
    bb,
    hub,
    searchIndex,
    tags,
    stars,
    tabs,
    changes,
    itemIndex,
    workspace,
    services,
    providerComments,
    projectLeads,
    bots,
    botThreads,
    botFinish,
    nudges,
    ownedThreads,
    sideThreads,
    themes,
    themeService,
    themeGpu,
    presenceService,
    presenceChecks,
    maintenance,
    pageState,
    warmer,
    onboarding,
    learning,
    automations,
    runners,
    newTabSources,
    newTabSearchSources,
    getVoiceSearch: () => voiceSearch,
    overview,
    contentSearch,
    deleteItems,
    tagsChanged,
    tabsChanged,
    starredItems,
    automationTableFor,
    learnerId,
    pageBotId,
    pageStateView,
    cacheThread,
    recentThreads,
    studioChanged,
    listed,
    readSidebar,
    tabData,
    tabViews,
    itemForPath,
    addonPanels,
    recordActivity,
  });

  // Agents --------------------------------------------------------------------

  const { listItems, formatList } = registerListTools({
    bb,
    bots,
    projectLeads,
    conversationBot: (threadId) => botThreads.store.conversationBot(threadId),
    overview,
    contentSearch,
  });

  const { acting, selfBot, registerStatusTools } = registerBotTools({
    bb,
    bots,
    runners,
    themeService,
    presenceService,
    getThreadRecord: (threadId) => botThreads.store.get(threadId),
    themeBot,
  });

  // Hands-free voice (src/voice/live): a speech-to-speech voice agent on the
  // phone whose tools run here, relaying visibly to the Bot and threads.
  ({ voiceSearch } = setupVoiceLive({
    bb,
    db,
    bots,
    pages,
    projectLeads,
    runners,
    automations,
    ownedThreads,
    getSettingValues: () => settingValues,
    // The composer menu's quick settings; the returned values are current at once (onChange follows).
    saveSettings: async (values) => { settingValues = await settings.experimental_set(values); },
    botPushIds,
  }));
  registerWindowRelay(bb);
  registerGroupTool(bb, { state: pageState, acting, jobs: async (botId) => (await automations.list(botId)).map((job) => ({ id: job.id, name: job.name })) });
  registerStatusTools();

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
  registerBotSkillTools({ bb, bots, learning, ownBot });
  ({ runnerDispatch } = registerScheduleTools({
    bb,
    bots,
    runners,
    automations,
    getThreadRecord: (threadId) => botThreads.store.get(threadId),
    ownBot,
  }));
  const { resolveProject, moveItemsReport } = registerCollectionTools({
    bb,
    hub,
    tags,
    tabs,
    workspace,
    tagsChanged,
    tabsChanged,
    moveItems,
    deleteItems,
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
  const { forestWeather, setup, backups } = registerPlatformRpcs({
    bb,
    db,
    health,
    changes,
    itemIndex,
    searchIndex,
    kindSettings,
    refreshRoutes,
    reactionsImport,
    pages,
    artifacts,
    drawings,
    designs,
    recordings,
    dashboards,
    minis,
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
  // Move threads to another provider (src/move-provider): `bbs studio move-provider`, and its watcher.
  const moveProvider = createMoveProvider({
    bb, db,
    // Studio's own sessions (Decisions classifier threads, skill reviews) aren't the user's to move.
    internal: (thread) => isClassifier(thread.title) || !!learning.review(thread.id),
    bots: () => bots.list().map((bot) => ({ id: bot.id, name: bot.name, threadId: bot.threadId, defaultModel: bot.defaultModel ? { providerId: bot.defaultModel.providerId, model: bot.defaultModel.model } : null })),
    botThreads: async (botId) => [...new Set([...bots.chain(botId), ...(await bots.started(botId)).map((thread) => thread.id)])],
    setBotDefault: async (botId, providerId, model) => { await bots.setDefaultModel({ botId, providerId, model }); },
    leadThreads: () => projectLeads.list().flatMap((lead) => (lead.leadThreadId ? [lead.leadThreadId] : [])),
    router: { get: async () => modelRouter.current(), set: async (policy) => { await modelRouter.setPolicy(policy as never); } },
    // The handoff (src/provider-move/handoff.ts): built at move time; delivered when the first turn after the move got it
    // (not just its header). "Stored handoff gone" isn't the signal: it is forgotten only on the turn after.
    prepare: (threadId, input) => moveHandoffs.prepare(threadId, input),
    handoffDelivered: async (threadId, moveAt) => (await moveHandoffs.delivered(threadId, moveAt))?.kind === "handoff",
  });
  bb.onDispose(() => moveProvider.dispose());
  registerStudioCli({
    bb,
    hub,
    moveProvider,
    toolDelivery,
    studioSettings,
    decisions,
    auth,
    accounts,
    artifacts,
    drawings,
    designs,
    minis,
    recordings,
    presenceService,
    themeService,
    forestWeather,
    strands,
    toolGateway,
    explore,
    pages,
    health,
    setup,
    backups,
    searchIndex,
    selfBot,
    themeBot,
    listItems,
    formatList: formatList as never,
    overview,
    starredItems,
    resolveProject,
    moveItemsReport,
  });
  // Merged tools (src/merged-tools.ts), once every member tool is in the book. A merged op runs only when its old tool is in the thread's scope.
  mergedRegistration = true;
  for (const tool of mergedTools({ book: toolBook as never, allowed: async (ctx, oldName) => {
    const threadId = (ctx as { threadId?: string; projectId?: string } | undefined)?.threadId;
    const scope = threadId ? scopes.get(threadId) ?? await recomputeScope(threadId, (ctx as { projectId?: string }).projectId) : null;
    return !!scope && (scope.loaded.includes(oldName) || scope.onDemand.includes(oldName));
  } })) bb.agents.registerTool(tool as never);
  mergedRegistration = false;
  // BB runs dispose hooks last-registered first, then closes the database. Registered last, this
  // runs first: no scheduled work starts once a reload has begun, and `disposed` guards see it.
  bb.onDispose(() => { disposed = true; triggers.stop(); });
}
