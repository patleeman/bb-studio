import { LoopStore } from './loops/store';
// The user's Bot: an always-on agent with a name, an avatar and a state
// (active, paused, stopped), modelled on ChatGPT's dots. It replaces the
// Chief of Staff. Its thread is an implementation detail: it is the personal
// project's lead (src/project-lead.ts), so a handoff rotates it and the
// project's heartbeat is the Bot's check-in. That is the primary Bot (BOT_ID).
//
// The user can make more Bots ("New Bot"). Each has its own thread (stored on
// its row, not a project lead; a handoff moves it, handedOff), Memory page,
// skills, runners and check-in. An additional Bot's check-in is its own
// schedule, kept by ProjectRuns under the key `bot:<id>` (BOT_RUN_PREFIX).
// Every Bot has the same powers: it sees every project. Methods take an
// optional bot id; without one they act on the primary Bot.
//
// "Threads it started" come from BB's thread metadata: a thread whose
// sourceThreadId, parentThreadId or lifecycleOwnerThreadId is the Bot's thread,
// or one of the threads it handed off from. originPluginId only says which
// plugin spawned a thread, not which thread, so it isn't used.
//
// Stop is narrower (spawnedBy): it stops only threads an agent in the Bot's
// thread spawned, a BB child (parentThreadId) or one that archives with it
// (lifecycleOwnerThreadId). A fork or "continue in new thread" only sets
// sourceThreadId and is often the user's own work, so Stop leaves it running.
// Stop records the automations and runners it paused (bot_stop_paused), and
// Resume turns back on exactly those.
import { parseAppearance, type Appearance } from "./theme/appearance";
import { parsePresence, type Presence } from "./presence/schema";
import { ModelNames } from "./model-names";
import { z } from "zod";
import type { BotActivityView, BotProfileChangeView, BotScheduledView, BotSkillView, BotView, HeartbeatRun } from "./contract";
import { EXTERNAL_PROVIDERS, externalName, externalNote } from "./external-providers";

export { EXTERNAL_AGENTS_PLUGIN_ID, EXTERNAL_PROVIDERS, externalNote } from "./external-providers";
export {
  BOT_ID,
  CHECKIN_PRESET_IDS,
  CHECKIN_PRESETS,
  DEFAULT_BOT_AVATAR,
  DEFAULT_BOT_NAME,
  MAIN_HEAL_MAX_MS,
  MAIN_HEAL_MS,
  MEMORY_TEMPLATE,
  MainProviderSignedOut,
  NoMainModel,
  SELF_EDITABLE,
  SIGN_IN_FOR_MAIN,
  SKILL_NAME,
  USER_ONLY_FIELDS,
  botControlRefusal,
  botHeartbeat,
  botInstructions,
  botKind,
  checkSelfEdit,
  classifyActivity,
  descendants,
  externalBotInstructions,
  externalHeartbeat,
  listedSkills,
  mainHealDelay,
  modelChange,
  newMainNote,
  noStoredModel,
  pickPermission,
  setupInput,
  skillMarkdown,
  spawnedBy,
  startedBy,
  type BotDeps,
  type BotMemoryPages,
  type BotState,
  type CheckinPreset,
  type DefaultModel,
  type PermissionMode,
  type ProfileActor,
  type ProfileField,
  type ReasoningLevel,
  type SelfEditField,
  type ThreadExecution,
} from "./bot-model";
import {
  asReasoning,
  automationRow,
  BOT_ID,
  botHeartbeat,
  botInstructions,
  botKind,
  BUSY_CHAT,
  CHECKIN_PRESETS,
  checkSelfEdit,
  classifyActivity,
  DEFAULT_BOT_AVATAR,
  DEFAULT_BOT_NAME,
  descendants,
  externalBotInstructions,
  externalHeartbeat,
  heartbeatName,
  hiddenFork,
  mainHealDelay,
  MainProviderSignedOut,
  modelChange,
  newMainNote,
  NoMainModel,
  noStoredModel,
  pickPermission,
  providerName,
  RUNNING,
  setupInput,
  SIGN_IN_FOR_MAIN,
  spawnedBy,
  startedBy,
  storedDefault,
  type ActivityThread,
  type AutomationRow,
  type BotDeps,
  type BotRow,
  type CheckinPreset,
  type DefaultModel,
  type ListedThread,
  type PermissionMode,
  type ProfileActor,
  type ProfileChangeRow,
  type ProfileField,
  type ReasoningLevel,
  type Sdk,
  type SelfEditField,
} from "./bot-model";
import { BotSkillStore } from "./bot-skills";
import { addCheckinLine } from "./core-skill";
import { dropRetiredMemory, migrateCoreSkill, type CoreMigration } from "./core-skill-migrate";
import { BOT_RUN_PREFIX, heartbeatCron, PERSONAL_PROJECT_ID } from "./project-lead";
import { readyProvider, type OnboardingProviderState } from "./onboarding";
import { rpcErrorStatus } from "./kit/server/index";
import { mapPool } from "./kit/pool";
import { threadModel } from "./thread-model";
import { ensureColumns } from "./schema-columns";
import { turnStartedAt } from "./turn-started";
import { botAttention, pendingInteractions, threadWaitingFor, type BotAttention } from "./bot-attention";
import type { SkillHit } from "./skill-search";

export class Bots {
  private readonly skillStore: BotSkillStore;

  constructor(private readonly deps: BotDeps) {
    // Its main_* columns are added by checking (src/schema-columns.ts); the server does it too, after the migrations.
    try { ensureColumns(deps.db); } catch { /* A database without the bots table yet: saveMainModel tolerates it. */ }
    this.skillStore = new BotSkillStore({ db: deps.db, userSkillsDir: deps.userSkillsDir, changed: () => deps.changed() });
  }

  /** Every Bot, the primary first (BOT_ID, else the oldest). */
  private rows(): BotRow[] {
    return this.deps.db.prepare("SELECT * FROM bots ORDER BY (id = ?) DESC, created_at, id").all(BOT_ID) as BotRow[];
  }

  /** One Bot by id, or the primary without one. */
  private row(botId?: string | null): BotRow | undefined {
    if (botId) return this.deps.db.prepare("SELECT * FROM bots WHERE id = ?").get(botId) as BotRow | undefined;
    return this.rows()[0];
  }

  private need(botId?: string | null): BotRow {
    const row = this.row(botId);
    if (!row) throw new Error(botId ? `No Bot "${botId}".` : "Make your Bot first.");
    return row;
  }

  /** The primary Bot's id: the personal project's lead. */
  primaryId(): string | null {
    return this.rows()[0]?.id ?? null;
  }

  private isPrimary(row: BotRow): boolean {
    return row.id === this.primaryId();
  }

  /** Where a Bot's original check-in (heartbeat) lives in ProjectRuns. */
  heartbeatKey(botId?: string): string | null {
    const row = this.row(botId);
    return row ? this.runKey(row) : null;
  }

  /** Where the Bot's check-in lives in ProjectRuns: the personal project's for the primary, its own otherwise. */
  private runKey(row: BotRow): string {
    return this.isPrimary(row) ? PERSONAL_PROJECT_ID : `${BOT_RUN_PREFIX}${row.id}`;
  }

  private view(row: BotRow): NonNullable<BotView["bot"]> {
    const primary = this.isPrimary(row);
    const threadId = primary ? this.deps.leads.storedLead(PERSONAL_PROJECT_ID) : row.thread_id;
    const memoryPageId = row.memory_page_id && this.deps.memory?.exists(row.memory_page_id) ? row.memory_page_id : null;
    return { id: row.id, name: row.name, avatar: row.avatar, state: row.state, threadId, memoryPageId, shape: row.shape ?? null, color: row.color ?? null, role: row.role ?? null, primary, kind: botKind(row.provider_id), providerId: row.provider_id ?? null, model: (threadId ? this.models.get(threadId) : null) ?? null, modelName: this.modelName(row.provider_id, threadId), appearance: parseAppearance(row.appearance_json), presence: parsePresence(row.presence_json, row.id, primary), defaultModel: this.defaultModelView(row), inBb: this.inBb(row), ...this.mainProblem(row.id), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  /** Imported from bb by a BB Studio copy and not running here: made before the import and not active. */
  private inBb(row: BotRow): boolean {
    const importedAt = this.deps.importedAt?.() ?? null;
    return importedAt !== null && row.state !== "active" && row.created_at <= importedAt;
  }

  /** A Bot as stored (the primary without an id); its thread read from the personal project's lead for the primary. */
  stored(botId?: string | null): BotView["bot"] {
    const row = this.row(botId);
    return row ? this.view(row) : null;
  }

  /** Every Bot, the primary first. */
  list(): NonNullable<BotView["bot"]>[] {
    return this.rows().map((row) => this.view(row));
  }

  /** The heartbeat prompt for the personal project (the primary Bot's). */
  prompt(): string {
    return botHeartbeat(this.row()?.name ?? DEFAULT_BOT_NAME);
  }

  /** An additional Bot's check-in prompt, by its run key (`bot:<id>`). */
  promptFor(key: string): string | null {
    if (!key.startsWith(BOT_RUN_PREFIX)) return null;
    const row = this.row(key.slice(BOT_RUN_PREFIX.length));
    return row ? (botKind(row.provider_id) === "external" ? externalHeartbeat(row.name) : botHeartbeat(row.name)) : null;
  }

  /** An additional Bot's thread for its run key, for ProjectRuns.repair. */
  threadForRunKey(key: string): string | null {
    return key.startsWith(BOT_RUN_PREFIX) ? this.stored(key.slice(BOT_RUN_PREFIX.length))?.threadId ?? null : null;
  }

  /**
   * The Bot whose thread this is, if any. A new Bot's thread starts before it
   * is saved as the Bot's, so its spawn metadata (`{ bot: <id> }`) counts
   * while that Bot has no thread yet.
   */
  forThread(threadId: string | undefined | null, metadata?: { readonly [key: string]: unknown }): NonNullable<BotView["bot"]> | null {
    if (!threadId) return null;
    const bots = this.list();
    const own = bots.find((bot) => bot.threadId === threadId);
    if (own) return own;
    const named = bots.find((bot) => !bot.threadId && metadata?.bot === bot.id);
    if (named) return { ...named, threadId };
    // A handoff's new thread starts before the bot moves to it.
    const from = typeof metadata?.handoffFrom === "string" ? bots.find((bot) => bot.threadId === metadata.handoffFrom) : undefined;
    return from ? { ...from, threadId } : null;
  }

  /**
   * The Bot a thread acts for, and how: its own thread or one it handed off
   * from ("own"), a runner's thread (`runnerBot` names the runner's Bot), or a
   * thread it started, walking parent, source and lifecycle owner up to a Bot
   * or runner thread (depth-limited). Null: no Bot's, so tools fall back to
   * the primary Bot.
   */
  async actingFor(threadId: string | undefined | null, runnerBot?: (threadId: string) => string | null | undefined): Promise<{ botId: string; via: "own" | "runner" | "started" } | null> {
    if (!threadId) return null;
    const bots = this.list();
    const chains = bots.flatMap((bot) => bot.threadId ? [[bot.id, new Set(this.threadChain(bot.threadId))] as const] : []);
    const seen = new Set<string>();
    let id: string | null | undefined = threadId;
    for (let depth = 0; id && depth < 8 && !seen.has(id); depth++) {
      seen.add(id);
      const own = chains.find(([, chain]) => chain.has(id!));
      if (own) return { botId: own[0], via: depth === 0 ? "own" : "started" };
      const runner = runnerBot?.(id);
      if (runner && bots.some((bot) => bot.id === runner)) return { botId: runner, via: depth === 0 ? "runner" : "started" };
      const thread: Partial<ListedThread> | null = await this.deps.sdk.threads.get({ threadId: id }).catch(() => null);
      id = thread ? thread.parentThreadId ?? thread.sourceThreadId ?? thread.lifecycleOwnerThreadId : null;
    }
    return null;
  }

  async get(botId?: string | null): Promise<BotView> {
    let row = this.row(botId);
    if (botId && !row) throw new Error(`No Bot "${botId}".`);
    if (row) row = await this.refresh(row);
    if (!row || this.isPrimary(row)) {
      const lead = await this.deps.leads.get(PERSONAL_PROJECT_ID);
      return { bot: this.stored(row?.id), run: lead.run };
    }
    return { bot: this.view(row), run: this.deps.leads.runs.get(this.runKey(row)) };
  }

  private insert(id: string, name: string, avatar: string, shape: string | null = null, color: string | null = null, providerId: string | null = null) {
    const now = Date.now();
    this.deps.db.prepare("INSERT OR IGNORE INTO bots (id, name, avatar, shape, color, state, thread_id, heartbeat_was_on, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?, ?)")
      .run(id, name, avatar, shape, color, providerId, now, now);
  }

  /** The current thread's model, by thread id: read off BB, never a bot setting. */
  private readonly models = new Map<string, string>();
  /** Models' display names from their provider's catalog, as BB's composer shows them (src/model-names.ts). */
  private readonly modelNames = new ModelNames(async (providerId) => (await this.deps.sdk.providers.models({ providerId })).models);

  /** A Bot's default model as stored; null until set or filled from Main. */
  defaultModel(botId?: string | null): DefaultModel | null {
    const row = this.row(botId);
    return row ? storedDefault(row) : null;
  }

  private defaultModelView(row: BotRow): NonNullable<BotView["bot"]>["defaultModel"] {
    const value = storedDefault(row);
    return value ? { providerId: value.providerId, model: value.model, reasoningLevel: value.reasoning, modelName: this.modelNames.name(value.providerId, value.model) } : null;
  }

  /**
   * Sets what a Bot's new conversations start on. It switches no thread:
   * Main and every conversation keep the model they run on.
   */
  async setDefaultModel(input: { botId: string; providerId: string; model: string; reasoning?: ReasoningLevel }): Promise<BotView> {
    const row = this.need(input.botId);
    const provider = await this.provider(input.providerId);
    if (!provider) throw new Error(`${input.providerId} isn't an agent provider BB has right now.`);
    const external = botKind(input.providerId) === "external";
    if (external !== (botKind(row.provider_id) === "external")) throw new Error(external ? `${row.name} runs with Studio's tools, so its conversations can't start on ${externalName(input.providerId)}.` : `${row.name} runs on ${externalName(row.provider_id)}, so its conversations start there.`);
    // A provider BB says is signed out, or a model its catalog doesn't list, would break every + New, Ask and new Main later.
    if (!external && !await this.providerReady(input.providerId)) throw new Error(`${providerName(input.providerId)} isn't signed in, so it can't be the default model. Sign in to it in Settings → Providers, or pick another model.`);
    const catalog = await this.deps.sdk.providers.models({ providerId: input.providerId }).then((result) => (result.models as readonly { model: string }[]).map((each) => each.model), () => null);
    if (catalog && catalog.length && !catalog.includes(input.model)) throw new Error(`${providerName(input.providerId)} doesn't offer ${input.model} any more. Pick another model.`);
    const reasoning = external ? "none" : input.reasoning && (!provider.levels.length || provider.levels.includes(input.reasoning)) ? input.reasoning : null;
    this.deps.db.prepare("UPDATE bots SET default_provider_id = ?, default_model = ?, default_reasoning = ?, updated_at = ? WHERE id = ?").run(input.providerId, input.model, reasoning, Date.now(), row.id);
    void this.modelNames.warm(input.providerId);
    this.deps.changed();
    // Choose a model, from the sidebar's "No model for a new Main": the new Main starts now, not at the next heal.
    if (this.healBackoff.has(row.id)) await this.heal(row.id);
    return this.get(row.id);
  }

  /** What a thread runs on now, read off BB (BB's composer changes it), with its display name; null when BB doesn't say. */
  async threadModel(threadId: string): Promise<{ providerId: string; model: string; reasoningLevel: ReasoningLevel | null; modelName: string } | null> {
    const [thread, options] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch(() => null),
      this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    if (!thread?.providerId || !options?.model) return null;
    await this.modelNames.warm(thread.providerId);
    return { providerId: thread.providerId, model: options.model, reasoningLevel: asReasoning(options.reasoningLevel), modelName: this.modelNames.name(thread.providerId, options.model) };
  }

  private modelName(providerId: string | null | undefined, threadId: string | null): string | null {
    const model = threadId ? this.models.get(threadId) : null;
    return model ? this.modelNames.name(providerId, model) : null;
  }

  /**
   * Reads what the bot's current thread runs on. The model and provider are
   * the thread's (BB's composer changes them); `provider_id` only caches the
   * provider so the bot's kind is known where reads must be synchronous
   * (agents.configure, requireStudio). A Bot with no default model yet gets
   * Main's, once (the migration from "the Bot's model is Main's").
   */
  private async refresh(row: BotRow): Promise<BotRow> {
    const threadId = this.view(row).threadId;
    if (!threadId) return row;
    const [thread, options] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch(() => null),
      this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    if (options?.model) this.models.set(threadId, options.model);
    // Saved for a new Main, should this one be deleted (and so unreadable) later.
    if (thread?.providerId && options?.model) this.saveMainModel(row, { providerId: thread.providerId, model: options.model, reasoning: asReasoning(options.reasoningLevel) });
    void this.modelNames.warm(thread?.providerId ?? row.provider_id);
    void this.modelNames.warm(row.default_provider_id);
    if (!thread?.providerId) return row;
    let changed = false;
    if (thread.providerId !== row.provider_id) {
      this.deps.db.prepare("UPDATE bots SET provider_id = ? WHERE id = ?").run(thread.providerId, row.id);
      changed = true;
    }
    if (row.default_model === null && options?.model) {
      this.deps.db.prepare("UPDATE bots SET default_provider_id = ?, default_model = ?, default_reasoning = ? WHERE id = ? AND default_model IS NULL").run(thread.providerId, options.model, asReasoning(options.reasoningLevel), row.id);
      changed = true;
    }
    return changed ? this.need(row.id) : row;
  }

  /** BB's agent provider entry (permission modes, reasoning levels), or null when it isn't registered. */
  private async provider(providerId: string): Promise<{ modes: string[]; levels: string[] } | null> {
    let providers: Awaited<ReturnType<Sdk["providers"]["list"]>> = [];
    try { providers = await this.deps.sdk.providers.list(); } catch { /* No provider list. */ }
    const provider = providers.find((each) => each.id === providerId) as { capabilities?: { permissionModes?: readonly string[] }; reasoningLevels?: readonly ({ id: string } | string)[] } | undefined;
    if (!provider) return null;
    return { modes: [...(provider.capabilities?.permissionModes ?? [])], levels: (provider.reasoningLevels ?? []).map((each) => typeof each === "string" ? each : each.id) };
  }

  /**
   * Switches any thread's model. BB keeps a thread on its provider, so the
   * same provider changes it in place (threads.update, as BB's composer
   * does) and another provider hands it off: a new thread there with a
   * summary of this one, its permission carried forward, the old one archived.
   * A bot's thread hands off along its chain (check-in and runners follow).
   */
  async switchModel(threadId: string, input: { providerId: string; model: string; reasoning?: ReasoningLevel }): Promise<{ change: "unchanged" | "in-place" | "handoff"; threadId: string }> {
    const [thread, options] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch((error) => { if (rpcErrorStatus(error) === 404) throw new Error("That conversation no longer exists."); throw error; }),
      this.deps.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
    ]);
    const provider = await this.provider(input.providerId);
    if (!provider) throw new Error(`${input.providerId} isn't an agent provider BB has right now.`);
    const bot = this.forThread(threadId);
    const external = botKind(input.providerId) === "external";
    if (bot?.primary && external) throw new Error(`${bot.name} leads your personal project with Studio's tools, so it can't run on ${externalName(input.providerId)}. Import another bot for that.`);
    const levels = provider.levels;
    const fits = (level: string | null | undefined): level is ReasoningLevel => !!level && (!levels.length || levels.includes(level));
    const reasoning: ReasoningLevel = external ? "none" : fits(input.reasoning) ? input.reasoning : fits(options?.reasoningLevel) ? options!.reasoningLevel as ReasoningLevel : (levels[0] as ReasoningLevel | undefined) ?? "medium";
    const change = modelChange({ providerId: thread.providerId, model: options?.model ?? null, reasoning: (options?.reasoningLevel ?? null) as ReasoningLevel | null }, { providerId: input.providerId, model: input.model, reasoning: input.reasoning ?? null });
    if (change === "unchanged") return { change, threadId };
    if (change === "in-place") {
      await this.deps.sdk.threads.update({ threadId, model: input.model, ...(input.reasoning ? { reasoningLevel: input.reasoning } : {}) });
      this.models.set(threadId, input.model);
      this.deps.changed();
      return { change, threadId };
    }
    const permission = pickPermission(provider.modes, options?.permissionMode);
    const { threadId: newId } = await this.deps.leads.handoff(threadId, {
      projectId: thread.projectId, providerId: input.providerId, model: input.model, reasoningLevel: reasoning, permissionMode: permission,
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
      // Its own workspace (a worktree stays the worktree), as BB's own handoff does; the project's default without one.
      environment: (thread as { environmentId?: string | null }).environmentId ? { type: "reuse", environmentId: (thread as { environmentId?: string | null }).environmentId } : { type: "project-default" },
      input: [{ type: "text", text: `You were moved from ${providerName(thread.providerId)} to ${providerName(input.providerId)} (${input.model}). Say in a sentence that you're here and carry on.`, mentions: [], visibility: "agent-only" }],
    } as never);
    await this.handedOff(threadId, newId);
    if (bot) this.deps.db.prepare("UPDATE bots SET provider_id = ?, updated_at = ? WHERE id = ?").run(input.providerId, Date.now(), bot.id);
    this.models.set(newId, input.model);
    this.deps.changed();
    return { change, threadId: newId };
  }

  /** Throws for an external bot: `what` (its Memory page, skills, runners) lives on its provider. */
  requireStudio(botId: string | undefined, what: string): void {
    const row = this.row(botId);
    if (row && botKind(row.provider_id) === "external") throw new Error(`${row.name} has no Studio ${what}. ${externalNote(row.provider_id)}`);
  }

  private update(row: BotRow, fields: Partial<Pick<BotRow, "name" | "avatar" | "shape" | "color" | "role" | "state" | "heartbeat_was_on">>) {
    const next = { ...row, ...fields };
    this.deps.db.prepare("UPDATE bots SET name = ?, avatar = ?, shape = ?, color = ?, role = ?, state = ?, heartbeat_was_on = ?, updated_at = ? WHERE id = ?").run(next.name, next.avatar, next.shape ?? null, next.color ?? null, next.role ?? null, next.state, next.heartbeat_was_on, Date.now(), row.id);
    this.deps.changed();
  }

  /**
   * Makes a Bot from a thread, or a new chat in the personal project. The
   * first is the primary (the personal project's lead); later ones are
   * additional Bots with their own thread.
   */
  async create(input: { name: string; avatar: string; shape?: string; color?: string; threadId?: string; prompt?: string; setup?: string; external?: { providerId: string; model: string; permissionMode?: PermissionMode } }): Promise<BotView> {
    let external = input.external;
    if (external && !EXTERNAL_PROVIDERS.some((each) => each.id === external!.providerId)) throw new Error(`${external.providerId} isn't an external agent provider.`);
    // Accept edits unless asked otherwise, where the provider supports it.
    if (external) external = { ...external, permissionMode: pickPermission((await this.provider(external.providerId))?.modes ?? [], external.permissionMode ?? "accept-edits") };
    if (external && input.threadId) throw new Error("An imported bot starts its own thread on its provider.");
    // The primary Bot leads the personal project with Studio's tools, so an import is always an additional Bot.
    if (external && !this.row()) throw new Error("Make your first bot in Studio, then import others.");
    const primary = !this.row();
    const id = primary ? BOT_ID : `bot_${Math.random().toString(36).slice(2, 12)}`;
    // The row comes first, so the new thread's first turn gets the Bot's instructions (forThread).
    this.insert(id, input.name, input.avatar, input.shape ?? null, input.color ?? null, external?.providerId ?? null);
    let threadId = input.threadId;
    try {
      if (threadId && this.forThread(threadId)) throw new Error("That thread is already a Bot's.");
      if (!threadId) {
        const thread = await this.deps.sdk.threads.spawn({
          projectId: PERSONAL_PROJECT_ID,
          title: input.name,
          environment: { type: "project-default" },
          pluginMetadata: { bot: id },
          // Studio Agents' providers take no reasoning levels; the permission is the bot's (accept edits by default).
          ...(external ? {} : await this.signedInModel()),
          ...(external ? { providerId: external.providerId, model: external.model, reasoningLevel: "none", permissionMode: external.permissionMode, executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" } } : {}),
          // Its instructions come from agents.configure (botInstructions), so the first message is the user's.
          input: input.prompt === undefined && input.setup !== undefined ? setupInput(input.setup) : [{ type: "text", text: input.prompt ?? `Hi ${input.name}. Introduce yourself in a sentence and ask what I'd like you to keep an eye on.`, mentions: [] }],
        } as never);
        threadId = thread.id;
      }
      if (primary) await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
      else this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), id);
    } catch (error) {
      this.deps.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
      throw error;
    }
    await this.claimChains();
    this.deps.changed();
    return this.get(id);
  }

  async signedInModel(): Promise<Record<string, unknown>> {
    let states: readonly OnboardingProviderState[] = [];
    try { states = (await this.deps.providerStates?.()) ?? []; } catch { return {}; }
    const ready = new Set(states.filter((state) => state.status === "ready" && botKind(state.providerId) === "studio").map((state) => state.providerId));
    if (!ready.size) return {};
    const primaryId = this.primaryId();
    const primary = primaryId ? this.row(primaryId) : null;
    const preset = primary ? storedDefault(primary) : null;
    if (preset && ready.has(preset.providerId)) {
      return { providerId: preset.providerId, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}), executionInputSources: { providerId: "explicit", model: "explicit", ...(preset.reasoning ? { reasoningLevel: "explicit" } : {}) } };
    }
    const providerId = primary?.provider_id && ready.has(primary.provider_id) ? primary.provider_id : readyProvider(states);
    return providerId && ready.has(providerId) ? { providerId, executionInputSources: { providerId: "explicit" } } : {};
  }

  async seedStarter(input: { name: string; avatar: string }): Promise<{ id: string; threadId: string }> {
    const thread = await this.deps.sdk.threads.spawn({ projectId: PERSONAL_PROJECT_ID, title: input.name, environment: { type: "project-default" }, pluginMetadata: { bot: BOT_ID }, input: [] } as never);
    try {
      const made = (await this.create({ name: input.name, avatar: input.avatar, threadId: thread.id })).bot;
      if (!made) throw new Error("The Bot wasn't made.");
      return { id: made.id, threadId: thread.id };
    } catch (error) {
      if (!this.stored(BOT_ID)) await this.deps.sdk.threads.delete({ threadId: thread.id, childThreadsConfirmed: false }).catch(() => {});
      throw error;
    }
  }

  async startFirstChat(input: { botId: string; providerId: string; prompt: string }): Promise<string | null> {
    const threadId = this.stored(input.botId)?.threadId;
    if (!threadId) throw new Error("That Bot has no Main.");
    const thread = await this.deps.sdk.threads.get({ threadId });
    if (thread.status !== "pending" || (thread as { queuedMessageCount?: number }).queuedMessageCount) return null;
    const prompt = [{ type: "text", text: input.prompt, mentions: [], visibility: "agent-only" }];
    if (thread.providerId === input.providerId) {
      try {
        await this.deps.sdk.threads.send({ threadId, mode: "auto", input: prompt } as never);
        return threadId;
      } catch (error) {
        // The seeded Main was made before any provider was ready, so BB stored no model for it and
        // can't send there. A new Main on the provider gets its default model; this one goes.
        if (!noStoredModel(error)) throw error;
      }
    }
    // Never without a model: the provider's default, so BB doesn't answer "no stored execution model" again.
    const model = await this.providerDefault(input.providerId);
    const next = await this.deps.sdk.threads.spawn({ projectId: thread.projectId, title: thread.title ?? input.botId, environment: { type: "project-default" }, providerId: input.providerId, ...(model ? { model, executionInputSources: { providerId: "explicit", model: "explicit" } } : {}), pluginMetadata: { handoffFrom: threadId }, input: prompt } as never);
    const row = this.need(input.botId);
    if (this.isPrimary(row)) await this.deps.leads.setLead(PERSONAL_PROJECT_ID, next.id);
    else this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(next.id, Date.now(), row.id);
    await this.deps.sdk.threads.archive({ threadId }).catch(() => {});
    await this.claimChains();
    this.deps.changed();
    return next.id;
  }

  private readonly restoring = new Map<string, Promise<string | null>>();

  restoreMain(botId: string, goneThreadId?: string, resuming = false): Promise<string | null> {
    const pending = this.restoring.get(botId);
    if (pending) return pending;
    const run = this.replaceMain(botId, goneThreadId, resuming).finally(() => this.restoring.delete(botId));
    this.restoring.set(botId, run);
    return run;
  }

  /** Per Bot, while its new Main keeps failing: failures in a row, when to try next, and the last error said. */
  private readonly healBackoff = new Map<string, { failures: number; nextAt: number; error: string; needsModel: boolean; signedOut?: string }>();

  /**
   * The heal (startup and every 5 minutes): each Bot whose Main is gone gets
   * a new one. One that keeps failing waits longer each time (mainHealDelay),
   * and `warn` hears each new error once, not every pass.
   */
  async restoreMains(warn?: (message: string) => void, now = Date.now()): Promise<string[]> {
    const made: string[] = [];
    for (const row of this.rows()) {
      const backoff = this.healBackoff.get(row.id);
      if (backoff && now < backoff.nextAt) continue;
      const threadId = await this.heal(row.id, undefined, warn, now);
      if (threadId) made.push(threadId);
    }
    return made;
  }

  /**
   * One try at a new Main for a Bot whose Main is gone (an event, the heal,
   * the scheduler's rescue): a failure is remembered (the wait before the
   * heal tries again, and the plain problem the sidebar shows), never thrown.
   */
  async heal(botId: string, goneThreadId?: string, warn?: (message: string) => void, now = Date.now()): Promise<string | null> {
    const row = this.row(botId);
    if (!row) return null;
    const backoff = this.healBackoff.get(row.id);
    try {
      const threadId = await this.restoreMain(row.id, goneThreadId);
      if (backoff) { this.healBackoff.delete(row.id); this.deps.changed(); }
      return threadId;
    } catch (error) {
      const failures = (backoff?.failures ?? 0) + 1;
      const delay = mainHealDelay(failures);
      const text = String((error as Error)?.message ?? error).slice(0, 300);
      if (text !== backoff?.error) warn?.(`Couldn't start a new Main for ${row.name}: ${text} Trying again in ${Math.round(delay / 60_000)} min.`);
      this.healBackoff.set(row.id, { failures, nextAt: now + delay, error: text, needsModel: error instanceof NoMainModel, ...(error instanceof MainProviderSignedOut ? { signedOut: error.providerName } : {}) });
      this.deps.changed();
      return null;
    }
  }

  /** The sidebar's plain words while a Bot's new Main can't start, and whether a model would fix it. */
  private mainProblem(botId: string): { mainProblem: string | null; mainNeedsModel: boolean } {
    const backoff = this.healBackoff.get(botId);
    if (!backoff) return { mainProblem: null, mainNeedsModel: false };
    if (backoff.signedOut) return { mainProblem: `Sign in to ${backoff.signedOut} or choose a model`, mainNeedsModel: true };
    return backoff.needsModel
      ? { mainProblem: "No model for a new Main", mainNeedsModel: true }
      : { mainProblem: "Couldn't start a new Main yet; trying again", mainNeedsModel: false };
  }

  /** Keeps the model a Bot's Main runs on, when it changed. */
  private saveMainModel(row: BotRow, model: { providerId: string; model: string; reasoning: ReasoningLevel | null }): void {
    if (row.main_provider_id === model.providerId && row.main_model === model.model && (row.main_reasoning ?? null) === model.reasoning) return;
    try {
      this.deps.db.prepare("UPDATE bots SET main_provider_id = ?, main_model = ?, main_reasoning = ? WHERE id = ?").run(model.providerId, model.model, model.reasoning, row.id);
    } catch { /* A database from before the columns. */ }
  }

  /** A provider's default model (BB's model list), else its first; null when BB lists none. */
  private async providerDefault(providerId: string): Promise<string | null> {
    try {
      const { models } = await this.deps.sdk.providers.models({ providerId }) as { models: { id?: string; model?: string; isDefault?: boolean }[] };
      const pick = models.find((each) => each.isDefault) ?? models[0];
      return pick ? pick.model || pick.id || null : null;
    } catch {
      return null;
    }
  }

  /**
   * What a Bot's new Main runs on, never missing a model: the old Main's
   * (read now, else as last saved), the Bot's default model, its provider's
   * default model, then the personal project's default. Null when none.
   */
  async mainModel(row: BotRow, lost: string | null): Promise<{ providerId: string; model: string; reasoning: ReasoningLevel | null } | null> {
    if (lost) {
      const live = await this.threadModel(lost).catch(() => null);
      if (live) return { providerId: live.providerId, model: live.model, reasoning: live.reasoningLevel };
    }
    if (row.main_provider_id && row.main_model) return { providerId: row.main_provider_id, model: row.main_model, reasoning: asReasoning(row.main_reasoning) };
    const preset = storedDefault(row);
    if (preset) return { providerId: preset.providerId, model: preset.model, reasoning: preset.reasoning ?? null };
    for (const providerId of [...new Set([row.provider_id, row.default_provider_id].filter((each): each is string => !!each))]) {
      const model = await this.providerDefault(providerId);
      if (model) return { providerId, model, reasoning: null };
    }
    const project = await this.deps.sdk.projects.defaultExecutionOptions({ projectId: PERSONAL_PROJECT_ID }).catch(() => null) as { providerId?: string | null; model?: string | null; reasoningLevel?: string | null } | null;
    if (project?.providerId && project.model) return { providerId: project.providerId, model: project.model, reasoning: asReasoning(project.reasoningLevel) };
    return null;
  }

  /**
   * A Bot whose Main is deleted or archived gets a new Main on the same
   * provider and model (its stored default, else its provider), with a
   * short note when it is active. Its heartbeat, check-ins, reminders and
   * runner reports go there (they read the Main when they run).
   */
  private async replaceMain(botId: string, goneThreadId?: string, resuming = false): Promise<string | null> {
    const row = this.row(botId);
    // A Bot brought over from bb gets its new Main when it is resumed here (Resume is "Run here"), not before.
    if (!row || (this.inBb(row) && !resuming)) return null;
    // A paused or stopped Bot gets its new Main when it is resumed, not while it is put away.
    if (row.state !== "active" && !resuming) return null;
    const current = this.view(row).threadId;
    const lost = goneThreadId ?? current;
    // The primary with no Main at all (an older Studio forgot a deleted lead) gets one too.
    const none = current === null && this.isPrimary(row);
    if (!lost && !none) return null;
    if (lost && current !== lost && !none) return null;
    const gone = lost ? await this.mainGone(lost) : "deleted";
    if (!gone) return null;
    const picked = await this.mainModel(row, lost);
    if (!picked) throw new NoMainModel(row.name);
    let model: Record<string, unknown> = { providerId: picked.providerId, model: picked.model, ...(picked.reasoning ? { reasoningLevel: picked.reasoning } : {}), executionInputSources: { providerId: "explicit", model: "explicit", ...(picked.reasoning ? { reasoningLevel: "explicit" } : {}) } };
    // Its provider signed out since: a signed-in one instead, or the sidebar says to sign in or choose a model.
    if (botKind(picked.providerId) === "studio" && !await this.providerReady(picked.providerId)) {
      const other = await this.signedInModel();
      if (!("providerId" in other)) throw new MainProviderSignedOut(row.name, providerName(picked.providerId));
      model = other;
    }
    const input = [{ type: "text", text: newMainNote(row.name, gone), mentions: [], visibility: "agent-only" }];
    const thread = await this.deps.sdk.threads.spawn({ projectId: PERSONAL_PROJECT_ID, title: row.name, environment: { type: "project-default" }, pluginMetadata: { bot: row.id }, ...model, input } as never);
    try {
      await this.pointMain(row, thread.id, lost);
    } catch (error) {
      // The pointer didn't move (its heartbeat couldn't go there): the new thread goes, so no empty Main is left behind.
      await this.deps.sdk.threads.delete({ threadId: thread.id, childThreadsConfirmed: false }).catch(() => {});
      throw error;
    }
    return thread.id;
  }

  /** Moves a Bot's Main to a thread: the pointer, its heartbeat, its check-ins and the conversation records. */
  private async pointMain(row: BotRow, threadId: string, previous: string | null): Promise<void> {
    // The heartbeat moves first (setLead does the same): if it can't go there, nothing moves.
    if (this.isPrimary(row)) await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    else {
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (run?.enabled) await this.deps.leads.runs.set(this.runKey(row), threadId, run);
      this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, Date.now(), row.id);
    }
    // Check-ins Resume couldn't bring back while the Main was gone come back with the new Main.
    const fresh = this.row(row.id);
    if (fresh?.state === "active" && fresh.heartbeat_was_on) {
      const run = this.deps.leads.runs.get(this.runKey(fresh));
      if (run) {
        await this.writeRun(fresh, { ...run, enabled: true }).catch(() => {});
        this.deps.db.prepare("UPDATE bots SET heartbeat_was_on = 0 WHERE id = ?").run(row.id);
      }
    }
    await this.deps.automations?.follow(row.id).catch(() => {});
    this.reviveSchedules(row);
    // A Main is there now (picked, started or healed): the sidebar's "can't start a new Main" line goes at once.
    this.healBackoff.delete(row.id);
    try { this.deps.mainMoved?.(row.id, threadId, previous); } catch { /* The records catch up at the next reconcile. */ }
    await this.claimChains();
    this.deps.changed();
  }

  /**
   * Its heartbeat and active check-ins and reminders that a lost Main turned
   * off (before Studio made a new Main) come back on, from now.
   */
  private reviveSchedules(row: BotRow): void {
    if (!this.deps.revive || row.state !== "active") return;
    const run = this.deps.leads.runs.get(this.runKey(row));
    if (run?.enabled) this.deps.revive({ owner: "heartbeat", ownerId: this.runKey(row) });
    try {
      const ids = this.deps.db.prepare("SELECT id FROM bot_automations WHERE bot_id = ? AND state = 'active' AND kind IN ('checkin', 'reminder')").all(row.id) as { id: string }[];
      for (const { id } of ids) this.deps.revive({ owner: "automation", ownerId: id });
    } catch { /* An older database without bot_automations. */ }
  }

  /**
   * Make this the Main: a conversation of the Bot becomes its Main. The old
   * Main stays an ordinary conversation (not archived); the heartbeat,
   * check-ins, reminders and runner reports move to the new one at once.
   */
  async makeMain(threadId: string, botId?: string): Promise<BotView> {
    const row = this.need(botId ?? this.deps.conversationBot?.(threadId) ?? undefined);
    const current = this.view(row).threadId;
    if (current === threadId) return this.get(row.id);
    if (this.inBb(row)) throw new Error(`${row.name} runs in bb. Run it here first, then pick its Main.`);
    // Only the Bot's own threads: its conversations and workers, or an older thread of its chat.
    const owner = this.deps.conversationBot?.(threadId) ?? null;
    if (owner !== row.id && !this.chain(row.id).includes(threadId)) {
      const other = owner ? this.list().find((bot) => bot.id === owner) : undefined;
      throw new Error(other ? `That conversation is ${other.name}'s, not ${row.name}'s.` : `That thread isn't one of ${row.name}'s conversations.`);
    }
    type Facts = { id: string; projectId?: string; providerId?: string | null; archivedAt?: number | null; deletedAt?: number | null };
    let thread: Facts | null;
    try {
      thread = await this.deps.sdk.threads.get({ threadId }) as unknown as Facts | null;
    } catch (error) {
      if (rpcErrorStatus(error) === 404) thread = null;
      else throw error;
    }
    if (!thread || thread.deletedAt != null) throw new Error("That conversation no longer exists.");
    if (thread.archivedAt != null) throw new Error("That conversation is archived. Unarchive it first, then make it the Main.");
    if (thread.projectId && thread.projectId !== PERSONAL_PROJECT_ID) throw new Error("That conversation is in another project. A Bot's Main lives in your personal project.");
    if (this.isPrimary(row) && thread.providerId && botKind(thread.providerId) === "external") throw new Error(`${row.name} leads your personal project with Studio's tools, so its Main can't run on ${externalName(thread.providerId)}.`);
    const other = this.list().find((bot) => bot.id !== row.id && bot.threadId === threadId);
    if (other) throw new Error(`That is ${other.name}'s Main.`);
    // A conversation that never ran a turn has no model in BB: it gets the Bot's default (or its provider's), so check-ins can run there.
    const model = await threadModel(this.deps.sdk, threadId, storedDefault(row)).catch(() => null);
    if (!model) throw new Error(`That conversation has no model yet, and ${row.name} has no default model on its provider. Choose a model in it (or set ${row.name}'s default model in Bot settings), then make it the Main.`);
    try {
      await this.pointMain(row, threadId, current);
    } catch (error) {
      // The heartbeat moves first; BB still had no model for the thread.
      if (/Choose a (provider and )?model/.test(String((error as Error)?.message ?? error))) throw new Error(`That conversation has no model yet. Choose a model in it (or set ${row.name}'s default model in Bot settings), then make it the Main.`);
      throw error;
    }
    return this.get(row.id);
  }

  /**
   * Start a new Main (Bot settings → Main conversation): a fresh conversation
   * becomes the Bot's Main and the old one stays an ordinary conversation.
   * It starts on the Bot's default model when that provider is signed in,
   * else on a signed-in provider's default; with none signed in, it says so.
   */
  async newMain(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (this.inBb(row)) throw new Error(`${row.name} runs in bb. Run it here first, then start its Main.`);
    const current = this.view(row).threadId;
    const external = botKind(row.provider_id) === "external";
    const preset = storedDefault(row);
    const model = external
      ? (preset ? { providerId: preset.providerId, model: preset.model, reasoningLevel: "none", executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit" } } : { providerId: row.provider_id! })
      : preset && await this.providerReady(preset.providerId)
        ? { providerId: preset.providerId, model: preset.model, ...(preset.reasoning ? { reasoningLevel: preset.reasoning } : {}), executionInputSources: { providerId: "explicit", model: "explicit", ...(preset.reasoning ? { reasoningLevel: "explicit" } : {}) } }
        : await this.signedInModel().then((picked) => "providerId" in picked ? picked : row.provider_id ? { providerId: row.provider_id } : picked);
    if (!("providerId" in model)) throw new Error(SIGN_IN_FOR_MAIN);
    // A paused or stopped Bot isn't woken: its new Main starts with no first message, and it says hello when resumed.
    const input = row.state !== "active" ? [] : [{ type: "text", text: `You are ${row.name} and this is your new Main conversation; the user started it from Bot settings. Check-ins, runners and automations report here now. Read your memory for context and don't redo finished work. Reply with one short line that you're here.`, mentions: [], visibility: "agent-only" }];
    let thread: { id: string };
    try {
      thread = await this.deps.sdk.threads.spawn({ projectId: PERSONAL_PROJECT_ID, title: row.name, environment: { type: "project-default" }, pluginMetadata: { bot: row.id }, ...model, input } as never);
    } catch (error) {
      if (noStoredModel(error)) throw new Error(SIGN_IN_FOR_MAIN);
      throw error;
    }
    try {
      await this.pointMain(row, thread.id, current);
    } catch (error) {
      await this.deps.sdk.threads.delete({ threadId: thread.id, childThreadsConfirmed: false }).catch(() => {});
      throw error;
    }
    return this.get(row.id);
  }

  /** Whether BB says a provider is signed in (providerStates); true when it can't say, so nothing is refused on a guess. */
  private async providerReady(providerId: string): Promise<boolean> {
    let states: readonly OnboardingProviderState[] | undefined;
    try { states = await this.deps.providerStates?.(); } catch { return true; }
    if (!states) return true;
    return states.some((state) => state.providerId === providerId && state.status === "ready");
  }

  /** A due run's thread is gone (src/triggers/scheduler.ts): when it was a Bot's Main, the new Main. */
  async rescueMain(threadId: string): Promise<string | null> {
    const bot = this.list().find((each) => each.threadId === threadId);
    if (!bot) return null;
    return this.heal(bot.id, threadId);
  }

  /** "deleted" or "archived" when a Bot's Main can't be used any more; null while it can (or BB can't say). */
  private async mainGone(threadId: string): Promise<"deleted" | "archived" | null> {
    try {
      const thread = await this.deps.sdk.threads.get({ threadId }) as { deletedAt?: number | null; archivedAt?: number | null } | null;
      if (!thread || thread.deletedAt != null) return "deleted";
      return thread.archivedAt != null ? "archived" : null;
    } catch (error) {
      return rpcErrorStatus(error) === 404 ? "deleted" : null;
    }
  }

  async set(input: { botId?: string; name?: string; avatar?: string; shape?: string | null; color?: string; role?: string }): Promise<BotView> {
    const before = this.need(input.botId);
    this.update(before, {
      ...(input.name ? { name: input.name } : {}), ...(input.avatar ? { avatar: input.avatar } : {}),
      ...(input.shape !== undefined ? { shape: input.shape } : {}), ...(input.color ? { color: input.color } : {}),
      ...(input.role !== undefined ? { role: input.role.trim() || null } : {}),
    });
    if (input.name && input.name !== before.name) await this.retitle(before, input.name);
    // The heartbeat's prompt carries the name, but it is read when the check-in runs (ProjectRuns.target),
    // so a rename schedules nothing: it can't fail half-way on a Main that is gone or has no model.
    return this.get(before.id);
  }

  private async retitle(before: BotRow, name: string): Promise<void> {
    const { threadId, memoryPageId } = this.view(before);
    if (threadId) {
      const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null) as { title?: string | null } | null;
      if (thread && thread.title?.trim() === before.name) await this.deps.sdk.threads.update({ threadId, title: name } as never).catch(() => {});
    }
    if (memoryPageId) this.deps.memory?.retitle?.(memoryPageId, `${before.name}'s core profile`, `${name}'s core profile`);
  }

  presenceOf(botId: string): Presence {
    const row = this.need(botId);
    return parsePresence(row.presence_json, row.id, this.isPrimary(row));
  }

  setPresence(input: { botId: string; presence: Presence }): Presence {
    const row = this.need(input.botId);
    this.deps.db.prepare("UPDATE bots SET presence_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(input.presence), Date.now(), row.id);
    this.deps.changed();
    this.deps.presenceChanged(row.id);
    return input.presence;
  }

  async setAppearance(input: { botId: string; appearance: Appearance | null }): Promise<BotView> {
    const row = this.need(input.botId);
    this.deps.db.prepare("UPDATE bots SET appearance_json = ?, updated_at = ? WHERE id = ?").run(input.appearance ? JSON.stringify(input.appearance) : null, Date.now(), row.id);
    this.deps.changed();
    this.deps.presenceChanged(row.id);
    return this.get(row.id);
  }

  // -------------------------------------------------------------------------
  // Self-edits: a Bot changing its own profile, recorded in bot_profile_changes
  // (append-only) so the user sees "Changed by <Bot>" and can revert.
  // -------------------------------------------------------------------------

  private recordChange(botId: string, actor: ProfileActor, field: ProfileField, oldValue: string | null, newValue: string | null, reverts: number | null = null): void {
    this.deps.db.prepare("INSERT INTO bot_profile_changes (bot_id, actor_bot_id, thread_id, field, old_value, new_value, reverts, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(botId, actor.botId, actor.threadId ?? null, field, oldValue, newValue, reverts, Date.now());
  }

  /**
   * A Bot (or an agent elsewhere, actor.botId null) edits a Bot's profile:
   * only SELF_EDITABLE fields (checkSelfEdit throws on the rest, state, model
   * and permissions included). Each field that changed is recorded.
   */
  async selfEdit(botId: string | undefined, changes: Record<string, unknown>, actor: ProfileActor): Promise<{ view: BotView; changed: SelfEditField[] }> {
    const input = checkSelfEdit(changes);
    const before = this.need(botId);
    const changed = (Object.keys(input) as SelfEditField[]).filter((key) => (before[key] ?? null) !== (key === "role" ? input.role || null : input[key]));
    if (!changed.length) return { view: await this.get(before.id), changed };
    const view = await this.set({
      botId: before.id,
      ...(changed.includes("name") ? { name: input.name! } : {}), ...(changed.includes("avatar") ? { avatar: input.avatar! } : {}),
      ...(changed.includes("shape") ? { shape: input.shape ?? null } : {}), ...(changed.includes("color") ? { color: input.color! } : {}),
      ...(changed.includes("role") ? { role: input.role ?? "" } : {}),
    });
    for (const field of changed) this.recordChange(before.id, actor, field, before[field] ?? null, field === "role" ? input.role || null : input[field] ?? null);
    this.deps.changed();
    return { view, changed };
  }

  /** The Bot's own edits and the user's reverts, newest first. */
  profileChanges(botId?: string, limit = 50): BotProfileChangeView[] {
    const row = this.need(botId);
    const rows = this.deps.db.prepare("SELECT * FROM bot_profile_changes WHERE bot_id = ? ORDER BY id DESC LIMIT ?").all(row.id, limit) as ProfileChangeRow[];
    const reverted = new Map((this.deps.db.prepare("SELECT reverts, at FROM bot_profile_changes WHERE bot_id = ? AND reverts IS NOT NULL").all(row.id) as { reverts: number; at: number }[]).map((each) => [each.reverts, each.at]));
    const names = new Map(this.rows().map((each) => [each.id, each.name]));
    return rows.map((each) => ({
      id: each.id, field: each.field, oldValue: each.old_value, newValue: each.new_value,
      actorBotId: each.actor_bot_id, actorName: each.actor_bot_id ? names.get(each.actor_bot_id) ?? null : null, threadId: each.thread_id,
      at: each.at, reverts: each.reverts, revertedAt: reverted.get(each.id) ?? null,
    }));
  }

  /** The user restores what a Bot's edit replaced; the revert is recorded too, so it can't be reverted twice. */
  async revertChange(botId: string | undefined, changeId: number): Promise<BotView> {
    const row = this.need(botId);
    const change = this.deps.db.prepare("SELECT * FROM bot_profile_changes WHERE id = ? AND bot_id = ?").get(changeId, row.id) as ProfileChangeRow | undefined;
    if (!change) throw new Error("No such change.");
    if (change.reverts !== null) throw new Error("That's a revert; change it in Bot info → Profile instead.");
    if (this.deps.db.prepare("SELECT 1 FROM bot_profile_changes WHERE reverts = ?").get(change.id)) throw new Error("That change is already reverted.");
    const user: ProfileActor = { botId: null };
    if (change.field === "avatarImage") throw new Error("Image avatars are retired; that change can't be reverted.");
    const field = change.field as SelfEditField;
    const current = row[field] ?? null;
    if (field === "name") await this.set({ botId: row.id, name: change.old_value ?? DEFAULT_BOT_NAME });
    else this.update(row, { [field]: field === "avatar" ? change.old_value ?? DEFAULT_BOT_AVATAR : change.old_value });
    this.recordChange(row.id, user, field, current, change.old_value, change.id);
    this.deps.changed();
    return this.get(row.id);
  }

  /** Makes a thread the primary Bot's ("Make this my Bot"), making the Bot if there is none. */
  async setThread(threadId: string): Promise<BotView> {
    const other = this.forThread(threadId);
    if (other && !other.primary) throw new Error(`That thread is ${other.name}'s.`);
    await this.deps.leads.setLead(PERSONAL_PROJECT_ID, threadId);
    if (!this.row()) this.insert(BOT_ID, DEFAULT_BOT_NAME, DEFAULT_BOT_AVATAR);
    await this.claimChains();
    this.deps.changed();
    return this.get();
  }

  /** Hides the Bots' chains from BB's thread list; a failure waits for the next sweep. */
  private async claimChains(): Promise<void> {
    await this.deps.claimChains?.().catch(() => {});
  }

  /** Turns a Bot's check-in on or off. An additional Bot's is its own schedule on its thread. */
  private async writeRun(row: BotRow, run: HeartbeatRun): Promise<void> {
    const key = this.runKey(row);
    if (key === PERSONAL_PROJECT_ID) await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
    else await this.deps.leads.runs.set(key, this.view(row).threadId, run);
  }

  async setRun(input: { botId?: string; enabled: boolean; cadence: HeartbeatRun["cadence"]; time?: string; cron?: string }): Promise<BotView> {
    const { botId, ...run } = input;
    const row = this.row(botId);
    if (botId && !row) throw new Error(`No Bot "${botId}".`);
    // Off is off: a heartbeat waiting to come back with a new Main (Resume) doesn't.
    if (!run.enabled && row?.heartbeat_was_on) this.deps.db.prepare("UPDATE bots SET heartbeat_was_on = 0 WHERE id = ?").run(row.id);
    if (run.enabled && row && row.state !== "active") throw new Error(`${row.name} is ${row.state}. Resume it before turning its check-ins on.`);
    // Check-ins need a Main to wake: with none, say so with the action, not store them off and report success.
    if (run.enabled && row && !this.view(row).threadId) throw new Error(`${row.name} has no Main conversation, so check-ins have nowhere to run. Pick one in Bot settings (or start a new one), then turn check-ins on.`);
    if (!row || this.isPrimary(row)) {
      await this.deps.leads.setRun(PERSONAL_PROJECT_ID, run);
      return this.get();
    }
    const current = this.deps.leads.runs.get(this.runKey(row));
    await this.writeRun(row, { enabled: run.enabled, cadence: run.cadence, time: run.time ?? current?.time ?? "09:00", ...(run.cron ?? current?.cron ? { cron: run.cron ?? current?.cron } : {}) });
    return this.get(row.id);
  }

  /**
   * A check-in preset: one schedule and, unless it's Off, one line on the
   * Memory page's Check-in section saying what to do then.
   */
  async checkinPreset(preset: CheckinPreset, botId?: string): Promise<BotView> {
    const row = this.row(botId);
    const spec = CHECKIN_PRESETS[preset];
    if (!spec.run.enabled) {
      if (row) {
        const run = this.deps.leads.runs.get(this.runKey(row));
        if (run?.enabled) await this.writeRun(row, { ...run, enabled: false });
      }
      return this.get(row?.id);
    }
    const view = await this.setRun({ ...spec.run, ...(botId ? { botId } : {}) });
    if (row && spec.line) this.addCheckin(row.id, spec.line);
    return view;
  }

  /** A Bot's thread and the ones it handed off from, oldest first: one continuous chat. */
  chain(botId?: string): string[] {
    const bot = this.stored(botId);
    return bot?.threadId ? this.threadChain(bot.threadId).reverse() : [];
  }

  /** The chain with each thread's title, read by id (hidden threads don't show in BB's own title lookup). "Untitled" only when BB has neither title. */
  async chainThreads(botId?: string): Promise<{ id: string; title: string }[]> {
    return Promise.all(this.chain(botId).map(async (id) => {
      const thread = await this.deps.sdk.threads.get({ threadId: id }).catch(() => null);
      return { id, title: thread?.title?.trim() || thread?.titleFallback?.trim() || "Untitled" };
    }));
  }

  /** A thread was handed off (thread_handoff): an additional Bot follows its thread, check-in included. */
  async handedOff(oldThreadId: string, newThreadId: string): Promise<void> {
    for (const row of this.rows()) {
      if (this.isPrimary(row) || row.thread_id !== oldThreadId) continue;
      this.deps.db.prepare("UPDATE bots SET thread_id = ?, updated_at = ? WHERE id = ?").run(newThreadId, Date.now(), row.id);
      const run = this.deps.leads.runs.get(this.runKey(row));
      if (run?.enabled) await this.deps.leads.runs.set(this.runKey(row), newThreadId, run);
      this.deps.changed();
    }
    // Check-ins and reminders follow whichever Bot's thread this was (the primary's too).
    let bot = false;
    for (const row of this.rows()) {
      if (this.view(row).threadId !== newThreadId) continue;
      bot = true;
      await this.deps.automations?.follow(row.id).catch(() => {});
    }
    if (bot) await this.claimChains();
  }

  /** Heartbeat off, remembering whether it was on; the Bot is told it's paused (botInstructions). */
  async pause(botId?: string): Promise<BotView> {
    const row = this.need(botId);
    if (row.state === "active") {
      const run = this.deps.leads.runs.get(this.runKey(row));
      // Persist before external work; a failed Pause must keep this across retries.
      if (run?.enabled) this.update(row, { heartbeat_was_on: 1 });
      if (run?.enabled) await this.writeRun(row, { ...run, enabled: false });
      // Its other check-ins, reminders and watchers too; Resume turns back on these.
      await this.deps.automations?.pauseAll(row.id, (id) => this.rememberPaused(row.id, "bot-automation", id));
      this.update(this.need(row.id), { state: "paused" });
    }
    return this.get(row.id);
  }

  async resume(botId?: string): Promise<BotView> {
    let row = this.need(botId);
    if (row.state !== "active") {
      // A Main lost while it was put away is replaced now, before its heartbeat comes back there.
      // If that fails the Bot still resumes: the heal keeps trying, and Bot settings can pick a Main.
      if (await this.restoreMain(row.id, undefined, true).catch(() => null)) row = this.need(row.id);
      // The heartbeat comes back first: if that fails the Bot stays paused and remembers it, so Resume can be retried.
      // With the Main still gone (a new one couldn't start yet), it waits for the new Main (pointMain), and Resume goes through.
      const run = this.deps.leads.runs.get(this.runKey(row));
      const main = this.view(row).threadId;
      const mainThere = !!main && !await this.mainGone(main);
      let waiting = false;
      if (row.heartbeat_was_on && run) {
        if (mainThere) await this.writeRun(row, { ...run, enabled: true });
        else waiting = true;
      }
      // Then what Stop paused; one that fails stays recorded and the Bot stays as it was.
      await this.restorePaused(row.id);
      this.update(this.need(row.id), { state: "active", heartbeat_was_on: waiting ? 1 : 0 });
      // The heal makes the new Main now that the Bot is active (it backs off while that keeps failing).
      if (waiting || !mainThere) void this.heal(row.id).catch(() => null);
    }
    return this.get(row.id);
  }

  /**
   * Turns back on the automations and runners Stop paused, forgetting each
   * one restored. Ones deleted since are forgotten quietly. Tries them all,
   * then throws the first failure, keeping the failed ones for a retry.
   */
  private async restorePaused(botId: string): Promise<void> {
    const rows = this.deps.db.prepare("SELECT kind, item_id, project_id FROM bot_stop_paused WHERE bot_id = ? ORDER BY rowid").all(botId) as { kind: string; item_id: string; project_id: string | null }[];
    const forget = this.deps.db.prepare("DELETE FROM bot_stop_paused WHERE bot_id = ? AND kind = ? AND item_id = ?");
    const listed = new Map<string, Promise<Map<string, boolean>>>();
    const outcomes = await mapPool(rows, 6, async (each) => {
      try {
        if (each.kind === "automation") {
          const projectId = each.project_id ?? PERSONAL_PROJECT_ID;
          let states = listed.get(projectId);
          if (!states) {
            states = this.automationStates(projectId);
            listed.set(projectId, states);
          }
          const enabled = (await states).get(each.item_id);
          if (enabled === false) await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_resume", input: { projectId, automationId: each.item_id } as never, outputSchema: z.unknown() });
        } else if (each.kind === "runner") {
          await this.deps.runners?.restore(each.item_id);
        } else if (each.kind === "bot-automation") {
          await this.deps.automations?.restore(each.item_id);
        }
        forget.run(botId, each.kind, each.item_id);
        return null;
      } catch (error) {
        return error;
      }
    });
    const firstFailure = outcomes.find((error) => error !== null);
    if (firstFailure) throw firstFailure;
  }

  /** Every automation in a project and whether it's on. Throws when the list fails, so nothing is taken for deleted. */
  private async automationStates(projectId: string): Promise<Map<string, boolean>> {
    const raw = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId } as never, outputSchema: z.unknown() });
    const rows = z.array(z.object({ id: z.string(), enabled: z.boolean() }).passthrough()).parse(raw);
    return new Map(rows.map((row) => [row.id, row.enabled]));
  }

  /** Records what Stop paused, for Resume. */
  private rememberPaused(botId: string, kind: "automation" | "runner" | "bot-automation", itemId: string, projectId: string | null = null): void {
    this.deps.db.prepare("INSERT OR IGNORE INTO bot_stop_paused (bot_id, kind, item_id, project_id) VALUES (?, ?, ?, ?)").run(botId, kind, itemId, projectId);
  }

  /** Pause, stop the running threads it spawned (spawnedBy; not forks of its chat), and pause automations that wake its thread and its runners; Resume restores those. */
  async stop(botId?: string): Promise<BotView & { stoppedThreadIds: string[]; pausedAutomationIds: string[] }> {
    const id = this.need(botId).id;
    await this.pause(id);
    const stoppedThreadIds: string[] = [];
    const pausedAutomationIds: string[] = [];
    const bot = this.stored(id);
    if (bot?.threadId) {
      const chain = new Set(this.threadChain(bot.threadId));
      const seenStop = new Set<string>();
      const toStop = (await this.startedThreads(bot.threadId)).filter((thread) => {
        // startedThreads merges overlapping lists: stop each thread once.
        if (thread.id === bot.threadId || seenStop.has(thread.id) || thread.archivedAt || !RUNNING.has(thread.status) || !spawnedBy(thread, chain)) return false;
        seenStop.add(thread.id);
        return true;
      });
      stoppedThreadIds.push(...await mapPool(toStop, 6, async (thread) => {
        await this.deps.sdk.threads.stop({ threadId: thread.id });
        return thread.id;
      }));
      const { projectId, rows } = await this.automations(bot.threadId);
      const toPause = rows.filter((automation) => automation.enabled);
      pausedAutomationIds.push(...await mapPool(toPause, 6, async (automation) => {
        await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_pause", input: { projectId, automationId: automation.id } as never, outputSchema: z.unknown() });
        this.rememberPaused(id, "automation", automation.id, projectId);
        return automation.id;
      }));
    }
    await this.deps.runners?.pauseAll(id, (runnerId) => this.rememberPaused(id, "runner", runnerId));
    this.update(this.need(id), { state: "stopped" });
    return { ...(await this.get(id)), stoppedThreadIds, pausedAutomationIds };
  }

  /** A Bot's old core profile page, when it still exists; none is made any more (its text is the always-on skill now). */
  memoryPage(botId?: string): string | null {
    const row = this.row(botId);
    const pages = this.deps.memory;
    if (!row || !pages || botKind(row.provider_id) === "external") return null;
    return row.memory_page_id && pages.exists(row.memory_page_id) ? row.memory_page_id : null;
  }

  /** What a Bot's own thread is told. Its always-on skills come in full through src/memory; the list here is its on-demand ones. */
  instructions(bot: NonNullable<BotView["bot"]>, options: { skillsSlot?: boolean } = {}): string {
    if (bot.kind === "external") return externalBotInstructions(bot);
    if (bot.state !== "active") return botInstructions(bot);
    return botInstructions({ ...bot, skills: this.onDemandSkills(bot.id), ...(options.skillsSlot ? { skillsSlot: true } : {}) });
  }

  /** The skills a Bot loads when a task matches: not archived, not always on. */
  onDemandSkills(botId?: string): BotSkillView[] {
    return this.skills(botId).filter((skill) => skill.state !== "archived" && !skill.alwaysOn);
  }

  // Always-on skills (src/core-skill.ts) -------------------------------------

  /** Gives a Studio Bot its always-on core skill once, from its core profile page when it has one. */
  ensureCore(botId?: string): CoreMigration | null {
    const row = this.row(botId);
    if (!row || botKind(row.provider_id) === "external") return null;
    return migrateCoreSkill({ db: this.deps.db, skills: this.skillStore, pageMarkdown: (pageId) => this.deps.memory?.markdown?.(pageId) ?? null }, row.id);
  }

  /**
   * Drops the retired memory tables once every Studio Bot has its core
   * skill (src/core-skill-migrate.ts dropRetiredMemory); null while one
   * hasn't.
   */
  retireMemoryTables(): { dropped: string[] } | null {
    const rows = this.deps.db.prepare("SELECT id, provider_id FROM bots").all() as { id: string; provider_id: string | null }[];
    return dropRetiredMemory(this.deps.db, rows.filter((row) => botKind(row.provider_id) !== "external").map((row) => row.id));
  }

  /** The Bot's always-on skills (made on first need), its core skill first. */
  alwaysOnSkills(botId?: string): { name: string; description: string; body: string; updatedAt: number; core: boolean }[] {
    const row = this.row(botId);
    if (!row || botKind(row.provider_id) === "external") return [];
    this.ensureCore(row.id);
    return this.skillStore.alwaysOn(row.id);
  }

  /** Characters the always-on skills use together, against ALWAYS_ON_CAP. */
  skillBudget(botId?: string): { chars: number; cap: number; over: boolean } {
    return this.skillStore.budget(this.need(botId).id);
  }

  /** The advisory notes a save of this skill would get (always-on budget and caps included). */
  skillLint(input: { name: string; body: string; alwaysOn?: boolean }, botId?: string): string[] {
    const row = this.need(botId);
    return this.skillStore.lint(row.id, { ...input, alwaysOn: input.alwaysOn ?? !!this.skillStore.get(row.id, input.name)?.alwaysOn });
  }

  setSkillAlwaysOn(name: string, on: boolean, botId?: string): boolean {
    const row = this.row(botId);
    return row ? this.skillStore.setAlwaysOn(row.id, name, on) : false;
  }

  /**
   * The Bot's core skill: the one its marker (bot_core_skills.skill_name)
   * names, while it exists and is always on; never picked by name or order.
   * `migrated`: its text came from a core profile page and the user hasn't
   * edited it since. Null without one (made on first need).
   */
  coreSkill(botId?: string): { name: string; description: string; body: string; updatedAt: number; migrated: boolean; tidyAskedAt: number | null } | null {
    const core = this.alwaysOnSkills(botId).find((skill) => skill.core);
    if (!core) return null;
    const mark = this.deps.db.prepare("SELECT source_page_id, user_edited_at, tidy_asked_at FROM bot_core_skills WHERE bot_id = ?").get(this.need(botId).id) as { source_page_id: string | null; user_edited_at: number | null; tidy_asked_at: number | null } | undefined;
    return { name: core.name, description: core.description, body: core.body, updatedAt: core.updatedAt, migrated: !!mark?.source_page_id && !mark.user_edited_at, tidyAskedAt: mark?.tidy_asked_at ?? null };
  }

  /** The user edited a skill in Studio's UI: an edit to the core skill makes its text theirs, so Maintenance may tidy it. */
  userEditedSkill(name: string, botId?: string, now = Date.now()): void {
    const row = this.row(botId);
    if (row) this.deps.db.prepare("UPDATE bot_core_skills SET user_edited_at = ? WHERE bot_id = ? AND skill_name = ?").run(now, row.id, name);
  }

  /** Maintenance asked the Bot to tidy its core skill (at most weekly). */
  noteCoreTidyAsked(botId: string, now = Date.now()): void {
    this.deps.db.prepare("UPDATE bot_core_skills SET tidy_asked_at = ? WHERE bot_id = ?").run(now, botId);
  }

  /** Adds a line to the core skill's "## Check-in" section; false when it was there already, or there's no core skill. */
  addCheckin(botId: string, line: string): boolean {
    const core = this.coreSkill(botId);
    if (!core) return false;
    const body = addCheckinLine(core.body, line);
    if (body === null) return false;
    this.skillStore.write(botId, { name: core.name, description: core.description, body });
    return true;
  }

  skills(botId?: string): BotSkillView[] {
    const row = this.row(botId);
    return row ? this.skillStore.list(row.id) : [];
  }

  skill(name: string, botId?: string): (BotSkillView & { body: string }) | null {
    const row = this.row(botId);
    return row ? this.skillStore.get(row.id, name) : null;
  }

  searchSkills(query: string, limit = 10, botId?: string): SkillHit[] {
    const row = this.row(botId);
    return row ? this.skillStore.search(row.id, query, limit) : [];
  }

  /** The Bot loaded a skill (bot_skill_view): it's in use, so a stale one is active again. */
  touchSkill(name: string, botId?: string): void {
    const row = this.row(botId);
    if (row) this.skillStore.touch(row.id, name);
  }

  /** The curator's and Restore's state change; archived skills are hidden from the Bot, never deleted. */
  setSkillState(name: string, state: "active" | "stale" | "archived", botId?: string): boolean {
    const row = this.row(botId);
    return row ? this.skillStore.setState(row.id, name, state) : false;
  }

  /** Pinned skills are exempt from the curator. */
  pinSkill(name: string, pinned: boolean, botId?: string): boolean {
    const row = this.row(botId);
    return row ? this.skillStore.pin(row.id, name, pinned) : false;
  }

  /** Adds or replaces one of a Bot's own skills. Only its thread loads them. */
  writeSkill(input: { name: string; description: string; body: string; alwaysOn?: boolean; ifBody?: string | null }, botId?: string): BotSkillView {
    const id = this.need(botId).id;
    const view = this.skillStore.write(id, input);
    // Always on means in every prompt: pinned, so the curator never retires it.
    if (input.alwaysOn) { this.skillStore.setAlwaysOn(id, input.name, true); return this.skillStore.list(id).find((skill) => skill.name === input.name) ?? view; }
    return view;
  }

  /** All content versions, including removed skills; reverting appends another version. */
  skillHistory(botId?: string, before?: number, name?: string) {
    return this.skillStore.history(this.need(botId).id, before, name);
  }

  revertSkill(versionId: number, botId?: string): void {
    this.skillStore.revert(this.need(botId).id, versionId);
  }

  /** Model findings are advisory and belong to the exact version inspected. */
  lintSkillVersion(versionId: number, warnings: string[], botId?: string): void {
    this.skillStore.lintVersion(this.need(botId).id, versionId, warnings);
  }

  deleteSkill(name: string, botId?: string): boolean {
    const row = this.row(botId);
    return row ? this.skillStore.delete(row.id, name) : false;
  }

  /** Share: moves a skill into BB's user skills, where every agent finds it. */
  async shareSkill(name: string, botId?: string): Promise<{ path: string }> {
    const row = this.row(botId);
    if (!row) throw new Error(`Your Bot has no skill "${name}".`);
    return this.skillStore.share(row.id, name);
  }

  /** Searches a Bot's own threads (its handoff chain and threads it started) through BB's thread search. */
  async historySearch(query: string, limit = 10, botId?: string): Promise<{ threadId: string; title: string; text: string }[]> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return [];
    const mine = new Set([...this.threadChain(bot.threadId), ...(await this.startedThreads(bot.threadId)).map((thread) => thread.id)]);
    const found = await this.deps.sdk.threads.search({ query, limitPerGroup: "50" });
    const hits: { threadId: string; title: string; text: string }[] = [];
    for (const result of [...found.active.results, ...found.archived.results]) {
      if (!mine.has(result.thread.id)) continue;
      const title = result.thread.title || result.thread.titleFallback || "Untitled thread";
      for (const match of result.matches.slice(0, 2)) hits.push({ threadId: result.thread.id, title, text: match.text.slice(0, 400) });
      if (hits.length >= limit) break;
    }
    return hits.slice(0, limit);
  }

  /** A Bot's thread and the ones it handed off from, newest first. */
  private threadChain(threadId: string): string[] {
    const chain = [threadId];
    const previous = this.deps.db.prepare("SELECT old_thread_id FROM project_thread_handoffs WHERE new_thread_id = ?");
    for (let i = 0; i < 20; i++) {
      const row = previous.get(chain.at(-1)) as { old_thread_id: string } | undefined;
      if (!row || chain.includes(row.old_thread_id)) break;
      chain.push(row.old_thread_id);
    }
    return chain;
  }

  /** Threads a Bot started (any depth), its own excluded: where adoptable runners come from. */
  async started(botId?: string): Promise<{ id: string; title: string; projectId: string | null; parentThreadId?: string | null }[]> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return [];
    return (await this.workThreads(bot.threadId, bot.id)).filter((thread) => thread.id !== bot.threadId)
      .map((thread) => ({ id: thread.id, title: thread.title || thread.titleFallback || "Untitled thread", projectId: thread.projectId ?? null, parentThreadId: thread.parentThreadId ?? null }));
  }

  /**
   * The Bot's thread and every thread it started. Hidden threads count: the
   * threads a Bot owns are hidden from BB's list and live here
   * (src/bot-owned.ts). A hidden fork doesn't (a side chat, a skill review).
   */
  private async startedThreads(threadId: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const chain = new Set(this.threadChain(threadId));
    const threads = this.deps.sdk.threads;
    const lists = await Promise.all([
      ...[...chain].flatMap((id) => [threads.list({ sourceThreadId: id, archived: false, includeHidden: true, limit: 100 }), threads.list({ parentThreadId: id, archived: false, includeHidden: true, limit: 100 })]),
      threads.list({ archived: false, includeHidden: true, limit: 200 }),
    ].map((list) => list.catch(() => [] as ListedThread[])));
    // A listed thread says whether it waits on the user; a fetched one doesn't,
    // so its pending interactions say. The Bot's chat is hidden from BB's
    // list (and its attention), and Needs you still finds its question.
    const own = lists.flat().find((thread) => thread.id === threadId) ?? await this.fetched(threadId);
    return [...(own ? [own as ActivityThread] : []), ...lists.flat().filter((thread) => thread.id !== threadId && !hiddenFork(thread) && startedBy(thread, chain))];
  }

  /** One thread by id, with whether an interaction waits on the user. */
  private async fetched(threadId: string): Promise<(ActivityThread & Partial<ListedThread>) | null> {
    const [thread, interactions] = await Promise.all([
      this.deps.sdk.threads.get({ threadId }).catch(() => null),
      this.deps.sdk.threads.interactions.list({ threadId }).catch(() => [] as { status?: string }[]),
    ]);
    return thread ? { ...thread, hasPendingInteraction: interactions.some((interaction) => (interaction as { status?: string }).status === "pending") } as ActivityThread & Partial<ListedThread> : null;
  }

  /** startedThreads, the threads the Bot owns otherwise (its automations' runs), and the threads those started, at any depth, from the recent list. */
  private async workThreads(threadId: string, botId?: string): Promise<(ActivityThread & Partial<ListedThread>)[]> {
    const [started, recent] = await Promise.all([
      this.startedThreads(threadId),
      this.deps.sdk.threads.list({ archived: false, includeHidden: true, limit: 200 }).catch(() => [] as ListedThread[]),
    ]);
    const owned = botId ? this.deps.ownedThreads?.(botId) ?? new Set<string>() : new Set<string>();
    // A fork the user handed the Bot is hidden now too, but it's the Bot's.
    const visible = recent.filter((thread) => owned.has(thread.id) || !hiddenFork(thread));
    const startedIds = new Set(started.map((thread) => thread.id));
    const runs = visible.filter((thread) => owned.has(thread.id) && !startedIds.has(thread.id) && thread.id !== threadId);
    return [...started, ...runs, ...descendants(visible, new Set([...started, ...runs].map((thread) => thread.id).filter((id) => id !== threadId)))];
  }

  private async automations(threadId: string): Promise<{ projectId: string | null; rows: AutomationRow[] }> {
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null);
    const projectId = thread?.projectId ?? PERSONAL_PROJECT_ID;
    const raw = await this.deps.sdk.plugins.callRpc({ pluginId: "automations", method: "automations_list", input: { projectId } as never, outputSchema: z.unknown() }).catch(() => []);
    const rows = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
      const parsed = automationRow.safeParse(entry);
      return parsed.success && parsed.data.execution.targetThreadId === threadId ? [parsed.data] : [];
    });
    return { projectId, rows };
  }

  /**
   * The Bot's one "needs you" signal: a pending question or approval in its
   * chat, or a reply the user hasn't read (src/bot-attention.ts).
   */
  private async attention(threadId: string, thread: { lastReadAt?: number | null } | undefined): Promise<BotAttention | null> {
    const [interactions, events] = await Promise.all([
      this.deps.sdk.threads.interactions.list({ threadId }).catch(() => []) as Promise<{ status?: string; payload?: { kind?: string } | null; createdAt?: number }[]>,
      Promise.resolve().then(() => this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "40", types: ["item/completed"] })).catch(() => []) as Promise<{ createdAt?: number; data?: { item?: { type?: string; text?: string } } }[]>,
    ]);
    const replies = events.flatMap((event) => event.data?.item?.type === "agentMessage" && typeof event.data.item.text === "string" && event.createdAt ? [{ createdAt: event.createdAt, text: event.data.item.text }] : []);
    return botAttention({ loopsEnabled: this.deps.loopsEnabled?.() ?? false, loops: this.deps.loopsEnabled?.() && this.stored()?.threadId === threadId ? new LoopStore(this.deps.db).all().filter(l=>l.status==='surfaced'&&l.owner==='patrick'&&l.kind!=='waiting') : [], lastReadAt: thread?.lastReadAt ?? null, interactions: pendingInteractions(interactions), replies });
  }

  /** A Bot's attention alone (bot_attention): its chat, nothing else. */
  async botAttention(botId?: string): Promise<BotAttention | null> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return null;
    const thread = await this.deps.sdk.threads.get({ threadId: bot.threadId }).catch(() => undefined);
    return this.attention(bot.threadId, thread);
  }

  /**
   * bot_attention: the Bot's attention, whether there's a Bot with a chat at
   * all (no Bot: clients fall back to BB's own count), and whether its chat is
   * busy. The chat is a hidden thread, which BB leaves out of the sidebar's
   * live thread view, so its row reads busy here; thread.active and
   * thread.idle publish Studio's realtime signal, which refreshes it.
   */
  async attentionView(botId?: string): Promise<{ attention: BotAttention | null; hasBot: boolean; working: boolean }> {
    const bot = this.stored(botId);
    if (!bot?.threadId) return { attention: null, hasBot: false, working: false };
    const thread = await this.deps.sdk.threads.get({ threadId: bot.threadId }).catch(() => undefined) as { status?: string; lastReadAt?: number | null } | undefined;
    return { attention: await this.attention(bot.threadId, thread), hasBot: true, working: BUSY_CHAT.has(thread?.status ?? "") };
  }

  async activity(botId?: string): Promise<BotActivityView> {
    const { bot, run } = await this.get(botId);
    if (!bot?.threadId) return { attention: null, inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
    const [threads, automations, output] = await Promise.all([
      this.workThreads(bot.threadId, bot.id),
      this.automations(bot.threadId),
      this.deps.sdk.threads.output({ threadId: bot.threadId }).catch(() => ({ output: null })),
    ]);
    const runnerThreads = this.deps.runners?.threads(bot.id) ?? new Set<string>();
    const hidden = this.deps.hiddenThreads?.() ?? new Set<string>();
    const { inProgress, waiting, completed } = classifyActivity(threads.filter((thread) => !runnerThreads.has(thread.id) && !hidden.has(thread.id)), bot.threadId);
    const attention = await this.attention(bot.threadId, threads.find((thread) => thread.id === bot.threadId));
    const HEARTBEAT_NAME = heartbeatName(bot.primary === false ? `${BOT_RUN_PREFIX}${bot.id}` : PERSONAL_PROJECT_ID);
    const scheduled: BotScheduledView[] = automations.rows.filter((automation) => !automation.execution.targetThreadId || !runnerThreads.has(automation.execution.targetThreadId)).map((automation) => ({
      id: automation.id,
      kind: automation.name === HEARTBEAT_NAME ? "heartbeat" : "automation",
      name: automation.name === HEARTBEAT_NAME ? "Check-in (heartbeat)" : automation.name,
      cron: automation.trigger.cron ?? null,
      enabled: automation.enabled,
      nextRunAt: automation.nextRunAt ?? null,
    }));
    // Check-ins, reminders and the check-in run on Studio's scheduler, so they come from Studio, not BB's list.
    for (const each of this.deps.automations?.scheduled?.(bot.id) ?? []) if (!scheduled.some((listed) => listed.id === each.id)) scheduled.push({ ...each, kind: "automation" });
    if (run && !scheduled.some((each) => each.kind === "heartbeat")) {
      const key = bot.primary === false ? `${BOT_RUN_PREFIX}${bot.id}` : PERSONAL_PROJECT_ID;
      const status = this.deps.leads.runs.status(key);
      scheduled.unshift({ id: (status && this.deps.leads.runs.automation(key)?.id) || "heartbeat", kind: "heartbeat", name: "Check-in (heartbeat)", cron: status ? heartbeatCron(run) : null, enabled: run.enabled, nextRunAt: run.enabled ? status?.nextRunAt ?? null : null });
    }
    scheduled.sort((a, b) => Number(b.kind === "heartbeat") - Number(a.kind === "heartbeat") || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
    const latest = output?.output ? output.output.slice(-1200) : null;
    const compactions = (this.deps.db.prepare("SELECT thread_id AS threadId, at, tokens FROM bot_cache_compactions WHERE bot_id = ? ORDER BY at").all(bot.id) as { threadId: string; at: number; tokens: number | null }[]);
    // Running rows count up from their turn's start.
    const running = await Promise.all(inProgress.map(async (thread) => ({ ...thread, runningSince: await turnStartedAt(this.deps.sdk, thread.id) })));
    // A thread waiting on an answer says what for (a question or an approval).
    const withReasons = await Promise.all(running.map(async (thread) => thread.waitingFor ? { ...thread, waitingFor: threadWaitingFor(await this.deps.sdk.threads.interactions.list({ threadId: thread.id }).catch(() => [])) } : thread));
    return { attention, inProgress: withReasons, waiting, scheduled, completed, latest, compactions };
  }
}
