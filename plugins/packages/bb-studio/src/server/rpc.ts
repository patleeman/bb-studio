import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutomationTable } from "../automation-table-contract";
import type { Automations } from "../automations";
import { EXTERNAL_AGENTS_PLUGIN_ID, type Bots } from "../bot";
import type { BotCacheWarmer } from "../bot-cache";
import type { registerBotFinish } from "../bot-finish";
import type { BotMaintenance } from "../bot-maintenance";
import type { BotNudges } from "../bot-nudge";
import type { BotOwnedThreads } from "../bot-owned";
import type { BotPageState } from "../bot-page-state";
import type { SideThreads } from "../bot-side-threads";
import type { registerBotThreads } from "../bot-threads-server";
import { builtinItemAt } from "../builtins";
import type { ChangeLog } from "../changes";
import { rpcContract, type ProviderView, type SidebarView, type StarredItemView, type TabView, type ThreadOptionView } from "../contract";
import { zipFiles } from "../export-zip";
import { externalProviders } from "../external-bots";
import type { HubItem, StudioHub } from "../hub";
import type { ItemIndex } from "../item-index";
import { familyAndType, kindsNamed, typeOfId } from "../item-model";
import { STUDIO_PLUGIN_ID, STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { newTabRecents, newTabSearch, type NewTabSearchSources, type NewTabSources } from "../newtab";
import type { registerOnboarding } from "../onboarding-register";
import type { PresenceCheckRouter } from "../presence/check-router";
import { presenceAskText } from "../presence/contract";
import type { PresenceService } from "../presence/service";
import { PERSONAL_PROJECT_ID, type ProjectLeads } from "../project-lead";
import type { ProviderComments } from "../provider-comments";
import { backgroundKinds } from "../query";
import type { Runners } from "../runners";
import { externalResults } from "../search-external";
import type { SearchHit, SearchIndex } from "../search-index";
import type { StudioServices } from "../services";
import { withPanelsVisible } from "../sidebar";
import type { SkillLearning } from "../skill-learning";
import type { StarStore } from "../stars";
import type { TabStore } from "../tabs";
import type { TagStore } from "../tags";
import type { ThemeGpuRouter } from "../theme/gpu-server";
import type { ThemeService } from "../theme/service";
import type { ThemeStore } from "../theme/store";
import { workerApprovalRpc } from "../worker-approvals";
import type { WorkspacePresence } from "../workspace-presence";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";

type ListedItem = HubItem & { tags: string[]; thread: { id: string; title: string } | null; starredAt: number | null; createdBy?: "user" | "agent" | null };

export interface StudioRpcDeps {
  bb: BbPluginApi;
  hub: StudioHub;
  searchIndex: SearchIndex;
  tags: TagStore;
  stars: StarStore;
  tabs: TabStore;
  changes: ChangeLog;
  itemIndex: ItemIndex;
  workspace: WorkspacePresence;
  services: StudioServices;
  providerComments: ProviderComments;
  projectLeads: ProjectLeads;
  bots: Bots;
  botThreads: ReturnType<typeof registerBotThreads>;
  botFinish: ReturnType<typeof registerBotFinish>;
  nudges: BotNudges;
  ownedThreads: BotOwnedThreads;
  sideThreads: SideThreads;
  themes: ThemeStore;
  themeService: ThemeService;
  themeGpu: ThemeGpuRouter;
  presenceService: PresenceService;
  presenceChecks: PresenceCheckRouter;
  maintenance: BotMaintenance;
  pageState: BotPageState;
  warmer: BotCacheWarmer;
  onboarding: ReturnType<typeof registerOnboarding>;
  learning: SkillLearning;
  automations: Automations;
  runners: Runners;
  newTabSources: NewTabSources;
  newTabSearchSources: NewTabSearchSources;
  getVoiceSearch: () => ((query: string, limit: number) => SearchHit[]) | null;
  overview: () => Promise<{ providers: ProviderView[]; items: ListedItem[]; tags: ReturnType<TagStore["list"]> }>;
  contentSearch: (query: string) => Promise<{ keys: string[]; snippets: Record<string, string> }>;
  deleteItems: (pluginId: string, ids: string[]) => Promise<{ done: string[]; failed: { id: string; error: string }[] }>;
  tagsChanged: () => void;
  tabsChanged: () => void;
  starredItems: () => Promise<StarredItemView[]>;
  automationTableFor: (botId?: string) => Promise<AutomationTable>;
  learnerId: (botId?: string) => string;
  pageBotId: (botId?: string) => string;
  pageStateView: (botId: string) => { groupNames: Record<string, string>; dismissed: string[] };
  cacheThread: (threadId?: string, botId?: string) => string;
  recentThreads: () => Promise<ThreadOptionView[]>;
  studioChanged: (input: { pluginId: string; ids?: string[]; removed?: string[] }) => Promise<{ ok: boolean }>;
  listed: (items: HubItem[]) => Promise<ListedItem[]>;
  readSidebar: () => Promise<SidebarView>;
  tabData: () => Promise<{ items: HubItem[]; providers: ProviderView[] }>;
  tabViews: (data: { items: HubItem[]; providers: ProviderView[] }) => TabView[];
  itemForPath: (path: string) => Promise<HubItem | null>;
  addonPanels: () => Promise<{ id: string }[]>;
  recordActivity: (event: Parameters<StudioServices["recordActivity"]>[0]) => number;
}

/** Registers Studio's main `rpcContract` handler table. */
export function registerStudioRpc({
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
  getVoiceSearch,
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
}: StudioRpcDeps): void {
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
      const voiceSearch = getVoiceSearch();
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
    bot_create: async (input) => {
      return bots.create(input);
    },
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
    bot_make_main: ({ botId, threadId }) => bots.makeMain(threadId, botId),
    bot_new_main: ({ botId }) => bots.newMain(botId),
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
    bot_conversation_owner: ({ threadId }) => ({ botId: botThreads.store.conversationBot(threadId) ?? bots.list().find((bot) => bot.threadId === threadId)?.id ?? null }),
    bot_thread_release: ({ threadId }) => ownedThreads.release(threadId),
    bot_welcome: onboarding.bot_welcome,
    bot_welcome_opened: onboarding.bot_welcome_opened,
    bot_thread_adopt: ({ botId, threadId }) => { const bot = bots.stored(botId); if (!bot) throw new Error("That bot isn't there anymore."); return ownedThreads.adopt(threadId, bot.id); },
    bot_checkin_preset: ({ botId, preset }) => bots.checkinPreset(preset, botId),
    bot_skills: ({ botId }) => ({ skills: bots.skills(botId) }),
    bot_core: ({ botId }) => {
      bots.requireStudio(botId, "skills");
      const skills = bots.alwaysOnSkills(botId).map((skill) => ({ name: skill.name, description: skill.description, body: skill.body, updatedAt: skill.updatedAt, core: skill.core, warnings: bots.skillLint({ name: skill.name, body: skill.body, alwaysOn: true }, botId) }));
      return { skills, ...bots.skillBudget(botId) };
    },
    // The user's own write (Studio's UI): an edit to the core skill marks its text as theirs (Maintenance may tidy it from then on).
    bot_skill_write: ({ botId, ...input }) => { bots.requireStudio(botId, "skills"); const view = bots.writeSkill(input, botId); bots.userEditedSkill(input.name, botId); return view; },
    bot_skill_share: ({ botId, name }) => bots.shareSkill(name, botId),
    bot_skill_delete: ({ botId, name }) => ({ deleted: bots.deleteSkill(name, botId) }),
    bot_skill_pin: ({ botId, name, pinned }) => ({ changed: bots.pinSkill(name, pinned, botId) }),
    bot_skill_restore: ({ botId, name }) => ({ changed: bots.setSkillState(name, "active", botId) }),
    bot_learning: ({ botId }) => learning.view(learnerId(botId)),
    bot_learning_set: ({ botId, ...input }) => learning.set(learnerId(botId), input),
    bot_learning_review: async ({ botId }) => ({ started: await learning.runNow(learnerId(botId)) }),
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
}
