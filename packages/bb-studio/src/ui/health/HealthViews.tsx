// Plugin health in the sidebar footer; Studio's Setup page (ui/setup) shows
// the same problems. The footer item opens by itself when a problem appears
// that the user hasn't seen.
import { openAppPath, studioPath } from "@bb-studio/kit/app";
import { Button, cn, Icon } from "@bb-studio/kit/ui";
import { useEffect, useRef, useState } from "react";
import type { Problem } from "../../health-contract";
import { useHealth, type HealthApi } from "./use-health";

export const SETUP_SUBPATH = "setup";
/** Problems already shown once, so the footer doesn't keep popping open. */
const SEEN_KEY = "studio:health-seen";

let footer: { open(): void; close(): void } | null = null;
/** app.tsx hands over the footer item's controller once it registers it. */
export function setHealthFooter(controller: { open(): void; close(): void }) {
  footer = controller;
}

function readSeen(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Renders nothing; opens the footer item when a lasting problem shows up that
 * the user hasn't seen, and closes it again once every problem it showed is
 * fixed or hidden.
 */
export function HealthWatch() {
  const { summary } = useHealth();
  const opened = useRef(false);
  useEffect(() => {
    if (!summary) return;
    const visible = summary.problems.filter((problem) => !problem.hidden).map((problem) => problem.key);
    const lasting = summary.problems.filter((problem) => !problem.hidden && problem.lasting).map((problem) => problem.key);
    const seen = readSeen();
    const fresh = lasting.some((key) => !seen.has(key));
    // Forget problems that went away, so one that comes back shows again.
    localStorage.setItem(SEEN_KEY, JSON.stringify(lasting));
    if (fresh) {
      opened.current = true;
      footer?.open();
    } else if (!visible.length && opened.current) {
      opened.current = false;
      footer?.close();
    }
  }, [summary]);
  return null;
}

const STATUS = {
  broken: { label: "Broken", tone: "bg-destructive/15 text-destructive" },
  degraded: { label: "Degraded", tone: "bg-warning/15 text-warning" },
} as const;

export function ProblemRow({ problem, health, onFix }: { problem: Problem; health: HealthApi; onFix?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{problem.pluginName}</span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS[problem.status].tone)}>
          {STATUS[problem.status].label}
        </span>
      </div>
      <p className="text-sm text-foreground">{problem.title}</p>
      {problem.detail ? <p className="text-xs leading-relaxed text-muted-foreground">{problem.detail}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {confirming ? (
          <>
            <span className="text-xs text-muted-foreground">Turn off {problem.pluginName}?</span>
            <Button size="sm" variant="destructive" disabled={health.busy} onClick={() => void health.disable(problem.pluginId)}>Turn off</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => { onFix?.(); openAppPath(problem.fix.path); }}>{problem.fix.label}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Turn off plugin</Button>
            <Button size="sm" variant="ghost" disabled={health.busy} onClick={() => void health.hide(problem.key, !problem.hidden)}>
              {problem.hidden ? "Show" : "Hide"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** The footer item's content: problems the user hasn't hidden. */
export function HealthFooter({ dismiss }: { dismiss(): void }) {
  const health = useHealth();
  const { summary, error } = health;
  const visible = summary?.problems.filter((problem) => !problem.hidden) ?? [];
  const hidden = (summary?.problems.length ?? 0) - visible.length;
  const openSetup = () => { dismiss(); openAppPath(studioPath(SETUP_SUBPATH)); };
  return (
    <div className="flex max-h-[60vh] w-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center gap-2 px-0.5">
        <Icon name={visible.length ? "AlertTriangle" : "CircleCheck"} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {!summary ? "Checking plugins…" : visible.length ? `${visible.length} plugin ${visible.length === 1 ? "problem" : "problems"}` : "Plugins are working"}
        </span>
        <Button size="sm" variant="ghost" disabled={health.busy} onClick={() => void health.checkAgain()}>Check again</Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Close" onClick={dismiss}>
          <Icon name="X" />
        </Button>
      </div>
      {error ? <p className="px-0.5 text-xs text-destructive">{error}</p> : null}
      {visible.length ? (
        <ul className="flex flex-col gap-1.5">
          {visible.map((problem) => <ProblemRow key={problem.key} problem={problem} health={health} onFix={dismiss} />)}
        </ul>
      ) : null}
      <button type="button" className="px-0.5 text-left text-xs text-muted-foreground hover:text-foreground" onClick={openSetup}>
        {hidden ? `${hidden} hidden · ` : ""}Open plugin setup
      </button>
    </div>
  );
}
