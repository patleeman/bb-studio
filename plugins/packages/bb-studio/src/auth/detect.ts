import type { AuthEntry, PoolAccount, ProviderState } from "./contract";

const TURN_AUTH_ERROR = /failed to authenticate|oauth (?:session|token) (?:has )?expired|could not be refreshed|refresh[_ ]token|not logged in|please (?:run )?\/?login|sign(?:ed)? ?in again|invalid (?:api key|authentication|bearer token)|authentication_error|unauthori[sz]ed/i;
const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };
const ALIASES: Record<string, string> = { claude: "claude", "claude-code": "claude", codex: "codex" };

export const poolEntryId = (accountId: string) => `pool:${accountId}`;
export const providerEntryId = (providerId: string) => `provider:${providerId}`;
export const providerFamily = (providerId: string) => ALIASES[providerId] ?? providerId;
export const isProxied = (state: Pick<ProviderState, "status" | "planLabel">) => state.status === "ready" && state.planLabel === "Proxied";

export function isAuthError(error: string | null | undefined): boolean {
  return !!error && TURN_AUTH_ERROR.test(error);
}

export function poolEntries(accounts: readonly PoolAccount[]): AuthEntry[] {
  return accounts.filter((account) => account.kind === "oauth").map((account) => {
    const signedOut = account.enabled && account.status === "error";
    const email = account.email && account.email !== account.label ? account.email : null;
    return {
      id: poolEntryId(account.id),
      source: "pool" as const,
      provider: account.provider,
      name: PROVIDER_NAMES[account.provider] ?? account.provider,
      detail: [account.label, email].filter(Boolean).join(" · "),
      signedOut,
      reason: signedOut ? "expired" as const : null,
    };
  });
}

export interface ProviderSignals {
  seenReady: ReadonlySet<string>;
  turnErrors: ReadonlySet<string>;
}

export function providerEntries(states: readonly ProviderState[], signals: ProviderSignals): AuthEntry[] {
  const out: AuthEntry[] = [];
  for (const state of states) {
    if (!state.loginCommand || !["ready", "expired", "unauthenticated"].includes(state.status)) continue;
    const failing = signals.turnErrors.has(state.providerId);
    const reason: AuthEntry["reason"] = state.status === "expired" ? "expired"
      : state.status === "unauthenticated" ? (signals.seenReady.has(state.providerId) || failing ? "signed_out" : null)
        : failing && !isProxied(state) ? "turn_error" : null;
    out.push({
      id: providerEntryId(state.providerId),
      source: "provider",
      provider: providerFamily(state.providerId),
      name: state.displayName,
      detail: state.accountEmail ?? null,
      signedOut: reason !== null,
      reason,
    });
  }
  return out;
}

export type Resolved = { ok: true; entry: AuthEntry } | { ok: false; error: string };

export function resolveTarget(entries: readonly AuthEntry[], raw: string): Resolved {
  const name = raw.trim();
  const lower = name.toLowerCase();
  const exact = entries.find((entry) => entry.id === name || entry.id === `pool:${name}`);
  if (exact) return { ok: true, entry: exact };
  const family = ALIASES[lower] ?? lower;
  const ofProvider = entries.filter((entry) => entry.provider === family || entry.id === providerEntryId(lower));
  if (ofProvider.length) {
    const out = ofProvider.filter((entry) => entry.signedOut);
    if (out.length === 1) return { ok: true, entry: out[0]! };
    if (out.length > 1) return { ok: false, error: `${out.length} ${name} sign-ins are signed out. Use one id: ${out.map((entry) => entry.id).join(", ")}` };
    const local = ofProvider.find((entry) => entry.source === "provider");
    if (local) return { ok: true, entry: local };
    if (ofProvider.length === 1) return { ok: true, entry: ofProvider[0]! };
    return { ok: false, error: `${ofProvider.length} ${name} accounts. Use one id: ${ofProvider.map((entry) => entry.id).join(", ")}` };
  }
  const labelled = entries.filter((entry) => entry.source === "pool" && (entry.detail ?? "").toLowerCase().split(" · ").includes(lower));
  const prefixed = entries.filter((entry) => entry.source === "pool" && name.length >= 4 && entry.id.startsWith(`pool:${lower}`));
  const found = labelled.length ? labelled : prefixed;
  if (found.length === 1) return { ok: true, entry: found[0]! };
  if (found.length > 1) return { ok: false, error: `"${name}" matches ${found.length} accounts. Use one id: ${found.map((entry) => entry.id).join(", ")}` };
  return { ok: false, error: `No provider or account "${name}". See them: bb studio auth status` };
}
