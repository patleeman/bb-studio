import { z } from "zod";
import { safeMessage } from "../auth/scrub";
import type { ProviderState } from "../auth/contract";
import { providerDisplayName } from "../auth/detect";
import type { AccountSource, AccountState, AccountView, PinnedThread, QuotaWindow } from "./contract";

const familySchema = z.object({
  utilization: z.number().nullable(),
  resetAt: z.number().nullable(),
  status: z.string().nullable(),
});

const limitWindowSchema = z.object({
  slot: z.string(),
  windowMinutes: z.number().nullable(),
  utilization: z.number().nullable(),
  resetAt: z.number().nullable(),
  status: z.string().nullable(),
});

export const poolSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  kind: z.string(),
  label: z.string(),
  email: z.string().nullable(),
  enabled: z.boolean(),
  status: z.string(),
  error: z.string().nullable(),
  heldUntil: z.number().nullable().optional(),
  usageRestriction: z.object({ reason: z.string(), resetAt: z.number().nullable() }).nullable().optional(),
  limitWindows: z.array(limitWindowSchema).catch([]),
  familyWeekly: z.record(z.string(), familySchema.nullable()).catch({}),
});
export type PoolSummary = z.infer<typeof poolSummarySchema>;

export const poolStatusSchema = z.object({
  accounts: z.array(poolSummarySchema),
  routing: z.object({ claude: z.boolean().optional(), codex: z.boolean().optional() }).optional(),
});
export type PoolStatusView = z.infer<typeof poolStatusSchema>;

export interface PoolSignals {
  rejected: ReadonlySet<string>;
  missingLogin: ReadonlySet<string>;
}

export const NO_SIGNALS: PoolSignals = { rejected: new Set(), missingLogin: new Set() };

const SIGNED_OUT = /invalid_grant|refresh_token_(?:expired|reused|invalidated)|refresh token (?:expired|revoked)|invalid refresh token|oauth refresh failed with http 4\d\d|\bhttp (?:401|403)\b|unauthori[sz]ed|not (?:signed|logged) in|sign(?:ed)? ?in again|no such file|enoent/i;
const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };
const FAMILY_NAMES: Record<string, string> = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", other: "Other" };
const FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku", "other"];

export const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider;

export function isSignedOutError(message: string | null | undefined): boolean {
  return !!message && SIGNED_OUT.test(message);
}

export function poolState(summary: PoolSummary, signals: PoolSignals = NO_SIGNALS, now = Date.now()): { state: AccountState; message: string | null } {
  if (!summary.enabled) return { state: "disabled", message: null };
  if (signals.missingLogin.has(summary.id)) return { state: "signed_out", message: "No saved login" };
  if (summary.error) {
    return { state: isSignedOutError(summary.error) ? "signed_out" : "error", message: safeMessage(summary.error, "Error") };
  }
  if (signals.rejected.has(summary.id)) return { state: "signed_out", message: "Refresh refused" };
  if (summary.status === "error") return { state: "error", message: null };
  if (summary.status === "held" || summary.status === "exhausted") return { state: "limited", message: null };
  if (summary.heldUntil && summary.heldUntil > now) return { state: "limited", message: null };
  return { state: "ready", message: null };
}

function windowLabel(minutes: number | null, slot: string): string {
  if (minutes === null) return slot;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

const percentOf = (utilization: number | null) => (utilization === null ? null : Math.round(utilization * 100));
const rejectedOf = (status: string | null, utilization: number | null) => status === "rejected" || (utilization !== null && utilization >= 1);

export function quotaWindows(summary: PoolSummary): QuotaWindow[] {
  return [...summary.limitWindows]
    .sort((a, b) => (a.windowMinutes ?? Number.MAX_SAFE_INTEGER) - (b.windowMinutes ?? Number.MAX_SAFE_INTEGER))
    .map((window) => ({
      id: window.slot,
      label: windowLabel(window.windowMinutes, window.slot),
      percent: percentOf(window.utilization),
      resetAt: window.resetAt,
      rejected: rejectedOf(window.status, window.utilization),
    }));
}

export function modelWindows(summary: PoolSummary): QuotaWindow[] {
  return Object.entries(summary.familyWeekly)
    .filter((entry): entry is [string, z.infer<typeof familySchema>] => !!entry[1])
    .sort(([a], [b]) => (FAMILY_ORDER.indexOf(a) + 99) % 99 - (FAMILY_ORDER.indexOf(b) + 99) % 99)
    .map(([family, quota]) => ({
      id: family,
      label: FAMILY_NAMES[family] ?? family,
      percent: percentOf(quota.utilization),
      resetAt: quota.resetAt,
      rejected: rejectedOf(quota.status, quota.utilization),
    }));
}

export function poolAccountView(summary: PoolSummary, source: Exclude<AccountSource, "local">, options: { signals?: PoolSignals; pins?: readonly PinnedThread[]; now?: number } = {}): AccountView {
  const { state, message } = poolState(summary, options.signals, options.now);
  const email = summary.email && summary.email !== summary.label ? summary.email : null;
  return {
    key: `${source}:${summary.id}`,
    id: summary.id,
    source,
    provider: summary.provider,
    name: providerName(summary.provider),
    label: [summary.label, email].filter(Boolean).join(" · ") || null,
    state,
    message,
    windows: quotaWindows(summary),
    models: modelWindows(summary),
    pinned: [...(options.pins ?? [])],
    signIn: summary.kind === "oauth" ? `${source === "studio" ? "pool" : "bb"}:${summary.id}` : null,
  };
}

const SIGN_IN_STATES = new Set(["unauthenticated", "expired"]);

export interface LocalUsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export type LocalUsage = Readonly<Record<string, { status: string; windows?: readonly LocalUsageWindow[] }>>;

export function localWindowLabel(label: string): string {
  const hours = /^(\d+) hour window$/i.exec(label.trim());
  if (!hours) return label;
  const count = Number(hours[1]);
  return count % 24 === 0 ? `${count / 24}d` : `${count}h`;
}

export function localUsageWindows(usage: LocalUsage): Record<string, QuotaWindow[]> {
  const out: Record<string, QuotaWindow[]> = {};
  for (const [providerId, entry] of Object.entries(usage)) {
    if (entry.status !== "ok" || !entry.windows?.length) continue;
    out[providerId] = entry.windows.map((window) => {
      const resetAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
      return {
        id: window.label,
        label: localWindowLabel(window.label),
        percent: Math.round(window.usedPercent),
        resetAt: Number.isFinite(resetAt) ? resetAt : null,
        rejected: window.usedPercent >= 100,
      };
    });
  }
  return out;
}

export function localAccountViews(states: readonly ProviderState[], signedOut: ReadonlySet<string>, family: (providerId: string) => string, offerSignIn = false, usage: Readonly<Record<string, QuotaWindow[]>> = {}): AccountView[] {
  const offered = (state: ProviderState) => offerSignIn && !!state.loginCommand && SIGN_IN_STATES.has(state.status);
  return states.filter((state) => state.status === "ready" || signedOut.has(state.providerId) || offered(state)).map((state) => {
    const proxied = state.status === "ready" && state.planLabel === "Proxied";
    const out = signedOut.has(state.providerId) || offered(state);
    return {
      key: `local:${state.providerId}`,
      id: state.providerId,
      source: "local" as const,
      provider: family(state.providerId),
      name: providerDisplayName(state),
      label: proxied ? "Account Pooler" : [state.accountEmail, state.planLabel].filter(Boolean).join(" · ") || null,
      state: out || state.status !== "ready" ? "signed_out" as const : "ready" as const,
      message: null,
      windows: proxied || out ? [] : [...(usage[state.providerId] ?? [])],
      models: [],
      pinned: [],
      signIn: state.loginCommand ? `provider:${state.providerId}` : null,
    };
  });
}
