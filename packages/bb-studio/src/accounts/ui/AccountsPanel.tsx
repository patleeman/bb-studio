import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { ICON_BUTTON, OUTLINE_BUTTON } from "../../kit/app/index";
import { cn, Icon } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { ReloginFlow, useReloginApi, type ReloginApi, type ReloginEnv } from "../../auth/ui/ReloginDialog";
import type { AccountView, AccountsStatus, QuotaWindow, SourceStatus } from "../contract";
import { resetText, sourceName } from "../warnings";
import { setSigningIn, useSigningIn } from "./store";

const STATE_TEXT: Record<AccountView["state"], string> = { ready: "Ready", signed_out: "Signed out", error: "Error", limited: "Limited", disabled: "Off" };
const STATE_TONE: Record<AccountView["state"], string> = {
  ready: "bg-success/15 text-success",
  signed_out: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
  limited: "bg-warning/15 text-warning",
  disabled: "bg-foreground/[0.06] text-muted-foreground",
};

export const needsSignIn = (account: AccountView) => !!account.signIn && (account.state === "signed_out" || account.state === "error");

export function signInLabel(account: Pick<AccountView, "source">): string {
  return account.source === "bb" ? "Sign in to bb" : "Sign in";
}

export function reloginTarget(account: AccountView) {
  return {
    id: account.signIn!,
    name: account.source === "bb" ? `${account.name} in bb` : account.name,
    detail: [sourceName(account.source), account.label].filter(Boolean).join(" · "),
  };
}

function Meter({ window, now }: { window: QuotaWindow; now: number }) {
  const percent = window.percent;
  const full = window.rejected || (percent ?? 0) >= 100;
  const tone = full ? "bg-destructive" : (percent ?? 0) >= 90 ? "bg-warning" : "bg-foreground/45";
  const reset = resetText(window.resetAt, now);
  return (
    <li data-quota={window.id} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="shrink-0 font-medium text-foreground">{window.label}</span>
        <span className={cn("shrink-0 tabular-nums", full ? "text-destructive" : "text-muted-foreground")}>{percent === null ? "–" : `${percent}%`}{window.rejected ? " · rejected" : ""}</span>
        {reset ? <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{reset}</span> : null}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
      </div>
    </li>
  );
}

export interface AccountRowProps {
  account: AccountView;
  now: number;
  signingIn: boolean;
  onSignIn(account: AccountView): void;
  onSignInDone(): void;
  onOpenThread(threadId: string): void;
  api: ReloginApi;
  env?: ReloginEnv;
}

export function AccountRow({ account, now, signingIn, onSignIn, onSignInDone, onOpenThread, api, env }: AccountRowProps) {
  const quota = [...account.windows, ...account.models];
  return (
    <li data-account={account.key} data-account-state={account.state} className="flex flex-col gap-2 rounded-md border border-border/70 bg-foreground/[0.025] p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{account.name}</span>
          {account.label ? <span className="truncate text-xs text-muted-foreground">{account.label}</span> : null}
        </span>
        <span data-testid="account-state" className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", STATE_TONE[account.state])}>{STATE_TEXT[account.state]}</span>
      </div>
      {account.message ? <p className="truncate text-xs text-muted-foreground" title={account.message}>{account.message}</p> : null}
      {quota.length ? <ul className="flex flex-col gap-1.5">{quota.map((window) => <Meter key={`${window.id}:${window.label}`} window={window} now={now} />)}</ul> : null}
      {account.pinned.length ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] text-muted-foreground">{account.pinned.length === 1 ? "1 thread" : `${account.pinned.length} threads`}</span>
          <ul className="flex flex-col">
            {account.pinned.slice(0, 6).map((thread) => (
              <li key={thread.threadId} className="min-w-0">
                <button type="button" className="w-full truncate text-left text-xs text-foreground/85 hover:text-foreground hover:underline" onClick={() => onOpenThread(thread.threadId)}>{thread.title}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {signingIn && account.signIn ? (
        <div className="rounded-md border border-border/70 bg-background/40 p-2">
          <ReloginFlow key={account.signIn} compact target={reloginTarget(account)} api={api} onClose={onSignInDone} {...(env ? { env } : {})} />
        </div>
      ) : needsSignIn(account) ? (
        <div className="flex justify-end">
          <button type="button" data-testid="account-sign-in" className={OUTLINE_BUTTON} onClick={() => onSignIn(account)}>{signInLabel(account)}</button>
        </div>
      ) : null}
    </li>
  );
}

const SECTION_TITLE: Record<SourceStatus["source"], string> = { studio: "BB Studio", bb: "bb", local: "This Mac" };
const SOURCE_STATE: Record<SourceStatus["state"], string | null> = { on: null, off: "Off", unreachable: "Not reachable" };

export interface AccountsPanelProps {
  status: AccountsStatus | null;
  error: string | null;
  signingIn: string | null;
  onSignIn(account: AccountView): void;
  onSignInDone(): void;
  onOpenThread(threadId: string): void;
  onRefresh(): void;
  onClose(): void;
  api: ReloginApi;
  env?: ReloginEnv;
  now?: number;
}

export function AccountsPanel({ status, error, signingIn, onSignIn, onSignInDone, onOpenThread, onRefresh, onClose, api, env, now = Date.now() }: AccountsPanelProps) {
  const sources = status?.sources.filter((source) => source.state !== "off" || status.accounts.some((account) => account.source === source.source)) ?? [];
  return (
    <div data-testid="accounts" className="studio-root flex max-h-[70vh] w-full flex-col gap-3 overflow-y-auto p-2">
      <div className="flex items-center gap-2 px-0.5">
        <Icon name="UserRound" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">Accounts</span>
        <button type="button" className={ICON_BUTTON} aria-label="Refresh" title="Refresh" onClick={onRefresh}><Icon name="RotateCcw" /></button>
        <button type="button" className={ICON_BUTTON} aria-label="Close" title="Close" onClick={onClose}><Icon name="X" /></button>
      </div>
      {error ? <p className="px-0.5 text-xs text-destructive">{error}</p> : null}
      {!status ? <p className="px-0.5 text-xs text-muted-foreground">Loading</p> : null}
      {sources.map((source) => {
        const accounts = status!.accounts.filter((account) => account.source === source.source);
        return (
          <section key={source.source} data-accounts-source={source.source} className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{SECTION_TITLE[source.source]}</span>
              {SOURCE_STATE[source.state] ? <span className="normal-case tracking-normal">{SOURCE_STATE[source.state]}</span> : null}
            </h3>
            {accounts.length ? (
              <ul className="flex flex-col gap-1.5">
                {accounts.map((account) => (
                  <AccountRow key={account.key} account={account} now={now} signingIn={signingIn === account.key} onSignIn={onSignIn} onSignInDone={onSignInDone} onOpenThread={onOpenThread} api={api} {...(env ? { env } : {})} />
                ))}
              </ul>
            ) : <p className="px-0.5 text-xs text-muted-foreground">No accounts</p>}
          </section>
        );
      })}
    </div>
  );
}

export function AccountsFooter({ dismiss }: { dismiss(): void }) {
  const live = useLive("accounts.status", {}, { pollMs: 30_000 });
  const call = useCall();
  const signingIn = useSigningIn();
  const navigate = useBbNavigate();
  const api = useReloginApi();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); }, [live.data]);
  useEffect(() => () => setSigningIn(null), []);
  return (
    <AccountsPanel
      status={live.data}
      error={live.error}
      signingIn={signingIn}
      onSignIn={(account) => setSigningIn(account.key)}
      onSignInDone={() => { setSigningIn(null); live.refresh(); }}
      onOpenThread={(threadId) => { dismiss(); navigate.toThread(threadId); }}
      onRefresh={() => { void call("accounts.status", { refresh: true }).then(live.refresh, live.refresh); }}
      onClose={dismiss}
      api={api}
      now={now}
    />
  );
}
