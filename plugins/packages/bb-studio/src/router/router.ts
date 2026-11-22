// The model router (docs: plugins/docs/router.md). Auto: BB asks it which
// real provider and model a new thread gets; Jev picks the rule, the rule's
// chain (then the default chain) gives the first available target. A turn
// that fails on a usage limit gets a notice naming the next available target
// in its chain; nothing switches until the person clicks Hand off, which is
// BB's own handoff to a new thread.
import { policySchema, defaultPolicy, type Decision, type Notice, type Policy, type Target, type TargetCheck } from "./contract";
import { chooseRule, type RouterDecisions } from "./decide";
import { sessionTitlePrefix } from "../decisions/server/classifier";
import { chainFor, firstAvailable, multiBackend, narrowPermission, noticeText, readAgentError, readFailure, READINESS_UNKNOWN, ruleForTarget, sameTarget, targetName, usageProblem, type Availability, type FailedTurn, type UsageSnapshot } from "./select";

export const POLICY_KEY = "router:policy";
export const noticeKey = (threadId: string) => `router:notice:${threadId}`;
const STATES_TTL_MS = 20_000;
const CATALOG_TTL_MS = 60_000;
const USAGE_TTL_MS = 60_000;
/** How long Auto keeps off a Pi or ACP model whose service it couldn't reach. */
export const UNREACHABLE_MS = 5 * 60_000;
/** Categories a Pi or ACP agent gives an error it couldn't classify; the router then reads the error's words. */
const UNCLASSIFIED = new Set(["unknown", "bad-request"]);

export interface RouterThread {
  id: string;
  projectId: string;
  providerId: string;
  environmentId: string | null;
  title: string | null;
  titleFallback?: string | null;
  status?: string;
  visibility?: string;
}

export interface RouterProvider {
  name: string;
  permissionModes: readonly string[];
}

export interface RouterDeps {
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
  /** Provider readiness on the primary machine: "ready" or why not. */
  providerStates(): Promise<readonly { providerId: string; status: string }[]>;
  /** BB's agent providers: display name and permission modes, by id. */
  providers(): Promise<ReadonlyMap<string, RouterProvider>>;
  /** The model ids a provider offers now, or null when its catalog can't be read. */
  models(providerId: string): Promise<ReadonlySet<string> | null>;
  thread(threadId: string): Promise<RouterThread | null>;
  /** The model and permission a thread's next turn uses. */
  execution(threadId: string): Promise<{ model: string | null; permissionMode: string | null; reasoningLevel: string | null } | null>;
  spawn(request: Record<string, unknown>): Promise<{ id: string }>;
  /** Removes the thread's queued retries (provider-retry's scheduled re-run); returns how many. */
  cancelRetries(threadId: string): Promise<number>;
  /** Tell open windows a thread's notice changed. */
  changed(threadId: string): void;
  decisions: RouterDecisions;
  /** The last error text a thread's provider reported (its latest provider/error event), for Pi and ACP agents, whose errors carry no codes. */
  errorText?(threadId: string): Promise<string | null>;
  /** A provider's usage snapshot from BB (signed out, credits, used-up windows), or null when it reports none. */
  usage?(providerId: string): Promise<UsageSnapshot | null>;
  /** Whether a session on this provider and model runs with Lean tools (Settings › Agent context). */
  lean?(providerId: string, model: string): boolean;
  /** The app shows its own sign-in prompt on a sign-in failure (BB Studio's desktop app does). */
  appHandlesSignIn: boolean;
  log: { info(message: string): void; warn(message: string): void };
  now?: () => number;
}

export interface FailedTurnEvent extends FailedTurn {
  threadId: string;
  requestId: string;
}

export class ModelRouter {
  private policy: Policy = defaultPolicy;
  /** Providers the router saw blocked, until when, and why. */
  private readonly blocked = new Map<string, { until: number; reason: string }>();
  private states: { at: number; value: ReadonlyMap<string, string> } | null = null;
  private readonly catalogs = new Map<string, { at: number; value: Promise<ReadonlySet<string> | null> }>();
  private readonly usages = new Map<string, { at: number; value: Promise<UsageSnapshot | null> }>();

  constructor(private readonly deps: RouterDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async load(): Promise<Policy> {
    const stored = policySchema.safeParse(await this.deps.kv.get(POLICY_KEY));
    this.policy = stored.success ? stored.data : defaultPolicy;
    return this.policy;
  }

  current(): Policy {
    return this.policy;
  }

  async setPolicy(next: Policy): Promise<Policy> {
    const policy = policySchema.parse(next);
    await this.deps.kv.set(POLICY_KEY, policy);
    this.policy = policy;
    return policy;
  }

  /** Auto (and the notice) are on once there is a chain to route along. */
  enabled(): boolean {
    return this.policy.enabled && (this.policy.defaultChain.length > 0 || this.policy.rules.length > 0);
  }

  isDefault(): boolean {
    return this.enabled() && this.policy.autoDefault;
  }

  /** Keeps Auto off a provider, or off one model of a Pi or ACP agent (`model`), until `until`. */
  markBlocked(providerId: string, until: number, reason: string, model?: string | null): void {
    this.blocked.set(model && multiBackend(providerId) ? `${providerId}\0${model}` : providerId, { until, reason });
  }

  private block(target: Pick<Target, "providerId" | "model">, now: number): { until: number; reason: string } | null {
    for (const key of [`${target.providerId}\0${target.model}`, target.providerId]) {
      const block = this.blocked.get(key);
      if (block && block.until > now) return block;
    }
    return null;
  }

  private async readiness(): Promise<ReadonlyMap<string, string>> {
    if (this.states && this.now() - this.states.at < STATES_TTL_MS) return this.states.value;
    let value: ReadonlyMap<string, string> = new Map();
    try {
      value = new Map((await this.deps.providerStates()).map((state) => [state.providerId, state.status]));
    } catch (error) {
      this.deps.log.warn(`Router: provider states unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.states = { at: this.now(), value };
    return value;
  }

  private catalog(providerId: string): Promise<ReadonlySet<string> | null> {
    const cached = this.catalogs.get(providerId);
    if (cached && this.now() - cached.at < CATALOG_TTL_MS) return cached.value;
    const value = this.deps.models(providerId).catch(() => null);
    this.catalogs.set(providerId, { at: this.now(), value });
    return value;
  }

  private usage(providerId: string): Promise<UsageSnapshot | null> {
    const read = this.deps.usage;
    if (!read) return Promise.resolve(null);
    const cached = this.usages.get(providerId);
    if (cached && this.now() - cached.at < USAGE_TTL_MS) return cached.value;
    const value = read(providerId).catch(() => null);
    this.usages.set(providerId, { at: this.now(), value });
    return value;
  }

  /**
   * Why a target can't be used now, or null when it can: excluded by the
   * caller, blocked after a failure, provider not ready (signed out, not
   * installed), signed out or out of credit by its usage snapshot, a model
   * its provider no longer offers, a Pi or ACP agent whose models can't be
   * listed (unreachable), or no permission mode at or below the one asked
   * for. `unsure` names the targets whose readiness BB can't tell: they
   * are used only after every ready target in a chain.
   */
  async availability(options: { exclude?: (target: Target) => string | null; permissionMode?: string | null; targets?: readonly Target[] } = {}): Promise<Availability & { unsure: Availability }> {
    const [states, providers] = await Promise.all([this.readiness(), this.deps.providers().catch(() => new Map<string, RouterProvider>())]);
    const targets = options.targets ?? [...this.policy.rules.flatMap((rule) => rule.chain), ...this.policy.defaultChain];
    const usable = (id: string) => states.get(id) === "ready" || states.get(id) === "unknown";
    const ids = [...new Set(targets.map((target) => target.providerId))].filter(usable);
    const [catalogs, usages] = await Promise.all([
      Promise.all(ids.map(async (id) => [id, await this.catalog(id)] as const)).then((entries) => new Map(entries)),
      Promise.all(ids.map(async (id) => [id, await this.usage(id)] as const)).then((entries) => new Map(entries)),
    ]);
    const now = this.now();
    const why: Availability = (target) => {
      const excluded = options.exclude?.(target);
      if (excluded) return excluded;
      const status = states.get(target.providerId);
      if (status === undefined) return "not set up";
      if (!usable(target.providerId)) return status.replace(/[-_]/gu, " ");
      // A retired model is a lasting problem with the rule; say it before a passing block.
      const models = catalogs.get(target.providerId);
      if (models && !models.has(target.model)) return "model no longer offered";
      if (models === null && multiBackend(target.providerId)) return "unreachable (its models can't be listed)";
      const block = this.block(target, now);
      if (block) return block.reason;
      const spent = usageProblem(usages.get(target.providerId), now);
      if (spent) return spent;
      const modes = providers.get(target.providerId)?.permissionModes;
      if (options.permissionMode && modes?.length && narrowPermission(options.permissionMode, modes) === null) return `no permission mode at or below ${options.permissionMode}`;
      return null;
    };
    return Object.assign(why, { unsure: (target: Target) => (states.get(target.providerId) === "unknown" ? READINESS_UNKNOWN : null) });
  }

  /** Every target in the policy with what is wrong with it now, for Settings. */
  async checkTargets(): Promise<TargetCheck[]> {
    const targets = [...this.policy.rules.flatMap((rule) => rule.chain), ...this.policy.defaultChain];
    const why = await this.availability({ targets });
    const seen = new Set<string>();
    const checks: TargetCheck[] = [];
    for (const target of targets) {
      const key = `${target.providerId}\0${target.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const problem = why(target);
      const unsure = problem === null ? why.unsure(target) : null;
      checks.push({ providerId: target.providerId, model: target.model, problem, ...(unsure ? { note: `${unsure[0]!.toUpperCase()}${unsure.slice(1)}: used only when no ready model is left in the chain` } : {}) });
    }
    return checks;
  }

  /** What Auto picks for this text: the rule, then the first available target along its chain. */
  async decide(text: string, options: { permissionMode?: string | null } = {}): Promise<Decision> {
    const policy = this.policy;
    const choice = await chooseRule(this.deps.decisions, { policy, text });
    const why = await this.availability({ permissionMode: options.permissionMode ?? null });
    const { target, skipped, note } = firstAvailable(chainFor(policy, choice.ruleId), why, why.unsure);
    const lean = target ? this.leanFor(target) : false;
    return { ...choice, target, skipped, ...(note ? { note } : {}), ...(lean ? { lean } : {}) };
  }

  /** Whether a session on this target runs with Lean tools (an ACP agent on a local model, by default). */
  leanFor(target: Pick<Target, "providerId" | "model">): boolean {
    try {
      return this.deps.lean?.(target.providerId, target.model) ?? false;
    } catch {
      return false;
    }
  }

  /** BB's Auto router hook: a real target, or null for BB's usual defaults. */
  async resolve(request: { text: string; permissionMode?: string | null }): Promise<Target | null> {
    if (!this.enabled()) return null;
    const decision = await this.decide(request.text, { permissionMode: request.permissionMode ?? null });
    this.deps.log.info(`Router: Auto picked ${decision.target ? `${decision.target.providerId}/${decision.target.model}` : "BB's default"} (rule ${decision.ruleId ?? "default"} via ${decision.source}, ${decision.ms} ms${decision.skipped.length ? `; skipped ${decision.skipped.map((each) => `${each.target.model}: ${each.why}`).join(", ")}` : ""}${decision.lean ? "; Lean tools" : ""}).${decision.note ? ` ${decision.note}` : ""}`);
    return decision.target;
  }

  /**
   * A Pi or ACP turn's failure as the router reads it. ACP errors reach BB
   * with no classification and Pi's only with what its own patterns caught,
   * so an unclassified one is read again from the error's words.
   */
  private async agentFailure(event: FailedTurnEvent, providerId: string): Promise<FailedTurn> {
    if (!multiBackend(providerId) || !this.deps.errorText) return event;
    if (event.errorInfo && !UNCLASSIFIED.has(event.errorInfo.category)) return event;
    const text = await this.deps.errorText(event.threadId).catch(() => null);
    const reading = readAgentError(text, this.now());
    if (!reading) return event;
    // The agent's own rate-limit windows, when it reports any, say more than its words.
    return { errorInfo: reading.errorInfo, rateLimits: event.rateLimits?.windows.some((window) => window.status === "blocked") ? event.rateLimits : reading.rateLimits };
  }

  /** A failed turn: remember a blocked provider (or Pi or ACP model) and leave a notice when another target is ready. */
  async onTurnFailed(event: FailedTurnEvent): Promise<Notice | null> {
    if (!this.enabled()) return null;
    const thread = await this.deps.thread(event.threadId);
    if (!thread) return null;
    const failure = await this.agentFailure(event, thread.providerId);
    const multi = multiBackend(thread.providerId);
    const unreachable = multi && failure.errorInfo?.category === "connection-failed";
    const reading = readFailure(failure, this.now());
    if (!reading && !unreachable) return null;
    const execution = await this.deps.execution(thread.id).catch(() => null);
    // A Pi or ACP model whose service didn't answer: Auto keeps off it for a while. Another model doesn't fix a dropped connection, so no notice.
    if (!reading) {
      this.markBlocked(thread.providerId, this.now() + UNREACHABLE_MS, "unreachable", execution?.model);
      return null;
    }
    if (reading.until !== null) this.markBlocked(thread.providerId, reading.until, reading.reason, reading.kind === "sign-in" ? null : execution?.model);
    // Decisions' temporary classifier threads get no notice (Bot conversations are hidden from
    // BB's sidebar too, so visibility alone can't tell); on a sign-in failure the app shows its own prompt.
    if ((thread.title ?? "").startsWith(sessionTitlePrefix)) return null;
    if (reading.kind === "sign-in" && this.deps.appHandlesSignIn) return null;
    const providers = await this.deps.providers().catch(() => new Map<string, RouterProvider>());
    const failed = { providerId: thread.providerId, model: execution?.model ?? "" };
    const rule = ruleForTarget(this.policy, failed);
    const chain = chainFor(this.policy, rule?.id ?? null);
    // A Pi or ACP agent's other models run on other services (GLM through OpenCode and a local model through OpenCode),
    // so only the failed model is left out; any other provider's limit covers all its models. A sign-in failure covers the agent.
    const wholeProvider = !multi || !failed.model || reading.kind === "sign-in";
    const why = await this.availability({
      exclude: (each) => ((wholeProvider && each.providerId === failed.providerId) || sameTarget(each, failed) ? "the model that failed" : null),
      permissionMode: execution?.permissionMode ?? null,
      targets: chain,
    });
    const { target } = firstAvailable(chain, why, why.unsure);
    const failedProviderName = providers.get(thread.providerId)?.name ?? thread.providerId;
    const name = target ? targetName(target, providers.get(target.providerId)?.name) : null;
    const notice: Notice = {
      threadId: thread.id,
      requestId: event.requestId,
      kind: reading.kind,
      failedProviderId: thread.providerId,
      failedProviderName,
      reason: reading.reason,
      target,
      targetName: name,
      text: noticeText({ kind: reading.kind, providerName: failedProviderName, reason: reading.reason, targetName: name }),
      createdAt: this.now(),
    };
    // A retry or a new message may have started while this was read: then the failure is old news.
    const latest = await this.deps.thread(thread.id);
    if (latest?.status !== undefined && latest.status !== "error") return null;
    await this.deps.kv.set(noticeKey(thread.id), notice);
    this.deps.changed(thread.id);
    return notice;
  }

  async notice(threadId: string): Promise<Notice | null> {
    const raw = await this.deps.kv.get(noticeKey(threadId));
    return raw && typeof raw === "object" ? (raw as Notice) : null;
  }

  async dismiss(threadId: string): Promise<void> {
    if (!(await this.deps.kv.get(noticeKey(threadId)))) return;
    await this.deps.kv.delete(noticeKey(threadId));
    this.deps.changed(threadId);
  }

  /** After a handoff: the old thread must not run again on its own, so its queued retry goes, and so does the notice. */
  async handedOff(threadId: string): Promise<{ cancelledRetries: number }> {
    const cancelledRetries = await this.deps.cancelRetries(threadId);
    await this.dismiss(threadId);
    return { cancelledRetries };
  }

  /**
   * BB's handoff, as the app's picker builds it: a new thread on the target
   * in the same workspace whose first message is "Continue from @thread:…",
   * with the source thread left as it is apart from its queued retry.
   */
  async handoff(threadId: string): Promise<{ threadId: string; target: Target; cancelledRetries: number }> {
    const notice = await this.notice(threadId);
    if (!notice?.target) throw new Error("This thread has no router notice with a model to hand off to.");
    const [thread, execution, providers] = await Promise.all([
      this.deps.thread(threadId),
      this.deps.execution(threadId).catch(() => null),
      this.deps.providers().catch(() => new Map<string, RouterProvider>()),
    ]);
    if (!thread) throw new Error(`Thread ${threadId} is gone.`);
    const modes = providers.get(notice.target.providerId)?.permissionModes ?? [];
    const requested = execution?.permissionMode ?? null;
    const permission = requested && modes.length ? narrowPermission(requested, modes) : requested;
    if (requested && modes.length && permission === null) throw new Error(`${notice.targetName ?? notice.target.model} has no permission mode at or below ${requested}.`);
    const created = await this.deps.spawn(handoffRequest(thread, notice.target, permission));
    const { cancelledRetries } = await this.handedOff(threadId);
    this.deps.log.info(`Router: handed ${threadId} off to ${notice.target.providerId}/${notice.target.model} as ${created.id}${cancelledRetries ? `; cancelled ${cancelledRetries} queued retry` : ""}.`);
    return { threadId: created.id, target: notice.target, cancelledRetries };
  }

  /** A thread that is gone keeps no notice. */
  async forget(threadId: string): Promise<void> {
    await this.deps.kv.delete(noticeKey(threadId)).catch(() => undefined);
  }
}

const HANDOFF_PREFIX = "Continue from ";

/** The request BB's picker handoff sends (client-core buildThreadHandoffCreateRequest), for a target. */
export function handoffRequest(thread: RouterThread, target: Target, permissionMode: string | null): Record<string, unknown> {
  const mention = `@thread:${thread.id}`;
  return {
    projectId: thread.projectId,
    providerId: target.providerId,
    model: target.model,
    ...(target.reasoningLevel ? { reasoningLevel: target.reasoningLevel } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      ...(target.reasoningLevel ? { reasoningLevel: "explicit" } : {}),
      ...(permissionMode ? { permissionMode: "explicit" } : {}),
    },
    environment: thread.environmentId === null ? { type: "project-default" } : { type: "reuse", environmentId: thread.environmentId },
    input: [{
      type: "text",
      text: `${HANDOFF_PREFIX}${mention}`,
      mentions: [{
        start: HANDOFF_PREFIX.length,
        end: HANDOFF_PREFIX.length + mention.length,
        resource: { kind: "thread", projectId: thread.projectId, threadId: thread.id, label: thread.title ?? thread.titleFallback ?? "Conversation" },
      }],
    }],
    startedOnBehalfOf: null,
  };
}
