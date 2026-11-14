import type { AccountView, QuotaWindow, Warning } from "./contract";
import { WARN_AT } from "./shared";

const SOURCE_NAMES = { studio: "BB Studio", bb: "bb", local: "This Mac" } as const;

export const sourceName = (source: AccountView["source"]) => SOURCE_NAMES[source];

export function resetText(resetAt: number | null, now: number, timeZone?: string, locale?: string): string | null {
  if (resetAt === null) return null;
  const at = new Date(resetAt);
  const zone = timeZone ? { timeZone } : {};
  const dayOf = (time: number) => new Date(time).toLocaleDateString("en-CA", zone);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", ...zone });
  if (dayOf(now) === dayOf(resetAt)) return `resets ${time}`;
  const day = at.toLocaleDateString(locale, { month: "short", day: "numeric", ...zone });
  return `resets ${day}, ${time}`;
}

function detailOf(account: AccountView, extra: string | null): string {
  return [sourceName(account.source), account.label, extra].filter(Boolean).join(" · ");
}

const high = (window: QuotaWindow) => window.percent !== null && window.percent >= Math.round(WARN_AT * 100);

function otherReady(account: AccountView, accounts: readonly AccountView[]): boolean {
  return account.source === "studio" && accounts.some((other) => other.key !== account.key && other.source === account.source && other.provider === account.provider && other.state === "ready" && !other.windows.some(high));
}

export function computeWarnings(accounts: readonly AccountView[], now: number, timeZone?: string): Warning[] {
  const out: Warning[] = [];
  for (const account of accounts) {
    const base = { accountKey: account.key, source: account.source, target: account.signIn };
    if (account.state === "disabled") continue;
    if (account.state === "signed_out") {
      out.push({ ...base, id: `${account.key}:signed_out`, kind: "signed_out", title: `${account.name} signed out`, detail: detailOf(account, null), action: "sign_in" });
      continue;
    }
    if (account.state === "error") {
      out.push({ ...base, id: `${account.key}:error`, kind: "error", title: `${account.name} error`, detail: detailOf(account, account.message), action: "sign_in" });
      continue;
    }
    const switchTo = otherReady(account, accounts) ? "use_other" as const : "switch_model" as const;
    for (const model of account.models) {
      if (model.rejected) {
        out.push({ ...base, id: `${account.key}:model:${model.id}:rejected`, kind: "model", title: `${model.label} at ${model.percent ?? 100}%`, detail: detailOf(account, resetText(model.resetAt, now, timeZone)), action: "switch_model" });
      } else if (high(model)) {
        out.push({ ...base, id: `${account.key}:model:${model.id}:high`, kind: "model", title: `${model.label} at ${model.percent}%`, detail: detailOf(account, resetText(model.resetAt, now, timeZone)), action: "switch_model" });
      }
    }
    for (const window of account.windows) {
      if (!high(window) && !window.rejected) continue;
      const state = window.rejected ? "rejected" : "high";
      out.push({ ...base, id: `${account.key}:window:${window.id}:${state}`, kind: "window", title: `${account.name} ${window.label} at ${window.percent ?? 100}%`, detail: detailOf(account, resetText(window.resetAt, now, timeZone)), action: switchTo });
    }
  }
  if (!accounts.some((account) => account.state === "ready" || account.state === "limited") && !out.some((warning) => warning.action === "sign_in")) out.push(NO_PROVIDER_WARNING);
  return out;
}

export function popsUp(warning: Warning): boolean {
  return !(warning.source === "local" && (warning.kind === "window" || warning.kind === "model") && warning.id.endsWith(":high"));
}

export const NO_PROVIDER_ID = "providers:none";

export const NO_PROVIDER_WARNING: Warning = { id: NO_PROVIDER_ID, accountKey: NO_PROVIDER_ID, source: "local", kind: "signed_out", title: "No provider signed in", detail: "Claude or Codex", action: "sign_in", target: null };

export function accountOfWarning(id: string): string {
  const parts = id.split(":");
  return parts.slice(0, 2).join(":");
}
