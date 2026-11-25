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
import { moveMaxChars } from "../provider-move/handoff";
import {
  coreOutcome, DEFAULT_HISTORY_TOKENS, ledgerStateFor, LEDGER_KEY, parseLedger, parsePatchLedger, PATCHES_KEY, rewriteRouterPolicy, summarize, targetPermission,
  type PatchLedger,
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
  move: { seq: number; at: number; to: { providerId: string; model: string | null }; handoff?: string | null } | null;
  /** A turn started after it. */
  turnStarted: boolean;
  /** A turn after it completed (successfully). */
  turnCompleted: boolean;
  /** The new provider accepted a real request after it (turn/input/accepted): core calls the move rebuilt. */
  inputAccepted?: boolean;
}

/**
 * Core's state after a move: pending until the new provider accepts a real request made after it; then
 * rebuilt, or started for a forced move (handoff "none": nothing was delivered).
 */
function moveState(events: MoveEventStatus): "pending" | "rebuilt" | "started" {
  if (!events.inputAccepted) return "pending";
  return events.move?.handoff === "none" ? "started" : "rebuilt";
}
const rebuilt = (events: MoveEventStatus) => moveState(events) === "rebuilt";

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
  /** Threads Studio runs for itself (classifier sessions, skill reviews): never selected by --from, --project or --bot. */
  internal?(thread: ThreadInfo): boolean;
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
  /** Leave Bots' Main threads out (unless named by id): move them last, separately. */
  excludeMain?: boolean;
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
      if (!explicit.has(thread.id) && this.deps.internal?.(thread)) return false;
      return explicit.has(thread.id) || selection.includeArchived || !thread.archived;
    });
    for (const thread of threads) roles.set(thread.id, roleOf(thread.id));
    if (selection.excludeMain) for (let i = threads.length - 1; i >= 0; i--) if (roles.get(threads[i]!.id) === "main" && !explicit.has(threads[i]!.id)) threads.splice(i, 1);
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
    const request: MoveRequest = { providerId: options.to, model, permission: options.permission ?? null, historyTokens, patchAutomations: options.automations || selection.runners, ...(selection.includeArchived ? { includeArchived: true } : {}) };
    const items: ThreadItem[] = [];
    for (const thread of threads) {
      const role = roles.get(thread.id) ?? "other";
      const run = { dryRun: options.dryRun, noDefer: !!options.noDefer, callerThreadId: options.callerThreadId ?? null, supported: target.permissionModes };
      if (options.dryRun) { items.push(await this.moveOne(thread, role, request, run)); continue; }
      // The watcher is moving it right now: leave it to the watcher.
      if (this.inFlight.has(thread.id)) { items.push(this.inFlightItem(thread, role, request)); continue; }
      this.inFlight.add(thread.id);
      try { items.push(await this.moveOne(thread, role, request, run)); } finally { this.inFlight.delete(thread.id); }
    }
    // Automations follow every thread that is (or would be) on the target, and the threads whose automation
    // patches failed before for this target (a re-run picks them up even when the selectors no longer do).
    const onTarget = items.filter((item) => item.result === "moved" || item.result === "already-moved" || item.result === "would-move").map((item) => item.threadId);
    const ledger = await this.ledger();
    // Owed: every thread with failed automation patches for this target, selected this run or not.
    const owed = Object.entries(ledger).filter(([, entry]) => entry.patchErrors?.length && entry.request.providerId === options.to && entry.request.model === model).map(([id]) => id);
    // With --automations, the selected threads' automations and the owed ones; without, only the owed ones.
    const patchThreads = request.patchAutomations ? [...new Set([...onTarget, ...owed])] : owed;
    const automations = patchThreads.length ? await this.patchAutomations(patchThreads, request, options.dryRun, target.permissionModes) : [];
    for (const item of items) item.automationsPatched = automations.filter((each) => each.threadId === item.threadId && (each.result === "patched" || each.result === "would-patch")).map((each) => each.automationId);
    if (!options.dryRun) await this.recordPatchErrors(patchThreads, automations);
    const patches = await this.patchLedger();
    const owedBots = Object.entries(patches.botDefaults).filter(([, f]) => f.providerId === options.to && f.model === model).map(([id]) => id);
    const botTargets = [...new Set([...(options.botDefaults ? botIds : []), ...owedBots])];
    const botDefaults = botTargets.length ? await this.patchBotDefaults(botTargets, options.to, model, options.dryRun) : [];
    const owedRouter = patches.router && patches.router.providerId === options.to && patches.router.model === model ? patches.router : null;
    const router = options.routerRules || owedRouter ? await this.patchRouter(selection.from ?? owedRouter?.fromProviderId, options.to, model, options.dryRun) : null;
    if (!options.dryRun) await this.recordOtherPatches(botDefaults, router, selection.from ?? owedRouter?.fromProviderId ?? null, options.to, model);
    return { dryRun: options.dryRun, to: { providerId: options.to, model, permission: options.permission ?? null, historyTokens }, threads: items, automations, botDefaults, router, summary: summarize(items) };
  }

  private inFlightItem(thread: ThreadInfo, role: Role, request: MoveRequest): ThreadItem {
    return { threadId: thread.id, title: thread.title, role, from: { providerId: thread.providerId ?? "", model: thread.model, permission: thread.permission }, to: { providerId: request.providerId, model: request.model, permission: null }, result: "deferred", reason: "busy", detail: "the watcher is moving it now", automationsPatched: [] };
  }

  async patchLedger(): Promise<PatchLedger> {
    return parsePatchLedger(await this.deps.kv.get(PATCHES_KEY));
  }

  /** Each thread's failed automation patches, kept until a later run patches them. */
  private recordPatchErrors(threadIds: readonly string[], automations: readonly AutomationItem[]): Promise<void> {
    const write = this.ledgerWrite.then(async () => {
      const ledger = await this.ledger();
      let changed = false;
      for (const id of threadIds) {
        const entry = ledger[id];
        if (!entry) continue;
        const errors = automations.filter((each) => each.result === "failed" && (each.threadId === id || each.automationId === "*")).map((each) => `${each.kind} automation ${each.automationId} (${each.name}): ${each.reason ?? "failed"}`);
        if (errors.length) { entry.patchErrors = errors; changed = true; } else if (entry.patchErrors) { delete entry.patchErrors; changed = true; }
      }
      if (changed) await this.deps.kv.set(LEDGER_KEY, ledger);
    });
    this.ledgerWrite = write.catch(() => {});
    return write;
  }

  private recordOtherPatches(botDefaults: readonly BotDefaultItem[], router: RouterItem | null, fromProviderId: string | null, providerId: string, model: string): Promise<void> {
    const write = this.ledgerWrite.then(async () => {
      const patches = await this.patchLedger();
      const at = this.now();
      for (const each of botDefaults) {
        if (each.result === "failed") patches.botDefaults[each.botId] = { providerId, model, error: each.reason ?? "failed", at };
        else delete patches.botDefaults[each.botId];
      }
      if (router?.result === "failed" && fromProviderId) patches.router = { providerId, model, fromProviderId, error: router.reason ?? "failed", at };
      else if (router && router.result !== "failed") patches.router = null;
      await this.deps.kv.set(PATCHES_KEY, patches);
    });
    this.ledgerWrite = write.catch(() => {});
    return write;
  }

  /** `cancel`: drops deferred entries (these ids, or every deferred one); a cancelled thread isn't moved by the watcher. */
  cancel(ids: readonly string[], allDeferred: boolean): Promise<string[]> {
    const write = this.ledgerWrite.then(async () => {
      const ledger = await this.ledger();
      const dropped = Object.entries(ledger).filter(([id, entry]) => entry.state === "deferred" && (allDeferred || ids.includes(id))).map(([id]) => id);
      for (const id of dropped) delete ledger[id];
      if (dropped.length) await this.deps.kv.set(LEDGER_KEY, ledger);
      return dropped;
    });
    this.ledgerWrite = write.catch(() => {});
    return write;
  }

  /** The thread was deleted: its ledger entry goes. */
  forgetThread(threadId: string): Promise<void> {
    const write = this.ledgerWrite.then(async () => {
      const ledger = await this.ledger();
      if (!ledger[threadId]) return;
      delete ledger[threadId];
      await this.deps.kv.set(LEDGER_KEY, ledger);
    });
    this.ledgerWrite = write.catch(() => {});
    return write;
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
        await this.record(thread.id, { state, error: done.reason ? `${done.reason}${done.detail ? `: ${done.detail}` : ""}` : null, at: this.now(), attempts: (previous?.attempts ?? 0) + (state === "already-moved" ? 0 : 1), from: previous?.from ?? (thread.providerId ? { providerId: thread.providerId, model: thread.model } : null), request, ...(previous?.patchErrors ? { patchErrors: previous.patchErrors } : {}),
          ...(state === "deferred" && thread.providerId ? { deferredFrom: { providerId: thread.providerId, model: thread.model } } : {}) });
      }
      return done;
    };

    if (run.callerThreadId && thread.id === run.callerThreadId) return item("skipped", { reason: "current-thread", detail: "never moved from inside itself; run this from another thread" });
    if (thread.providerId === request.providerId && thread.model === request.model) return finish(item("already-moved"));
    if (!thread.providerId) return finish(item("failed", { reason: "no-provider", detail: "the thread has no provider" }));
    if (!decision.ok) return finish(item("failed", { reason: decision.reason, detail: decision.detail }));
    if (RUNNING.has(thread.status)) {
      if (!run.noDefer) return finish(item("deferred", { reason: "running" }));
      // --no-defer: an earlier deferral of this thread is dropped too.
      if (!run.dryRun) await this.cancel([thread.id], false);
      return item("skipped", { reason: "running" });
    }

    // An archived thread is here only because it was asked for (by id or --include-archived).
    const body: CoreMoveBody = { providerId: request.providerId, model: request.model, permissionMode: decision.mode, historyTokens: request.historyTokens, ...(thread.archived ? { includeArchived: true } : {}) };
    if (run.dryRun) {
      const outcome = coreOutcome(await this.deps.coreMove(thread.id, { ...body, dryRun: true }).catch((error) => ({ status: 0, body: { message: errorText(error) } })));
      if (outcome.kind === "busy") return item(run.noDefer ? "skipped" : "deferred", { reason: "busy" });
      if (outcome.kind === "failed") return item("failed", { reason: outcome.reason, detail: outcome.detail });
      return item(outcome.result === "already-moved" ? "already-moved" : "would-move", outcome.result === "already-moved" ? {} : { handoffEstimate: { maxChars: moveMaxChars(request.historyTokens), historyTokens: request.historyTokens } });
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
  private async patchAutomations(threadIds: readonly string[], request: MoveRequest, dryRun: boolean, supported: PermissionMode[] | null): Promise<AutomationItem[]> {
    if (!threadIds.length) return [];
    const ids = new Set(threadIds);
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
      // No mode of its own: it runs with its thread's (already lowered), so it stays unset.
      const decision = current === null ? { ok: true as const, mode: null } : targetPermission(current, request.permission && rank(request.permission) <= rank(current) ? request.permission : null, request.providerId, supported);
      const permission = decision.ok ? decision.mode : null;
      const from = { providerId: automation.execution.providerId ?? null, model: automation.execution.model ?? null, permission: current };
      const to = { providerId: request.providerId, model: request.model, permission };
      const base = { automationId: automation.id, name: automation.name, kind: "bb" as const, threadId, from, to };
      if (!decision.ok) { out.push({ ...base, result: "failed", reason: (decision as { reason: string }).reason }); continue; }
      if (from.providerId === to.providerId && from.model === to.model && current === permission) { out.push({ ...base, result: "unchanged" }); continue; }
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
    if (target.models.length && !target.models.includes(chosen)) throw new MoveInputError(`${providerId} doesn't offer ${chosen}. It offers: ${target.models.slice(0, 20).join(", ")}.`);
    const [item] = await this.patchBotDefaults([bot.id], providerId, chosen, dryRun);
    if (!dryRun) await this.recordOtherPatches([item!], null, null, providerId, chosen);
    return item!;
  }

  // -------------------------------------------------------------------------
  // The watcher: a deferred thread moves once it is idle.

  /** Called on thread.idle. Resolves when that thread's move is done (or there was none to do). */
  async onIdle(threadId: string): Promise<ThreadItem | null> {
    // Claimed before any await, so two idle events (or an idle and the sweep) can't both move it.
    if (this.disposed || this.inFlight.has(threadId)) return null;
    this.inFlight.add(threadId);
    let done: ThreadItem | null = null;
    try {
      const ledger = await this.ledger();
      const entry = ledger[threadId];
      if (entry?.state !== "deferred" || this.disposed) return null;
      // A Main waits until no other deferred thread does: Main moves last.
      const mains = new Set(this.deps.bots().map((bot) => bot.threadId).filter((id): id is string => !!id));
      if (mains.has(threadId) && Object.entries(ledger).some(([id, each]) => id !== threadId && each.state === "deferred" && !mains.has(id))) return null;
      // From here the move runs to its end, dispose or not.
      done = await this.retry(threadId, entry);
      return done;
    } finally {
      this.inFlight.delete(threadId);
      // The last non-Main deferred thread moved: a waiting idle Main goes now.
      if (done && !this.disposed) void this.mainsLeft().then((left) => (left ? this.sweep() : null)).catch(() => {});
    }
  }

  /** Whether only Main threads are still deferred. */
  private async mainsLeft(): Promise<boolean> {
    const mains = new Set(this.deps.bots().map((bot) => bot.threadId).filter((id): id is string => !!id));
    const deferred = Object.entries(await this.ledger()).filter(([, entry]) => entry.state === "deferred").map(([id]) => id);
    return deferred.length > 0 && deferred.every((id) => mains.has(id));
  }

  /** Deferred threads that went idle while nothing watched (Studio restarted): moved now. */
  async sweep(): Promise<ThreadItem[]> {
    const ledger = await this.ledger();
    const deferred = Object.entries(ledger).filter(([, entry]) => entry.state === "deferred").map(([id]) => id);
    if (!deferred.length) return [];
    const mains = new Set(this.deps.bots().map((bot) => bot.threadId).filter((id): id is string => !!id));
    const threads = (await this.deps.getThreads(deferred)).sort((a, b) => Number(mains.has(a.id)) - Number(mains.has(b.id)));
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
    // Deleted since it was deferred: nothing left to move.
    if (!thread) { await this.forgetThread(threadId); return null; }
    // Archived since it was deferred (and it wasn't an archived thread asked for): the user put it away; not moved.
    if (thread.archived && !entry.request.includeArchived) {
      await this.cancel([threadId], false);
      this.deps.log?.(`Move provider: ${threadId} archived since it was deferred; not moved`);
      return null;
    }
    // Someone changed its provider or model since it was deferred: the old request no longer applies.
    const was = entry.deferredFrom ?? entry.from;
    if (was && (thread.providerId !== was.providerId || thread.model !== was.model)) {
      const detail = `it is on ${thread.providerId ?? "?"}/${thread.model ?? "?"} now, not ${was.providerId}/${was.model ?? "?"} as when deferred`;
      await this.record(threadId, { ...entry, state: "failed", error: `changed-since-deferred: ${detail}`, at: this.now(), attempts: entry.attempts + 1 });
      this.deps.log?.(`Move provider: ${threadId} not moved (changed since deferred)`);
      return { threadId, title: thread.title, role: "other", from: { providerId: thread.providerId ?? "", model: thread.model, permission: thread.permission }, to: { providerId: entry.request.providerId, model: entry.request.model, permission: null }, result: "failed", reason: "changed-since-deferred", detail, automationsPatched: [] };
    }
    const target = await this.deps.target(entry.request.providerId).catch(() => null);
    const roles = (await this.select({ ids: [threadId], includeArchived: true, runners: false })).roles;
    const item = await this.moveOne(thread, roles.get(threadId) ?? "other", entry.request, { dryRun: false, noDefer: false, callerThreadId: null, supported: target?.permissionModes ?? null });
    // Deleted or archived while it moved (core's answer): dropped, not kept as a failure nobody can fix.
    const gone = item.reason === "thread-not-found" || (item.reason === "handoff-failed" && /not found/i.test(item.detail ?? ""));
    if (item.result === "failed" && (gone || (item.reason === "thread-archived" && !entry.request.includeArchived))) {
      await this.forgetThread(threadId);
      return { ...item, result: "skipped" };
    }
    if (entry.request.patchAutomations && (item.result === "moved" || item.result === "already-moved")) {
      const patched = await this.patchAutomations([item.threadId], entry.request, false, target?.permissionModes ?? null);
      await this.recordPatchErrors([item.threadId], patched);
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
      const core = !events ? "unknown" : !events.move ? "none" : moveState(events);
      rows.push({
        threadId: id, title: thread?.title ?? null, ledger: entry?.state ?? null, error: entry?.error ?? null, attempts: entry?.attempts ?? 0, at: entry?.at ?? null,
        provider: thread ? { providerId: thread.providerId, model: thread.model, permission: thread.permission } : null,
        target: entry ? { providerId: entry.request.providerId, model: entry.request.model } : null,
        core,
        patchErrors: entry?.patchErrors ?? [],
      });
    }
    return rows;
  }

  /**
   * Per thread: the move event is there, a turn started after it, and the
   * handoff was delivered. With a question, asks it (by id only for a Main;
   * never Main from `--all`).
   */
  async verify(ids: readonly string[], options: { all: boolean; probe?: string; callerThreadId?: string | null }): Promise<VerifyRow[]> {
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
      const isRebuilt = !!events && rebuilt(events);
      const verdict: VerifyRow["verdict"] = !events ? "unknown" : !moveEvent ? "no-move-event" : !isRebuilt ? "pending" : delivered === false ? "handoff-missing" : "ok";
      const row: VerifyRow = { threadId: id, moveEvent, movedTo: events?.move?.to ?? null, turnStarted, turnCompleted, rebuilt: isRebuilt, handoffDelivered: delivered, verdict };
      if (options.probe) {
        // Asking the thread this command runs in would wait on itself.
        if (options.callerThreadId && id === options.callerThreadId) row.probe = { skipped: "the thread running this command" };
        else if (mains.has(id) && !explicit.has(id)) row.probe = { skipped: "a Main is probed only by its id" };
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
  /** From the event log: none (no move), pending (moved, not rebuilt yet), rebuilt (the new provider accepted a request after it). */
  core: "none" | "pending" | "rebuilt" | "started" | "unknown";
  /** Automation patches that failed for it; a re-run to the same target tries them again. */
  patchErrors: string[];
}

export interface VerifyRow {
  threadId: string;
  moveEvent: boolean;
  movedTo: { providerId: string; model: string | null } | null;
  turnStarted: boolean;
  turnCompleted: boolean;
  /** Core's meaning: the new provider accepted a request after the move. */
  rebuilt: boolean;
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
