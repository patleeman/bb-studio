// Move threads to another provider, many at once, from Studio
// (`bbs studio move-provider`). Per thread: W2's handoff (moveProvider.prepare)
// first, then core's POST /api/v1/threads/:id/move-provider, which clears the
// provider session and swaps provider and model in one transaction. Then the
// Studio side: BB automations and Studio automations that target the thread,
// Bots' default models, router rules.
//
// Idempotent and resumable. A thread already on the target is
// "already-moved" without a core call, and its patches run again (each one
// only when it isn't on the target yet), so a crash between the core move and
// a patch is finished by the next run. The KV ledger records each thread's
// outcome and the request; a re-run retries failed and deferred threads.
//
// A running thread is deferred: the ledger keeps the request and the watcher
// (onIdle) moves it once it is idle. Once the watcher has claimed a thread it
// finishes that thread's move even if Studio is disposing: it never stops
// between the claim and the side effect. After dispose it claims no new one.
//
// The dry run is the same code with the side effects swapped for "would":
// the same threads in the same order with the same reasons.
import {
  coreOutcome, DEFAULT_HISTORY_TOKENS, ledgerStateFor, LEDGER_KEY, parseLedger, rewriteRouterPolicy, summarize, targetPermission,
  type AutomationItem, type BotDefaultItem, type CoreMoveBody, type CoreMoveResponse, type Ledger, type LedgerEntry, type MoveRequest,
  type PermissionMode, type Role, type RouterItem, type RouterPolicy, type Summary, type ThreadItem,
} from "./core";

export interface ThreadInfo {
  id: string;
  title: string;
  providerId: string | null;
  model: string | null;
  permission: PermissionMode | null;
  status: string;
  archived: boolean;
  projectId: string | null;
}

export interface PrepareResult { ok: boolean; transcriptPath?: string | null; verbatimTurns?: number; outlinedTurns?: number; bytes?: number; error?: string }

/** An agent automation in BB's automations plugin. */
export interface BbAutomation {
  id: string;
  projectId: string;
  name: string;
  execution: { mode?: string; targetThreadId?: string | null; providerId?: string | null; model?: string | null; permissionMode?: string | null } & Record<string, unknown>;
}

/** A Studio automation (bot_automations) with a model of its own. */
export interface StudioAutomation { id: string; name: string; threadId: string; providerId: string | null; model: string | null }

export interface BotRef { id: string; name: string; threadId: string | null; defaultModel: { providerId: string; model: string } | null }

export interface TargetCheck { known: boolean; ready: boolean; models: string[]; defaultModel: string | null; permissionModes: PermissionMode[] | null }

export interface MoveEventStatus {
  /** The newest thread/provider-move operation, or null when the thread has none. */
  move: { seq: number; at: number; to: { providerId: string; model: string | null } } | null;
  /** A turn started after it. */
  turnStarted: boolean;
  /** A turn after it completed: the move is rebuilt (W1's meaning), and the handoff can be forgotten. */
  turnCompleted: boolean;
}

export interface Kv { get(key: string): Promise<unknown> | unknown; set(key: string, value: unknown): Promise<void> | void }

export interface MoveDeps {
  kv: Kv;
  /** Threads (hidden ones too) on a provider, in a project when given; archived ones only when asked. */
  listThreads(filter: { providerId?: string; projectId?: string; includeArchived: boolean }): Promise<ThreadInfo[]>;
  /** These threads, archived ones included; unknown ids left out. */
  getThreads(ids: readonly string[]): Promise<ThreadInfo[]>;
  bots(): BotRef[];
  /** A Bot's Main chain and every thread it started. */
  botThreads(botId: string): Promise<string[]>;
  /** Runner threads, a Bot's or every Bot's. */
  runnerThreads(botId?: string): { id: string; threadId: string; name: string; botId: string }[];
  /** Project leads' threads, for the role column. */
  leadThreads(): Promise<string[]>;
  target(providerId: string): Promise<TargetCheck>;
  coreMove(threadId: string, body: CoreMoveBody): Promise<CoreMoveResponse>;
  prepare(threadId: string, input: { from: { providerId: string; model: string | null }; to: { providerId: string; model: string }; historyTokens: number }): Promise<PrepareResult>;
  bbAutomations(): Promise<BbAutomation[]>;
  updateBbAutomation(automation: BbAutomation, execution: BbAutomation["execution"]): Promise<void>;
  studioAutomations(threadIds: readonly string[]): StudioAutomation[];
  setStudioAutomationModel(id: string, providerId: string, model: string): void;
  setBotDefault(botId: string, providerId: string, model: string): Promise<void>;
  router?: { get(): Promise<RouterPolicy>; set(policy: RouterPolicy): Promise<void> };
  moveEvents(threadId: string): Promise<MoveEventStatus>;
  /** W2: whether the stored handoff was delivered to the first turn; null when it can't say. */
  handoffDelivered?(threadId: string, moveAt: number | null): Promise<boolean | null>;
  /** Asks a thread one quiet question and returns its answer (verify --probe). */
  ask?(threadId: string, question: string): Promise<string>;
  now?(): number;
  log?(line: string): void;
}

export interface Selection {
  ids: string[];
  from?: string;
  projectId?: string;
  bot?: string;
  includeArchived: boolean;
  runners: boolean;
}

export interface MoveOptions {
  to: string;
  /** The provider's default model when not given. */
  model?: string;
  permission?: PermissionMode;
  historyTokens?: number;
  dryRun: boolean;
  /** Patch BB and Studio automations that target moved threads. */
  automations: boolean;
  botDefaults: boolean;
  routerRules: boolean;
  /** A running thread is skipped, not deferred. */
  noDefer?: boolean;
  /** The thread running this command: never moved from inside itself. */
  callerThreadId?: string | null;
}

export interface MoveReport {
  dryRun: boolean;
  to: { providerId: string; model: string; permission: PermissionMode | null; historyTokens: number };
  threads: ThreadItem[];
  automations: AutomationItem[];
  botDefaults: BotDefaultItem[];
  router: RouterItem | null;
  summary: Summary;
}

export class MoveInputError extends Error {}

const RUNNING = new Set(["starting", "active", "stopping"]);

export class MoveProviderService {
  private ledgerWrite: Promise<unknown> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  private disposed = false;

  constructor(private readonly deps: MoveDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  async ledger(): Promise<Ledger> {
    return parseLedger(await this.deps.kv.get(LEDGER_KEY));
  }

  /** One read-modify-write at a time, so two threads finishing together both land. */
  private record(threadId: string, entry: LedgerEntry): Promise<void> {
    const write = this.ledgerWrite.then(async () => {
      const ledger = await this.ledger();
      ledger[threadId] = entry;
      await this.deps.kv.set(LEDGER_KEY, ledger);
    });
    this.ledgerWrite = write.catch(() => {});
    return write;
  }

  /** The selected threads, Main threads last, each once. */
  async select(selection: Selection): Promise<{ threads: ThreadInfo[]; roles: Map<string, Role>; botIds: string[] }> {
    const bots = this.deps.bots();
    const bot = selection.bot ? resolveBot(bots, selection.bot) : null;
    if (selection.bot && !bot) throw new MoveInputError(`No Bot ${JSON.stringify(selection.bot)}. Bots: ${bots.map((each) => each.name).join(", ") || "none"}.`);
    if (!selection.ids.length && !selection.from && !selection.projectId && !bot && !selection.runners) throw new MoveInputError("Nothing selected: give thread ids, --from, --project, --bot or --runners.");
    const runners = this.deps.runnerThreads(bot?.id);
    const leads = new Set(await this.deps.leadThreads().catch(() => [] as string[]));
    const mains = new Set(bots.map((each) => each.threadId).filter((id): id is string => !!id));
    const runnerIds = new Set(this.deps.runnerThreads().map((runner) => runner.threadId));
    const roles = new Map<string, Role>();
    const roleOf = (id: string): Role => mains.has(id) ? "main" : runnerIds.has(id) ? "runner" : leads.has(id) ? "lead" : "other";

    let pool: ThreadInfo[];
    const explicit = new Set(selection.ids);
    if (selection.from || selection.projectId) {
      pool = await this.deps.listThreads({ providerId: selection.from, projectId: selection.projectId, includeArchived: selection.includeArchived });
    } else {
      pool = [];
    }
    // A Bot or runners narrow the provider/project list, or select on their own.
    const scoped = new Set<string>();
    if (bot) for (const id of await this.deps.botThreads(bot.id)) scoped.add(id);
    if (selection.runners) for (const runner of runners) scoped.add(runner.threadId);
    if (bot || selection.runners) {
      if (selection.from || selection.projectId) pool = pool.filter((thread) => scoped.has(thread.id));
      else pool = await this.deps.getThreads([...scoped]);
      if (selection.from) pool = pool.filter((thread) => thread.providerId === selection.from);
    }
    const missingIds = [...explicit].filter((id) => !pool.some((thread) => thread.id === id));
    if (missingIds.length) pool = [...pool, ...await this.deps.getThreads(missingIds)];
    const unknown = [...explicit].filter((id) => !pool.some((thread) => thread.id === id));
    if (unknown.length) throw new MoveInputError(`No thread ${unknown.join(", ")}.`);
    // Archived threads only when asked for, or by id.
    const seen = new Set<string>();
    const threads = pool.filter((thread) => {
      if (seen.has(thread.id)) return false;
      seen.add(thread.id);
      return explicit.has(thread.id) || selection.includeArchived || !thread.archived;
    });
    for (const thread of threads) roles.set(thread.id, roleOf(thread.id));
    threads.sort((a, b) => Number(roles.get(a.id) === "main") - Number(roles.get(b.id) === "main") || a.id.localeCompare(b.id));
    const botIds = bot ? [bot.id] : selection.from ? bots.filter((each) => each.defaultModel?.providerId === selection.from).map((each) => each.id) : [];
    return { threads, roles, botIds };
  }

  async move(selection: Selection, options: MoveOptions): Promise<MoveReport> {
    const target = await this.deps.target(options.to);
    if (!target.known) throw new MoveInputError(`No provider ${options.to}.`);
    const model = options.model ?? target.defaultModel;
    if (!model) throw new MoveInputError(`${options.to} has no default model; give --model.`);
    if (target.models.length && !target.models.includes(model)) throw new MoveInputError(`${options.to} doesn't offer ${model}. It offers: ${target.models.slice(0, 20).join(", ")}.`);
    const historyTokens = options.historyTokens ?? DEFAULT_HISTORY_TOKENS;
    if (!Number.isInteger(historyTokens) || historyTokens < 1) throw new MoveInputError("--history-tokens is a whole number of at least 1.");
    const { threads, roles, botIds } = await this.select(selection);
    const request: MoveRequest = { providerId: options.to, model, permission: options.permission ?? null, historyTokens, patchAutomations: options.automations || selection.runners };
    const items: ThreadItem[] = [];
    for (const thread of threads) {
      items.push(await this.moveOne(thread, roles.get(thread.id) ?? "other", request, { dryRun: options.dryRun, noDefer: !!options.noDefer, callerThreadId: options.callerThreadId ?? null, supported: target.permissionModes }));
    }
    // Automations follow every thread that is (or would be) on the target.
    const onTarget = items.filter((item) => item.result === "moved" || item.result === "already-moved" || item.result === "would-move");
    const automations = request.patchAutomations ? await this.patchAutomations(onTarget, request, options.dryRun, target.permissionModes) : [];
    for (const item of items) item.automationsPatched = automations.filter((each) => each.threadId === item.threadId && (each.result === "patched" || each.result === "would-patch")).map((each) => each.automationId);
    const botDefaults = options.botDefaults ? await this.patchBotDefaults(botIds, options.to, model, options.dryRun) : [];
    const router = options.routerRules ? await this.patchRouter(selection.from, options.to, model, options.dryRun) : null;
    return { dryRun: options.dryRun, to: { providerId: options.to, model, permission: options.permission ?? null, historyTokens }, threads: items, automations, botDefaults, router, summary: summarize(items) };
  }

  /** One thread, start to end. Records its outcome unless this is a dry run or a plain skip. */
  private async moveOne(thread: ThreadInfo, role: Role, request: MoveRequest, run: { dryRun: boolean; noDefer: boolean; callerThreadId: string | null; supported: PermissionMode[] | null }): Promise<ThreadItem> {
    const from = { providerId: thread.providerId ?? "", model: thread.model, permission: thread.permission };
    const base = { threadId: thread.id, title: thread.title, role, from, automationsPatched: [] as string[] };
    const decision = targetPermission(thread.permission, request.permission, request.providerId, run.supported);
    const to = { providerId: request.providerId, model: request.model, permission: decision.ok ? decision.mode : null };
    const item = (result: ThreadItem["result"], extra: Partial<ThreadItem> = {}): ThreadItem => ({ ...base, to, result, ...extra });
    const finish = async (done: ThreadItem): Promise<ThreadItem> => {
      let state = run.dryRun ? null : ledgerStateFor(done.result);
      if (state) {
        const previous = (await this.ledger())[thread.id];
        // A re-run of a thread this ledger moved keeps "moved".
        if (state === "already-moved" && previous?.state === "moved") state = "moved";
        await this.record(thread.id, { state, error: done.reason ? `${done.reason}${done.detail ? `: ${done.detail}` : ""}` : null, at: this.now(), attempts: (previous?.attempts ?? 0) + (state === "already-moved" ? 0 : 1), from: previous?.from ?? (thread.providerId ? { providerId: thread.providerId, model: thread.model } : null), request });
      }
      return done;
    };

    if (run.callerThreadId && thread.id === run.callerThreadId) return item("skipped", { reason: "current-thread", detail: "never moved from inside itself; run this from another thread" });
    if (thread.providerId === request.providerId && thread.model === request.model) return finish(item("already-moved"));
    if (!thread.providerId) return finish(item("failed", { reason: "no-provider", detail: "the thread has no provider" }));
    if (!decision.ok) return finish(item("failed", { reason: decision.reason, detail: decision.detail }));
    if (RUNNING.has(thread.status)) return run.noDefer ? item("skipped", { reason: "running" }) : finish(item("deferred", { reason: "running" }));

    // An archived thread is here only because it was asked for (by id or --include-archived).
    const body: CoreMoveBody = { providerId: request.providerId, model: request.model, permissionMode: decision.mode, historyTokens: request.historyTokens, ...(thread.archived ? { includeArchived: true } : {}) };
    if (run.dryRun) {
      const outcome = coreOutcome(await this.deps.coreMove(thread.id, { ...body, dryRun: true }).catch((error) => ({ status: 0, body: { message: errorText(error) } })));
      if (outcome.kind === "busy") return item(run.noDefer ? "skipped" : "deferred", { reason: "busy" });
      if (outcome.kind === "failed") return item("failed", { reason: outcome.reason, detail: outcome.detail });
      return item(outcome.result === "already-moved" ? "already-moved" : "would-move");
    }
    // The handoff first: a thread is never moved without one.
    let prepared: PrepareResult;
    try {
      prepared = await this.deps.prepare(thread.id, { from: { providerId: thread.providerId, model: thread.model }, to: { providerId: request.providerId, model: request.model }, historyTokens: request.historyTokens });
    } catch (error) {
      prepared = { ok: false, error: errorText(error) };
    }
    if (!prepared.ok) return finish(item("failed", { reason: "handoff-failed", detail: prepared.error ?? "the handoff couldn't be built" }));
    const handoff = { bytes: prepared.bytes ?? 0, transcriptPath: prepared.transcriptPath ?? "", verbatimTurns: prepared.verbatimTurns ?? 0, outlinedTurns: prepared.outlinedTurns ?? 0 };
    const outcome = coreOutcome(await this.deps.coreMove(thread.id, body).catch((error) => ({ status: 0, body: { message: errorText(error) } })));
    if (outcome.kind === "busy") return run.noDefer ? item("skipped", { reason: "busy", handoff }) : finish(item("deferred", { reason: "busy", handoff }));
    if (outcome.kind === "failed") return finish(item("failed", { reason: outcome.reason, detail: outcome.detail, handoff }));
    return finish(item(outcome.result === "already-moved" ? "already-moved" : "moved", { handoff }));
  }

  /** BB automations and Studio automations that target these threads, onto the target. Unchanged ones aren't written. */
  private async patchAutomations(threads: readonly ThreadItem[], request: MoveRequest, dryRun: boolean, supported: PermissionMode[] | null): Promise<AutomationItem[]> {
    if (!threads.length) return [];
    const ids = new Set(threads.map((item) => item.threadId));
    const out: AutomationItem[] = [];
    let listed: BbAutomation[] = [];
    try {
      listed = await this.deps.bbAutomations();
    } catch (error) {
      out.push({ automationId: "*", name: "BB automations", kind: "bb", threadId: "", from: { providerId: null, model: null, permission: null }, to: { providerId: request.providerId, model: request.model, permission: null }, result: "failed", reason: `couldn't list: ${errorText(error)}` });
    }
    for (const automation of listed) {
      const threadId = automation.execution.targetThreadId;
      if (automation.execution.mode !== "agent" || !threadId || !ids.has(threadId)) continue;
      const current = isMode(automation.execution.permissionMode) ? automation.execution.permissionMode : null;
      const decision = targetPermission(current, request.permission && current && rank(request.permission) <= rank(current) ? request.permission : null, request.providerId, supported);
      const permission = decision.ok ? decision.mode : null;
      const from = { providerId: automation.execution.providerId ?? null, model: automation.execution.model ?? null, permission: current };
      const to = { providerId: request.providerId, model: request.model, permission };
      const base = { automationId: automation.id, name: automation.name, kind: "bb" as const, threadId, from, to };
      if (!decision.ok) { out.push({ ...base, result: "failed", reason: decision.reason }); continue; }
      if (from.providerId === to.providerId && from.model === to.model && (current === null || current === permission)) { out.push({ ...base, result: "unchanged" }); continue; }
      if (dryRun) { out.push({ ...base, result: "would-patch" }); continue; }
      try {
        await this.deps.updateBbAutomation(automation, { ...automation.execution, providerId: request.providerId, model: request.model, ...(permission ? { permissionMode: permission } : {}) });
        out.push({ ...base, result: "patched" });
      } catch (error) {
        out.push({ ...base, result: "failed", reason: errorText(error) });
      }
    }
    for (const automation of this.deps.studioAutomations([...ids])) {
      const from = { providerId: automation.providerId, model: automation.model, permission: null };
      const to = { providerId: request.providerId, model: request.model, permission: null };
      const base = { automationId: automation.id, name: automation.name, kind: "studio" as const, threadId: automation.threadId, from, to };
      // A Studio automation with no model of its own runs on its thread's: nothing to change.
      if (!automation.model || (automation.providerId === request.providerId && automation.model === request.model)) { out.push({ ...base, result: "unchanged" }); continue; }
      if (dryRun) { out.push({ ...base, result: "would-patch" }); continue; }
      try {
        this.deps.setStudioAutomationModel(automation.id, request.providerId, request.model);
        out.push({ ...base, result: "patched" });
      } catch (error) {
        out.push({ ...base, result: "failed", reason: errorText(error) });
      }
    }
    return out;
  }

  async patchBotDefaults(botIds: readonly string[], providerId: string, model: string, dryRun: boolean): Promise<BotDefaultItem[]> {
    const bots = this.deps.bots();
    const out: BotDefaultItem[] = [];
    for (const id of botIds) {
      const bot = bots.find((each) => each.id === id);
      if (!bot) continue;
      const base = { botId: bot.id, name: bot.name, from: { providerId: bot.defaultModel?.providerId ?? null, model: bot.defaultModel?.model ?? null }, to: { providerId, model } };
      if (bot.defaultModel?.providerId === providerId && bot.defaultModel.model === model) { out.push({ ...base, result: "unchanged" }); continue; }
      if (dryRun) { out.push({ ...base, result: "would-patch" }); continue; }
      try {
        await this.deps.setBotDefault(bot.id, providerId, model);
        out.push({ ...base, result: "patched" });
      } catch (error) {
        out.push({ ...base, result: "failed", reason: errorText(error) });
      }
    }
    return out;
  }

  private async patchRouter(fromProviderId: string | undefined, providerId: string, model: string, dryRun: boolean): Promise<RouterItem> {
    if (!this.deps.router) return { result: "skipped", targetsChanged: 0, reason: "the router isn't loaded" };
    if (!fromProviderId) return { result: "skipped-info", targetsChanged: 0, reason: "--router-rules rewrites only with --from; router rules left as they are" };
    try {
      const { policy, changed } = rewriteRouterPolicy(await this.deps.router.get(), fromProviderId, { providerId, model });
      if (!changed) return { result: "unchanged", targetsChanged: 0 };
      if (dryRun) return { result: "would-patch", targetsChanged: changed };
      await this.deps.router.set(policy);
      return { result: "patched", targetsChanged: changed };
    } catch (error) {
      return { result: "failed", targetsChanged: 0, reason: errorText(error) };
    }
  }

  /** Runners with a thread, a Bot's (by id or name) or every Bot's; null for an unknown Bot. */
  runners(botRef?: string): { id: string; name: string; threadId: string }[] | null {
    const bot = botRef ? resolveBot(this.deps.bots(), botRef) : null;
    if (botRef && !bot) return null;
    return this.deps.runnerThreads(bot?.id);
  }

  /** `bbs studio bot set-model`: one Bot's default model, by id or name. */
  async setBotModel(ref: string, providerId: string, model: string | undefined, dryRun: boolean): Promise<BotDefaultItem> {
    const bot = resolveBot(this.deps.bots(), ref);
    if (!bot) throw new MoveInputError(`No Bot ${JSON.stringify(ref)}.`);
    const target = await this.deps.target(providerId);
    if (!target.known) throw new MoveInputError(`No provider ${providerId}.`);
    const chosen = model ?? target.defaultModel;
    if (!chosen) throw new MoveInputError(`${providerId} has no default model; give --model.`);
    return (await this.patchBotDefaults([bot.id], providerId, chosen, dryRun))[0]!;
  }

  // -------------------------------------------------------------------------
  // The watcher: a deferred thread moves once it is idle.

  /** Called on thread.idle. Resolves when that thread's move is done (or there was none to do). */
  async onIdle(threadId: string): Promise<ThreadItem | null> {
    if (this.disposed || this.inFlight.has(threadId)) return null;
    const entry = (await this.ledger())[threadId];
    if (entry?.state !== "deferred" || this.disposed) return null;
    // Claimed: from here the move runs to its end, dispose or not.
    this.inFlight.add(threadId);
    try {
      return await this.retry(threadId, entry);
    } finally {
      this.inFlight.delete(threadId);
    }
  }

  /** Deferred threads that went idle while nothing watched (Studio restarted): moved now. */
  async sweep(): Promise<ThreadItem[]> {
    const ledger = await this.ledger();
    const deferred = Object.entries(ledger).filter(([, entry]) => entry.state === "deferred").map(([id]) => id);
    if (!deferred.length) return [];
    const threads = await this.deps.getThreads(deferred);
    const out: ThreadItem[] = [];
    for (const thread of threads) {
      if (RUNNING.has(thread.status)) continue;
      const done = await this.onIdle(thread.id);
      if (done) out.push(done);
    }
    return out;
  }

  private async retry(threadId: string, entry: LedgerEntry): Promise<ThreadItem | null> {
    const [thread] = await this.deps.getThreads([threadId]);
    if (!thread) return null;
    const target = await this.deps.target(entry.request.providerId).catch(() => null);
    const roles = (await this.select({ ids: [threadId], includeArchived: true, runners: false })).roles;
    const item = await this.moveOne(thread, roles.get(threadId) ?? "other", entry.request, { dryRun: false, noDefer: false, callerThreadId: null, supported: target?.permissionModes ?? null });
    if (entry.request.patchAutomations && (item.result === "moved" || item.result === "already-moved")) {
      const patched = await this.patchAutomations([item], entry.request, false, target?.permissionModes ?? null);
      item.automationsPatched = patched.filter((each) => each.result === "patched").map((each) => each.automationId);
    }
    this.deps.log?.(`Move provider: ${threadId} ${item.result}${item.reason ? ` (${item.reason})` : ""}`);
    return item;
  }

  dispose(): void {
    this.disposed = true;
  }

  // -------------------------------------------------------------------------
  // Status and verify

  async status(ids?: readonly string[]): Promise<StatusRow[]> {
    const ledger = await this.ledger();
    const wanted = ids?.length ? [...ids] : Object.keys(ledger);
    const threads = new Map((await this.deps.getThreads(wanted)).map((thread) => [thread.id, thread]));
    const rows: StatusRow[] = [];
    for (const id of wanted) {
      const entry = ledger[id] ?? null;
      const thread = threads.get(id) ?? null;
      const events = await this.deps.moveEvents(id).catch(() => null);
      const core = !events ? "unknown" : !events.move ? "none" : events.turnCompleted ? "rebuilt" : "pending";
      rows.push({
        threadId: id, title: thread?.title ?? null, ledger: entry?.state ?? null, error: entry?.error ?? null, attempts: entry?.attempts ?? 0, at: entry?.at ?? null,
        provider: thread ? { providerId: thread.providerId, model: thread.model, permission: thread.permission } : null,
        target: entry ? { providerId: entry.request.providerId, model: entry.request.model } : null,
        core,
      });
    }
    return rows;
  }

  /**
   * Per thread: the move event is there, a turn started after it, and the
   * handoff was delivered. With a question, asks it (by id only for a Main;
   * never Main from `--all`).
   */
  async verify(ids: readonly string[], options: { all: boolean; probe?: string }): Promise<VerifyRow[]> {
    const ledger = await this.ledger();
    const mains = new Set(this.deps.bots().map((bot) => bot.threadId).filter((id): id is string => !!id));
    const wanted = options.all ? Object.entries(ledger).filter(([, entry]) => entry.state === "moved" || entry.state === "already-moved").map(([id]) => id) : [...ids];
    const explicit = new Set(ids);
    const rows: VerifyRow[] = [];
    for (const id of wanted) {
      const events = await this.deps.moveEvents(id).catch(() => null);
      const delivered = events?.turnStarted && this.deps.handoffDelivered ? await this.deps.handoffDelivered(id, events.move?.at ?? null).catch(() => null) : null;
      const moveEvent = !!events?.move;
      const turnStarted = !!events?.turnStarted;
      const turnCompleted = !!events?.turnCompleted;
      const verdict: VerifyRow["verdict"] = !events ? "unknown" : !moveEvent ? "no-move-event" : !turnCompleted ? "pending" : delivered === false ? "handoff-missing" : "ok";
      const row: VerifyRow = { threadId: id, moveEvent, movedTo: events?.move?.to ?? null, turnStarted, turnCompleted, handoffDelivered: delivered, verdict };
      if (options.probe) {
        if (mains.has(id) && !explicit.has(id)) row.probe = { skipped: "a Main is probed only by its id" };
        else if (!this.deps.ask) row.probe = { skipped: "probing isn't available" };
        else {
          try { row.probe = { answer: await this.deps.ask(id, options.probe) }; } catch (error) { row.probe = { error: errorText(error) }; }
        }
      }
      rows.push(row);
    }
    return rows;
  }
}

export interface StatusRow {
  threadId: string;
  title: string | null;
  ledger: Ledger[string]["state"] | null;
  error: string | null;
  attempts: number;
  at: number | null;
  provider: { providerId: string | null; model: string | null; permission: PermissionMode | null } | null;
  target: { providerId: string; model: string } | null;
  /** From the event log: none (no move), pending (moved, no completed turn since), rebuilt (a turn after it completed). */
  core: "none" | "pending" | "rebuilt" | "unknown";
}

export interface VerifyRow {
  threadId: string;
  moveEvent: boolean;
  movedTo: { providerId: string; model: string | null } | null;
  turnStarted: boolean;
  turnCompleted: boolean;
  handoffDelivered: boolean | null;
  verdict: "ok" | "pending" | "no-move-event" | "handoff-missing" | "unknown";
  probe?: { answer?: string; error?: string; skipped?: string };
}

export function resolveBot(bots: readonly BotRef[], ref: string): BotRef | null {
  const needle = ref.trim().toLowerCase();
  return bots.find((bot) => bot.id === ref) ?? bots.find((bot) => bot.name.toLowerCase() === needle) ?? null;
}

const isMode = (value: unknown): value is PermissionMode => value === "accept-edits" || value === "auto" || value === "full";
const rank = (mode: PermissionMode) => ({ "accept-edits": 0, auto: 1, full: 2 })[mode];
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
