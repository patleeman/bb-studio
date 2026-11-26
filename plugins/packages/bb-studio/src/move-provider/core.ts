// Move threads to another provider: the parts with no I/O. The permission
// rule (never wider than now), the KV ledger's shape, the core route's
// answers mapped to per-item results, and the router-rule rewrite.
// The service (./service.ts) does the I/O; the CLI (./cli.ts) the words.

import { isAcpAgent } from "../provider-family";

export type PermissionMode = "accept-edits" | "auto" | "full";
export const PERMISSION_MODES: readonly PermissionMode[] = ["accept-edits", "auto", "full"];
const RANK: Record<PermissionMode, number> = { "accept-edits": 0, auto: 1, full: 2 };

export const isPermissionMode = (value: unknown): value is PermissionMode => typeof value === "string" && value in RANK;

/** The history a moved thread's first turn gets, in tokens (word for word; older turns as an outline). */
export const DEFAULT_HISTORY_TOKENS = 150_000;
export const MAX_HISTORY_TOKENS = 1_000_000;

/** BB's ACP agents (acp-* or the ACP family, src/provider-family.ts) take no `auto`: it lands on accept-edits there. */
export const isAcpProvider = (providerId: string) => isAcpAgent(providerId);

export type PermissionDecision = { ok: true; mode: PermissionMode } | { ok: false; reason: "permission-widening" | "permission-unsupported"; detail: string };

/**
 * The permission a moved thread (or an automation that targets it) runs with.
 * Never wider than `current`: unknown counts as the narrowest. Without an
 * explicit mode, `full` steps down to `auto` (full only when asked for), and
 * `auto` lands on accept-edits on an ACP target. `supported`, the target's
 * declared modes, narrows it further to the widest one it offers at or below
 * that (auto -> accept-edits on a target without auto, such as antigravity).
 */
export function targetPermission(current: PermissionMode | null | undefined, requested: PermissionMode | null | undefined, targetProviderId: string, supported?: readonly PermissionMode[] | null): PermissionDecision {
  const now: PermissionMode = current ?? "accept-edits";
  let mode: PermissionMode;
  if (requested) {
    if (RANK[requested] > RANK[now]) return { ok: false, reason: "permission-widening", detail: `${requested} is wider than the thread's ${now}` };
    mode = requested;
  } else {
    mode = now === "full" ? "auto" : now;
  }
  if (mode === "auto" && isAcpProvider(targetProviderId)) mode = "accept-edits";
  if (supported?.length && !supported.includes(mode)) {
    const lower = PERMISSION_MODES.filter((each) => RANK[each] <= RANK[mode] && supported.includes(each)).at(-1);
    if (!lower) return { ok: false, reason: "permission-unsupported", detail: `the target offers ${supported.join(", ")}, none at or below ${mode}` };
    mode = lower;
  }
  return { ok: true, mode };
}

// ---------------------------------------------------------------------------
// Results

export type ItemResult = "moved" | "already-moved" | "would-move" | "deferred" | "skipped" | "failed";
export type Role = "main" | "runner" | "lead" | "other";

export interface Side { providerId: string; model: string | null; permission: PermissionMode | null }

export interface ThreadItem {
  threadId: string;
  title: string;
  role: Role;
  from: Side;
  to: Side;
  result: ItemResult;
  /** Why it was skipped, deferred or failed (a short slug), and the words. */
  reason?: string;
  detail?: string;
  handoff?: { bytes: number; transcriptPath: string; verbatimTurns: number; outlinedTurns: number };
  /** Dry run: the most the handoff can be (core's move budget for the history tokens). */
  handoffEstimate?: { maxChars: number; historyTokens: number };
  automationsPatched: string[];
}

/** "skipped-info": not done, by design (a note, not a failure). */
export type PatchResult = "patched" | "would-patch" | "unchanged" | "failed" | "skipped" | "skipped-info";

export interface AutomationItem {
  automationId: string;
  name: string;
  kind: "bb" | "studio";
  threadId: string;
  from: { providerId: string | null; model: string | null; permission: PermissionMode | null };
  to: { providerId: string; model: string | null; permission: PermissionMode | null };
  result: PatchResult;
  reason?: string;
}

export interface BotDefaultItem { botId: string; name: string; from: { providerId: string | null; model: string | null }; to: { providerId: string; model: string }; result: PatchResult; reason?: string }
export interface RouterItem { result: PatchResult; targetsChanged: number; reason?: string }

export interface Summary { moved: number; alreadyMoved: number; wouldMove: number; deferred: number; skipped: number; failed: number }

export function summarize(items: readonly ThreadItem[]): Summary {
  const count = (result: ItemResult) => items.filter((item) => item.result === result).length;
  return { moved: count("moved"), alreadyMoved: count("already-moved"), wouldMove: count("would-move"), deferred: count("deferred"), skipped: count("skipped"), failed: count("failed") };
}

/**
 * 0: every selected thread is moved or already moved (or would be, in a dry
 * run) and every patch went through; 2: something was skipped, deferred or
 * failed. Bad input (1) is the CLI's.
 */
export function exitCodeFor(report: { threads: readonly ThreadItem[]; automations: readonly AutomationItem[]; botDefaults: readonly BotDefaultItem[]; router: RouterItem | null }): 0 | 2 {
  const threadsOk = report.threads.every((item) => item.result === "moved" || item.result === "already-moved" || item.result === "would-move");
  const patchesOk = [...report.automations, ...report.botDefaults, ...(report.router ? [report.router] : [])].every((item) => item.result !== "failed" && item.result !== "skipped");
  return threadsOk && patchesOk ? 0 : 2;
}

// ---------------------------------------------------------------------------
// The core route: POST /api/v1/threads/:id/move-provider

export interface CoreMoveBody { providerId: string; model: string; permissionMode?: PermissionMode; historyTokens?: number; dryRun?: boolean; includeArchived?: boolean }
export interface CoreMoveResponse { status: number; body: unknown }

export type CoreOutcome =
  | { kind: "done"; result: "moved" | "already-moved" | "would-move" }
  | { kind: "busy" }
  | { kind: "failed"; reason: string; detail: string };

const REASONS: Record<string, string> = {
  provider_unavailable: "provider-unavailable-on-machine",
  model_unavailable: "model-unavailable",
  permission_widening: "permission-widening",
  permission_unsupported: "permission-unsupported",
  // No turn-context plugin opted in to carry the handoff: moving would lose the history.
  no_handoff_handler: "no-handoff-handler",
};

export function coreOutcome(response: CoreMoveResponse): CoreOutcome {
  const body = (response.body ?? {}) as { status?: unknown; code?: unknown; message?: unknown; error?: unknown };
  const words = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
  if (response.status === 200) {
    if (body.status === "moved" || body.status === "already-moved" || body.status === "would-move") return { kind: "done", result: body.status };
    return { kind: "failed", reason: "core-error", detail: `unexpected answer ${JSON.stringify(body).slice(0, 200)}` };
  }
  // Busy is worth waiting for; an archived or deleted thread isn't.
  if (response.status === 409 && body.code === "thread_busy") {
    const reason = (body as { reason?: unknown }).reason;
    if (reason === "archived" || reason === "deleted") return { kind: "failed", reason: `thread-${reason}`, detail: words || `the thread is ${reason}` };
    // running, pending-interaction, queued-messages, or "changed" (it changed while core checked it): try again later.
    return { kind: "busy" };
  }
  if (response.status === 404 && body.code === "thread_not_found") return { kind: "failed", reason: "thread-not-found", detail: words || "no such thread" };
  if (body.code === "not_implemented" || body.code === "core_unavailable") return { kind: "failed", reason: "core-unavailable", detail: words || "this BB Studio build can't move providers; update the app" };
  if (response.status === 422 && typeof body.code === "string" && REASONS[body.code]) return { kind: "failed", reason: REASONS[body.code]!, detail: words || body.code };
  if (response.status === 404 && !body.code) return { kind: "failed", reason: "core-unavailable", detail: "this BB has no move-provider route (update BB)" };
  return { kind: "failed", reason: "core-error", detail: `HTTP ${response.status}${words ? `: ${words}` : typeof body.code === "string" ? `: ${body.code}` : ""}` };
}

// ---------------------------------------------------------------------------
// The ledger (KV `studio.moveProvider.ledger`): one entry per thread id.

export const LEDGER_KEY = "studio.moveProvider.ledger";

export type LedgerState = "moved" | "deferred" | "failed" | "already-moved";

/** What to do again for a deferred or failed thread: the request as it was given. */
export interface MoveRequest {
  providerId: string;
  model: string;
  /** Only when given explicitly; otherwise the rule in targetPermission. */
  permission: PermissionMode | null;
  historyTokens: number;
  patchAutomations: boolean;
  /** Archived threads were asked for: one archived while deferred still moves. */
  includeArchived?: boolean;
}

export interface LedgerEntry {
  state: LedgerState;
  error: string | null;
  at: number;
  attempts: number;
  from: { providerId: string; model: string | null } | null;
  request: MoveRequest;
  /** Automation patches for this thread that failed; a re-run to the same target tries them again. */
  patchErrors?: string[];
  /** Where the thread was when this request was deferred; the watcher moves it only if it is still there. (`from` is where the first move started, for rollback.) */
  deferredFrom?: { providerId: string; model: string | null };
}

export type Ledger = Record<string, LedgerEntry>;

/** Failed Bot default and router patches (KV `studio.moveProvider.patches`), tried again by a re-run to the same target. */
export const PATCHES_KEY = "studio.moveProvider.patches";
export interface PatchFailure { providerId: string; model: string; error: string; at: number }
export interface PatchLedger {
  botDefaults: Record<string, PatchFailure>;
  router: (PatchFailure & { fromProviderId: string }) | null;
}

export function parsePatchLedger(value: unknown): PatchLedger {
  const raw = (typeof value === "string" ? safeJson(value) : value) as Partial<PatchLedger> | null;
  const failure = (each: unknown): PatchFailure | null => {
    const f = each as Partial<PatchFailure> | null;
    return f && typeof f.providerId === "string" && typeof f.model === "string" ? { providerId: f.providerId, model: f.model, error: String(f.error ?? ""), at: Number(f.at) || 0 } : null;
  };
  const botDefaults: Record<string, PatchFailure> = {};
  for (const [id, each] of Object.entries(raw?.botDefaults ?? {})) { const f = failure(each); if (f) botDefaults[id] = f; }
  const router = failure(raw?.router);
  const from = (raw?.router as { fromProviderId?: unknown } | null | undefined)?.fromProviderId;
  return { botDefaults, router: router && typeof from === "string" ? { ...router, fromProviderId: from } : null };
}

export function parseLedger(value: unknown): Ledger {
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Ledger = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const each = entry as Partial<LedgerEntry> | null;
    if (!each || typeof each !== "object") continue;
    if (each.state !== "moved" && each.state !== "deferred" && each.state !== "failed" && each.state !== "already-moved") continue;
    const request = each.request as Partial<MoveRequest> | undefined;
    if (!request || typeof request.providerId !== "string" || typeof request.model !== "string") continue;
    out[id] = {
      state: each.state, error: typeof each.error === "string" ? each.error : null, at: Number(each.at) || 0, attempts: Number(each.attempts) || 0,
      from: each.from && typeof each.from.providerId === "string" ? { providerId: each.from.providerId, model: each.from.model ?? null } : null,
      request: { providerId: request.providerId, model: request.model, permission: isPermissionMode(request.permission) ? request.permission : null, historyTokens: Number(request.historyTokens) || DEFAULT_HISTORY_TOKENS, patchAutomations: !!request.patchAutomations, ...(request.includeArchived ? { includeArchived: true } : {}) },
      ...(Array.isArray(each.patchErrors) && each.patchErrors.length ? { patchErrors: each.patchErrors.filter((line): line is string => typeof line === "string") } : {}),
      ...(each.deferredFrom && typeof each.deferredFrom.providerId === "string" ? { deferredFrom: { providerId: each.deferredFrom.providerId, model: each.deferredFrom.model ?? null } } : {}),
    };
  }
  return out;
}

/** A thread's ledger state from its item, or null when the run records nothing (a dry run, a plain skip). */
export function ledgerStateFor(result: ItemResult): LedgerState | null {
  if (result === "moved" || result === "already-moved" || result === "deferred" || result === "failed") return result;
  return null;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Router rules: a chain target on the old provider points at the new one.

export interface RouterTarget { providerId: string; model: string; reasoningLevel: string | null; label?: string }
export interface RouterPolicy { rules: { id: string; chain: RouterTarget[] }[]; defaultChain: RouterTarget[] }

export function rewriteRouterPolicy<P extends RouterPolicy>(policy: P, fromProviderId: string, to: { providerId: string; model: string }): { policy: P; changed: number } {
  let changed = 0;
  const rewrite = (chain: RouterTarget[]): RouterTarget[] => {
    const out: RouterTarget[] = [];
    for (const target of chain) {
      const next = target.providerId === fromProviderId ? (changed++, { providerId: to.providerId, model: to.model, reasoningLevel: null }) : target;
      if (!out.some((each) => each.providerId === next.providerId && each.model === next.model)) out.push(next);
    }
    return out;
  };
  return { policy: { ...policy, rules: policy.rules.map((rule) => ({ ...rule, chain: rewrite(rule.chain) })), defaultChain: rewrite(policy.defaultChain) }, changed };
}
