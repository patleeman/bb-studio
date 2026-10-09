// The thread panel's "Automations" tab and the header's clock badge: what
// wakes this thread on a schedule, read from the built-in automations plugin.
// Degrades to a short notice when that plugin is disabled or unreachable.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBbNavigate,
  useSdk,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { openAppPath } from "@bb-studio/kit/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_TAB,
  automationListSchema,
  automationsForThread,
  editPath,
  lastRunLabel,
  nextRunLabel,
  scheduleSummary,
  type AutomationsState,
  type ThreadAutomation,
} from "./model";

const REFRESH_MS = 30_000;

export function useThreadAutomations(threadId: string, knownProjectId: string | null) {
  const sdk = useSdk();
  const [projectId, setProjectId] = useState<string | null>(knownProjectId);
  const [state, setState] = useState<AutomationsState>({ kind: "loading" });
  // Bumped when the thread changes and on unmount; a read that started under an
  // older value is dropped. (A plain "mounted" flag stays false after React's
  // strict-mode remount, so nothing would ever render.)
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setState({ kind: "loading" });
    return () => { generation.current += 1; };
  }, [threadId, knownProjectId]);

  useEffect(() => {
    if (knownProjectId) { setProjectId(knownProjectId); return; }
    let cancelled = false;
    sdk.threads.get({ threadId }).then(
      (thread) => { if (!cancelled) setProjectId((thread as { projectId?: string }).projectId ?? null); },
      () => { if (!cancelled) setState({ kind: "unavailable", message: "Couldn't read this thread." }); },
    );
    return () => { cancelled = true; };
  }, [sdk, threadId, knownProjectId]);

  const call = useCallback((method: string, input: unknown) =>
    sdk.plugins.callRpc({
      pluginId: AUTOMATIONS_PLUGIN_ID, method, input: input as never,
      outputSchema: automationListSchema,
      signal: AbortSignal.timeout(15_000),
    }), [sdk]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const started = generation.current;
    try {
      const raw = await call("automations_list", { projectId });
      if (generation.current === started) setState({ kind: "ready", rows: automationsForThread(raw, threadId) });
    } catch (error) {
      if (generation.current === started) setState({ kind: "unavailable", message: error instanceof Error ? error.message : String(error) });
    }
  }, [call, projectId, threadId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const setEnabled = useCallback(async (row: ThreadAutomation, enabled: boolean) => {
    setState(s => s.kind === "ready" ? { ...s, rows: s.rows.map(r => r.id === row.id ? { ...r, enabled } : r) } : s);
    try {
      await call(enabled ? "automations_resume" : "automations_pause", { projectId: row.projectId, automationId: row.id });
    } finally {
      await refresh();
    }
  }, [call, refresh]);

  return { state, refresh, setEnabled };
}

export function ThreadAutomationsPanel({ threadId }: PluginThreadPanelProps) {
  const { state, setEnabled } = useThreadAutomations(threadId, null);
  return <AutomationsView state={state} onToggle={setEnabled} />;
}

export function AutomationsView({ state, onToggle, now = Date.now() }: {
  state: AutomationsState;
  onToggle(row: ThreadAutomation, enabled: boolean): void;
  now?: number;
}) {
  if (state.kind === "loading") {
    return <p className="px-1 py-2 text-sm text-muted-foreground">Loading automations…</p>;
  }
  if (state.kind === "unavailable") {
    return (
      <div role="status" className="flex items-start gap-2 px-1 py-2 text-sm text-muted-foreground">
        <Icon name="AlertTriangle" aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>Automations are unavailable. Turn on the Automations plugin to see what wakes this thread.</span>
      </div>
    );
  }
  if (state.rows.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
        <Icon name="Clock" aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
        <span>Nothing wakes this thread on a schedule.</span>
      </div>
    );
  }
  return (
    <ul aria-label="Automations for this thread" className="flex flex-col gap-1">
      {state.rows.map(row => <AutomationRow key={row.id} row={row} now={now} onToggle={onToggle} />)}
    </ul>
  );
}

function AutomationRow({ row, now, onToggle }: { row: ThreadAutomation; now: number; onToggle(row: ThreadAutomation, enabled: boolean): void }) {
  const last = lastRunLabel(row, now);
  const failed = row.lastRunStatus === "failed";
  return (
    <li className={cn("group rounded-md px-2 py-1.5 hover:bg-state-hover", !row.enabled && "opacity-70")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.name}</span>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => openAppPath(editPath(row))}
        >
          Edit
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={row.enabled}
          aria-label={`${row.enabled ? "Pause" : "Resume"} ${row.name}`}
          onClick={() => onToggle(row, !row.enabled)}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            row.enabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span className={cn("inline-block size-3 rounded-full bg-background shadow transition-transform", row.enabled ? "translate-x-3.5" : "translate-x-0.5")} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{scheduleSummary(row.trigger, now)}</span>
        <span aria-hidden>·</span>
        <span>{nextRunLabel(row, now)}</span>
        {last && (<><span aria-hidden>·</span><span className={cn(failed && "text-destructive")}>{last}</span></>)}
      </div>
      {failed && row.lastError && (
        <p className="mt-0.5 line-clamp-2 text-xs text-destructive" title={row.lastError}>{row.lastError}</p>
      )}
    </li>
  );
}

/** Clock badge in the thread header with the number of automations that wake it. */
export function ThreadAutomationsBadge({ threadId, projectId }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const { state } = useThreadAutomations(threadId, projectId);
  if (state.kind !== "ready" || state.rows.length === 0) return null;
  const active = state.rows.filter(r => r.enabled).length;
  const label = `${state.rows.length} automation${state.rows.length === 1 ? "" : "s"} wake this thread${active < state.rows.length ? ` (${active} on)` : ""}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => navigate.openThreadPanel({ actionId: AUTOMATIONS_TAB, title: "Automations" })}
      className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-xs text-muted-foreground shadow-sm outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
    >
      <Icon name="Clock" aria-hidden />
      <span className="tabular-nums">{state.rows.length}</span>
    </button>
  );
}
