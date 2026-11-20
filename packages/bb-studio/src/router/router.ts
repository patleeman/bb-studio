// The model router (docs: plugins/docs/router.md). Auto: BB asks it which
// real provider and model a new thread gets; Jev picks the rule, the rule's
// chain (then the default chain) gives the first available target. A turn
// that fails on a usage limit gets a notice naming the next available target
// in its chain; nothing switches until the person clicks Hand off, which is
// BB's own handoff to a new thread.
import { policySchema, defaultPolicy, type Decision, type Notice, type Policy, type Target, type TargetCheck } from "./contract";
import { chooseRule, type RouterDecisions } from "./decide";
import { sessionTitlePrefix } from "../decisions/server/classifier";
import { chainFor, firstAvailable, narrowPermission, noticeText, readFailure, ruleForTarget, sameTarget, targetName, type Availability, type FailedTurn } from "./select";

export const POLICY_KEY = "router:policy";
export const noticeKey = (threadId: string) => `router:notice:${threadId}`;
const STATES_TTL_MS = 20_000;
const CATALOG_TTL_MS = 60_000;

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

  markBlocked(providerId: string, until: number, reason: string): void {
    this.blocked.set(providerId, { until, reason });
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

  /**
   * Why a target can't be used now, or null when it can: excluded by the
   * caller, blocked after a failure, provider not ready, a model its provider
   * no longer offers, or no permission mode at or below the one asked for.
   */
  async availability(options: { exclude?: (target: Target) => string | null; permissionMode?: string | null; targets?: readonly Target[] } = {}): Promise<Availability> {
    const [states, providers] = await Promise.all([this.readiness(), this.deps.providers().catch(() => new Map<string, RouterProvider>())]);
    const targets = options.targets ?? [...this.policy.rules.flatMap((rule) => rule.chain), ...this.policy.defaultChain];
    const ids = [...new Set(targets.map((target) => target.providerId))].filter((id) => states.get(id) === "ready");
    const catalogs = new Map(await Promise.all(ids.map(async (id) => [id, await this.catalog(id)] as const)));
    const now = this.now();
    return (target) => {
      const excluded = options.exclude?.(target);
      if (excluded) return excluded;
      const status = states.get(target.providerId);
      if (status === undefined) return "not set up";
      if (status !== "ready") return status.replace(/[-_]/gu, " ");
      // A retired model is a lasting problem with the rule; say it before a passing block.
      const models = catalogs.get(target.providerId);
      if (models && !models.has(target.model)) return "model no longer offered";
      const block = this.blocked.get(target.providerId);
      if (block && block.until > now) return block.reason;
      const modes = providers.get(target.providerId)?.permissionModes;
      if (options.permissionMode && modes?.length && narrowPermission(options.permissionMode, modes) === null) return `no permission mode at or below ${options.permissionMode}`;
      return null;
    };
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
      checks.push({ providerId: target.providerId, model: target.model, problem: why(target) });
    }
    return checks;
  }

  /** What Auto picks for this text: the rule, then the first available target along its chain. */
  async decide(text: string, options: { permissionMode?: string | null } = {}): Promise<Decision> {
    const policy = this.policy;
    const choice = await chooseRule(this.deps.decisions, { policy, text });
    const { target, skipped } = firstAvailable(chainFor(policy, choice.ruleId), await this.availability({ permissionMode: options.permissionMode ?? null }));
    return { ...choice, target, skipped };
  }

  /** BB's Auto router hook: a real target, or null for BB's usual defaults. */
  async resolve(request: { text: string; permissionMode?: string | null }): Promise<Target | null> {
    if (!this.enabled()) return null;
    const decision = await this.decide(request.text, { permissionMode: request.permissionMode ?? null });
    this.deps.log.info(`Router: Auto picked ${decision.target ? `${decision.target.providerId}/${decision.target.model}` : "BB's default"} (rule ${decision.ruleId ?? "default"} via ${decision.source}, ${decision.ms} ms${decision.skipped.length ? `; skipped ${decision.skipped.map((each) => `${each.target.model}: ${each.why}`).join(", ")}` : ""}).`);
    return decision.target;
  }

  /** A failed turn: remember a blocked provider and leave a notice when another target is ready. */
  async onTurnFailed(event: FailedTurnEvent): Promise<Notice | null> {
    if (!this.enabled()) return null;
    const reading = readFailure(event, this.now());
    if (!reading) return null;
    const thread = await this.deps.thread(event.threadId);
    if (!thread) return null;
    if (reading.until !== null) this.markBlocked(thread.providerId, reading.until, reading.reason);
    // Decisions' temporary classifier threads get no notice (Bot conversations are hidden from
    // BB's sidebar too, so visibility alone can't tell); on a sign-in failure the app shows its own prompt.
    if ((thread.title ?? "").startsWith(sessionTitlePrefix)) return null;
    if (reading.kind === "sign-in" && this.deps.appHandlesSignIn) return null;
    const [execution, providers] = await Promise.all([
      this.deps.execution(thread.id).catch(() => null),
      this.deps.providers().catch(() => new Map<string, RouterProvider>()),
    ]);
    const failed = { providerId: thread.providerId, model: execution?.model ?? "" };
    const rule = ruleForTarget(this.policy, failed);
    const chain = chainFor(this.policy, rule?.id ?? null);
    const { target } = firstAvailable(chain, await this.availability({
      exclude: (each) => (each.providerId === failed.providerId || sameTarget(each, failed) ? "the model that failed" : null),
      permissionMode: execution?.permissionMode ?? null,
      targets: chain,
    }));
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
