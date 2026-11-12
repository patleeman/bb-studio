import type { AuthEntry, AuthStatus } from "../contract";
import { useLive } from "../../ui/live";
import { openRelogin, type ReloginTarget } from "./relogin-store";
import type { AccountsStatus } from "../../accounts/contract";
import { actionLabel, useWarningActions, type WarningActions } from "../../accounts/ui/Warnings";
import { openAccounts } from "../../accounts/ui/store";

export interface AuthNeed {
  key: string;
  icon: string;
  tone: "failed";
  title: string;
  detail: string | null;
  action: { label: string; run(): void };
  dismiss?: () => void;
  open?: () => void;
}

export const entryDetail = (entry: Pick<AuthEntry, "source" | "detail">) => entry.source === "pool" ? ["Account Pooler", entry.detail].filter(Boolean).join(" · ") : entry.detail;

export function authNeeds(status: Pick<AuthStatus, "entries"> | null | undefined, open: (target: ReloginTarget) => void = openRelogin): AuthNeed[] {
  const entries = Array.isArray(status?.entries) ? status.entries : [];
  const seen = new Set<string>();
  const out: AuthNeed[] = [];
  for (const entry of entries) {
    if (!entry?.signedOut || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const detail = entryDetail(entry);
    out.push({
      key: `auth:${entry.id}`,
      icon: "CircleAlert",
      tone: "failed",
      title: `${entry.name} signed out`,
      detail,
      action: { label: "Sign in again", run: () => open({ id: entry.id, name: entry.name, detail }) },
    });
  }
  return out;
}

export function accountNeeds(status: Pick<AccountsStatus, "warnings"> | null | undefined, actions: WarningActions, open: () => void = () => openAccounts()): AuthNeed[] {
  const warnings = Array.isArray(status?.warnings) ? status.warnings : [];
  return warnings.map((warning) => ({
    key: `account:${warning.id}`,
    icon: warning.kind === "signed_out" || warning.kind === "error" ? "CircleAlert" : "AlertTriangle",
    tone: "failed" as const,
    title: warning.title,
    detail: warning.detail,
    action: { label: actionLabel(warning), run: () => actions.run(warning) },
    dismiss: () => actions.dismiss(warning),
    open,
  }));
}

export function useAuthNeeds(enabled = true): AuthNeed[] {
  const live = useLive("accounts.status", {}, { enabled, pollMs: 60_000 });
  const actions = useWarningActions(enabled ? live.data : null);
  return accountNeeds(enabled ? live.data : null, actions);
}
