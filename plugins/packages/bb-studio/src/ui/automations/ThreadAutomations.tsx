// The thread panel's "Scheduled" tab and the context row's count: what is
// scheduled for this thread, from Studio's one read model (loops.scheduled,
// src/loops/scheduled.ts): its todos with a time and the Bot automations
// that wake it.
import { useOpenThreadTab, type ThreadTabProps } from "../../kit/app/thread-panel";
import { cn, Icon } from "../../kit/ui/index";
import { openLinkFromAnywhere } from "../../links/open";
import type { ScheduledItem } from "../../loops/scheduled";
import { SCHEDULED_ICON, scheduledMeta } from "../../loops/ui/scheduled-model";
import { useLive } from "../live";
import { AUTOMATIONS_TAB, KIND_LABEL, wakeLabel } from "./model";

export function useThreadScheduled(threadId: string, enabled = true): { items: ScheduledItem[] | null; error: string | null } {
  const live = useLive("loops.scheduled", { threadId }, { enabled: enabled && !!threadId, pollMs: 30_000 });
  return { items: live.data?.items ?? null, error: live.error ?? null };
}

export function ThreadAutomationsPanel({ threadId }: ThreadTabProps) {
  const { items, error } = useThreadScheduled(threadId);
  return <ScheduledView items={items} error={error} />;
}

export function ScheduledView({ items, error, now = Date.now() }: { items: readonly ScheduledItem[] | null; error: string | null; now?: number }) {
  if (error && !items) {
    return (
      <div role="status" className="flex items-start gap-2 px-1 py-2 text-sm text-muted-foreground">
        <Icon name="AlertTriangle" aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!items) return <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
        <Icon name="Clock" aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
        <span>Nothing scheduled</span>
      </div>
    );
  }
  return (
    <ul aria-label="Scheduled for this thread" className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            data-scheduled={item.key}
            onClick={() => void openLinkFromAnywhere(item.link, { source: "botPage", title: item.title })}
            className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-state-hover", item.state === "paused" && "opacity-70")}
          >
            <Icon name={SCHEDULED_ICON[item.kind]} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[item.kind]} · {scheduledMeta(item, now)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Whether anything is scheduled for this thread: regular threads only (a Bot's threads have Bot info). */
export function useThreadAutomationsVisible(threadId: string, _projectId: string): boolean {
  const owner = useLive("bot_thread_owner", { threadId }, { pollMs: 120_000 });
  const regular = !owner.loading && !owner.data?.botId;
  const { items } = useThreadScheduled(threadId, regular);
  return regular && !!items && items.length > 0;
}

/**
 * In a regular thread's context row (above the composer): how many things
 * are scheduled for it; a click opens the Automations tab beside it.
 */
export function ThreadAutomationsSummary({ threadId }: { threadId: string; projectId: string }) {
  const openTab = useOpenThreadTab();
  const { items } = useThreadScheduled(threadId);
  if (!items || items.length === 0) return null;
  const label = wakeLabel(items);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => openTab({ actionId: AUTOMATIONS_TAB, title: "Scheduled" })}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
    >
      <Icon name="Clock" aria-hidden />
      <span className="tabular-nums">{items.length === 1 ? "1 scheduled" : `${items.length} scheduled`}</span>
    </button>
  );
}
