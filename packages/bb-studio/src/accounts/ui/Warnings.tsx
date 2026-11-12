import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ICON_BUTTON, OUTLINE_BUTTON } from "../../kit/app/index";
import { hasHostWindows, useHostWindows, type HostWindowOptions } from "../../kit/app/windows";
import { cn, Icon } from "../../kit/ui/index";
import { errorMessage } from "../../kit/format";
import { useCall, useLive } from "../../ui/live";
import { useAppCommandList } from "../../launcher/ui/omnibar-data";
import { inMainWindow } from "../../links/open";
import { HudTheme } from "../../theme/ui/ThemeLayer";
import { HUD_PAGE_CSS } from "../../hud/ui/hud-style";
import type { hudContract } from "../../hud/contract";
import type { AccountsStatus, Warning } from "../contract";
import { ACCOUNTS_CHANNEL, WARNINGS_WINDOW_ID } from "../shared";
import { reloginTarget, signInLabel } from "./AccountsPanel";
import { openAccounts } from "./store";

export const SWITCH_MODEL_COMMAND = "app:modelPicker.toggle";
const CARD_WIDTH = 360;
const CARD_HEIGHT = 108;
const MAX_CARDS = 4;

const ACTION_TEXT = { use_other: "Use other account", switch_model: "Switch model" } as const;

export function actionLabel(warning: Warning): string {
  return warning.action === "sign_in" ? signInLabel(warning) : ACTION_TEXT[warning.action];
}

export interface WarningActions {
  run(warning: Warning): void;
  dismiss(warning: Warning): void;
}

export function WarningCard({ warning, actions }: { warning: Warning; actions: WarningActions }) {
  const severe = warning.kind === "signed_out" || warning.kind === "error";
  return (
    <li data-warning={warning.id} data-warning-kind={warning.kind} className="flex min-w-0 items-start gap-2.5 rounded-[var(--studio-card-radius,0.75rem)] border border-border/60 p-3 shadow-lg" style={{ background: "var(--fork-popover, color-mix(in oklab, var(--popover) 82%, transparent))", backdropFilter: "var(--fork-popover-filter, blur(14px))", WebkitBackdropFilter: "var(--fork-popover-filter, blur(14px))" }}>
      <Icon name={severe ? "CircleAlert" : "AlertTriangle"} className={cn("mt-0.5 size-4 shrink-0", severe ? "text-destructive" : "text-warning")} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{warning.title}</span>
        {warning.detail ? <span className="line-clamp-2 text-xs text-muted-foreground" title={warning.detail}>{warning.detail}</span> : null}
        <div className="pt-1.5">
          <button type="button" data-testid="warning-action" className={cn(OUTLINE_BUTTON, "h-7 px-2.5 text-xs")} onClick={() => actions.run(warning)}>{actionLabel(warning)}</button>
        </div>
      </div>
      <button type="button" data-testid="warning-dismiss" className={ICON_BUTTON} aria-label={`Dismiss ${warning.title}`} title="Dismiss" onClick={() => actions.dismiss(warning)}><Icon name="X" /></button>
    </li>
  );
}

export function WarningList({ warnings, actions, className }: { warnings: readonly Warning[]; actions: WarningActions; className?: string }) {
  if (!warnings.length) return null;
  return (
    <ul data-testid="account-warnings" className={cn("studio-root flex flex-col gap-2", className)}>
      {warnings.slice(0, MAX_CARDS).map((warning) => <WarningCard key={warning.id} warning={warning} actions={actions} />)}
    </ul>
  );
}

export function warningsWindowOptions(count: number, screen: { availLeft?: number; availTop?: number; availWidth: number }): HostWindowOptions {
  const height = Math.min(MAX_CARDS, Math.max(1, count)) * (CARD_HEIGHT + 8) + 16;
  return {
    title: "Accounts",
    width: CARD_WIDTH + 16,
    height,
    x: (screen.availLeft ?? 0) + screen.availWidth - CARD_WIDTH - 32,
    y: (screen.availTop ?? 0) + 12,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
  };
}

export function freshWarnings(warnings: readonly Warning[], shown: ReadonlySet<string>): Warning[] {
  return warnings.filter((warning) => !shown.has(warning.id));
}

export function useWarningActions(status: AccountsStatus | null): WarningActions {
  const call = useCall();
  const commands = useAppCommandList();
  const latest = useRef(commands);
  latest.current = commands;
  return useMemo(() => ({
    run(warning) {
      if (warning.action === "sign_in") {
        const account = status?.accounts.find((each) => each.key === warning.accountKey);
        openAccounts(account?.signIn ? { key: account.key, target: reloginTarget(account) } : null);
        return;
      }
      if (warning.action === "use_other") {
        void call("accounts.useOther", { accountKey: warning.accountKey }).then((result) => {
          if (result.accountKey) toast.success("Switched account");
          else toast.error("No other ready account");
        }, (error: unknown) => toast.error(errorMessage(error)));
        return;
      }
      const command = latest.current.find((each) => each.id === SWITCH_MODEL_COMMAND);
      if (command) command.run();
      else openAccounts();
    },
    dismiss(warning) {
      void call("accounts.dismiss", { id: warning.id }).catch((error: unknown) => toast.error(errorMessage(error)));
    },
  }), [call, status]);
}

export function AccountsWatch() {
  return inMainWindow() ? <MainWatch /> : null;
}

function MainWatch() {
  const live = useLive("accounts.status", {}, { pollMs: 60_000 });
  const status = live.data;
  const windows = useHostWindows();
  const native = hasHostWindows && windows.native;
  const actions = useWarningActions(status);
  const shown = useRef(new Set<string>());
  const open = useRef(false);
  const latest = useRef(status);
  latest.current = status;

  useRealtime(ACCOUNTS_CHANNEL, (payload) => {
    const { open: wantsOpen, signIn } = (payload ?? {}) as { open?: unknown; signIn?: unknown };
    if (wantsOpen !== true) return;
    const account = typeof signIn === "string" ? latest.current?.accounts.find((each) => each.key === signIn) : undefined;
    openAccounts(account?.signIn ? { key: account.key, target: reloginTarget(account) } : null);
    window.focus();
  });

  const warnings = status?.warnings ?? [];
  const ids = warnings.map((warning) => warning.id).join("\n");
  useEffect(() => {
    if (!native || !status) return;
    const list = status.warnings;
    const fresh = freshWarnings(list, shown.current);
    for (const warning of list) shown.current.add(warning.id);
    for (const id of [...shown.current]) if (!list.some((warning) => warning.id === id)) shown.current.delete(id);
    if (!list.length) {
      if (open.current) void windows.close(WARNINGS_WINDOW_ID).catch(() => false);
      open.current = false;
      return;
    }
    if (fresh.length || open.current) {
      open.current = true;
      void windows.open(WARNINGS_WINDOW_ID, warningsWindowOptions(list.length, window.screen)).catch(() => false);
    }
  }, [native, ids, status, windows]);

  if (native || !warnings.length) return null;
  return <WarningList warnings={warnings} actions={actions} className="pointer-events-auto fixed right-4 top-12 z-50 w-[22.5rem]" />;
}

export function WarningsWindow() {
  const live = useLive("accounts.status", {}, { pollMs: 60_000 });
  const call = useCall();
  const relay = useRpc<typeof hudContract>();
  const windows = useHostWindows();
  const warnings = live.data?.warnings ?? [];
  const empty = !!live.data && !warnings.length;
  useEffect(() => {
    if (empty) void windows.close(WARNINGS_WINDOW_ID).catch(() => false);
  }, [empty, windows]);
  const actions: WarningActions = {
    run(warning) {
      if (warning.action === "sign_in") {
        void call("accounts.request", { signIn: warning.accountKey }).catch((error: unknown) => toast.error(errorMessage(error)));
        return;
      }
      if (warning.action === "use_other") {
        void call("accounts.useOther", { accountKey: warning.accountKey }).then(() => live.refresh(), (error: unknown) => toast.error(errorMessage(error)));
        return;
      }
      void relay.call("window.runInMain", { kind: "command", commandId: SWITCH_MODEL_COMMAND }).catch(() => {});
    },
    dismiss(warning) {
      void call("accounts.dismiss", { id: warning.id }).then(() => live.refresh(), () => {});
    },
  };
  return (
    <div data-testid="account-warnings-window" className="h-dvh w-full overflow-hidden p-2 text-sm text-foreground">
      <style>{windows.native ? HUD_PAGE_CSS : ""}</style>
      <HudTheme />
      <WarningList warnings={warnings} actions={actions} />
    </div>
  );
}
