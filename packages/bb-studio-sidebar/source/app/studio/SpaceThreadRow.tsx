import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { threadAttentionState, type ThreadAttentionState } from "../model/thread-activity.js";

/** A thread's latest line from Studio's `thread_lines`. */
export interface ThreadLine {
  text: string;
  kind: "progress" | "failure" | "blocked";
  at: number | null;
}

/** How a Space's lead or a pinned thread is told apart without a heading. */
/** The Chief of Staff is badged like a lead, with its own label. */
export type SpaceThreadMark = { kind: "lead" | "chief"; label: string } | { kind: "pinned" };

/** By space only: the latest line of each thread whose line has loaded, and the lead's and pins' marks. */
export const SpaceRowsContext = createContext<{
  lines: Readonly<Record<string, ThreadLine>>;
  marks?: Readonly<Record<string, SpaceThreadMark>>;
} | null>(null);

export type SpaceThreadState = ThreadAttentionState;

/** The one state a By space row's dot shows, most urgent first. */
export const spaceThreadState = threadAttentionState;

export const SPACE_THREAD_DOT: Record<SpaceThreadState, { className: string; label: string | null }> = {
  "needs-you": { className: "size-2 bg-warning ring-[3px] ring-warning/30", label: "Needs you" },
  working: { className: "bg-success ring-[3px] ring-success/20", label: "Working" },
  error: { className: "size-2 bg-destructive ring-[3px] ring-destructive/30", label: "Unread error" },
  unread: { className: "size-2 bg-blue-500 ring-[3px] ring-blue-500/30", label: "Unread result" },
  // A read, idle thread has no mark, so a thread that wants you is the only one with a dot.
  idle: { className: "invisible", label: null },
};

/**
 * A thread that waits on the user (a question, an unread error or result)
 * gets a bold, full-strength title; a read, idle thread's title steps back.
 */
export const SPACE_THREAD_TITLE: Record<SpaceThreadState, string | null> = {
  "needs-you": "[&_.bb-thread-title]:font-semibold [&_.bb-thread-title]:text-sidebar-foreground",
  error: "[&_.bb-thread-title]:font-semibold [&_.bb-thread-title]:text-sidebar-foreground",
  unread: "[&_.bb-thread-title]:font-semibold [&_.bb-thread-title]:text-sidebar-foreground",
  working: null,
  idle: "[&_.bb-thread-title]:text-muted-foreground",
};

/**
 * A thread that waits on you swaps its age for a filled pill that says why:
 * the time doesn't matter until you've opened it.
 */
export const SPACE_THREAD_PILL: Record<SpaceThreadState, { className: string; label: string } | null> = {
  "needs-you": { className: "bg-warning text-neutral-950", label: "Needs you" },
  error: { className: "bg-destructive text-white", label: "Failed" },
  unread: { className: "bg-blue-500 text-white", label: "Done" },
  working: null,
  idle: null,
};

/** "now", "5m", "3h", "2d", "3w", "4mo" or "1y" since `at`. */
export function compactAge(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function SpaceThreadDot({ state }: { state: SpaceThreadState }) {
  const { className, label } = SPACE_THREAD_DOT[state];
  return (
    <span
      data-space-thread-dot={state}
      // Kept for the needs-you mark other views and tests look for.
      data-sidebar-needs-you={state === "needs-you" ? "" : undefined}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      title={label ?? undefined}
      className={cn("mr-2 size-[7px] shrink-0 rounded-full", className)}
    />
  );
}

/** The mark takes the state's colour, so the lead and pins still show what they need. */
const MARK_TONE: Record<SpaceThreadState, string> = {
  "needs-you": "text-warning",
  working: "text-success",
  error: "text-destructive",
  unread: "text-blue-500",
  idle: "text-subtle-foreground",
};

/** A star for the lead, a pin, or the Chief of Staff's avatar, where other rows have their status dot. */
function SpaceThreadMarkIcon({ mark, state }: { mark: SpaceThreadMark; state: SpaceThreadState }) {
  const status = SPACE_THREAD_DOT[state].label;
  const label = [mark.kind === "pinned" ? "Pinned" : mark.label, status].filter(Boolean).join(" · ");
  return (
    // As wide as a dot, so the title lines up with the rows around it.
    <span
      data-space-thread-mark={mark.kind}
      data-space-thread-dot={state}
      data-sidebar-needs-you={state === "needs-you" ? "" : undefined}
      role="img"
      aria-label={label}
      title={label}
      className="relative mr-2 size-[7px] shrink-0"
    >
      {mark.kind === "chief" ? (
        // The Chief of Staff's avatar sits where the dot does, tinted by its state.
        <span className={cn("absolute top-1/2 left-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-current/15", MARK_TONE[state] === "text-subtle-foreground" ? "text-primary" : MARK_TONE[state])}>
          <Icon name="UserRound" aria-hidden className="size-2.5" />
        </span>
      ) : <Icon
        name={mark.kind === "pinned" ? "Pin" : "Star"}
        aria-hidden
        className={cn("absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2", MARK_TONE[state], mark.kind !== "pinned" && "fill-current")}
      />}
    </span>
  );
}

const LINE_TONE: Record<ThreadLine["kind"], string> = {
  progress: "text-subtle-foreground",
  failure: "text-destructive/80",
  blocked: "text-warning/80",
};

/** What a By space row adds to BB's thread row; null in every other view. */
export interface SpaceThreadRow {
  className: string | undefined;
  style: CSSProperties | undefined;
  /** The status dot before the title, or the lead's or a pin's mark; it replaces BB's status glyph. */
  dot: ReactNode;
  /** The relative time where BB shows the status glyph; null when a pill shows instead. */
  time: ReactNode;
  /**
   * What a thread that waits on you shows in place of its time. Unlike the
   * time it sits in the row's flow, so the slot widens and the title gives way.
   */
  pill: ReactNode;
  /** The latest line under the title, or a blank one until it loads. */
  line: ReactNode;
}

/**
 * By space's two-line row: a status dot, the title and its age (or a pill) on line one,
 * the thread's latest line, muted, on line two. The line wraps onto its own
 * row of the flex container and ignores the pointer, so a click on it opens
 * the thread like the rest of the row. A thread with no line yet, such as one
 * just starting, keeps a blank line so every row is the same height.
 */
export function useSpaceThreadRow(thread: SidebarThread): SpaceThreadRow | null {
  const rows = useContext(SpaceRowsContext);
  if (!rows) return null;
  const line = rows.lines[thread.id];
  const at = Math.max(thread.updatedAt, thread.latestAttentionAt, line?.at ?? 0);
  const state = spaceThreadState(thread);
  return {
    className: cn("h-auto flex-wrap pb-1.5 max-md:pointer-coarse:h-auto", SPACE_THREAD_TITLE[state]),
    style: { rowGap: 0 },
    dot: rows.marks?.[thread.id] ? <SpaceThreadMarkIcon mark={rows.marks[thread.id]!} state={state} /> : <SpaceThreadDot state={state} />,
    pill: SPACE_THREAD_PILL[state] ? (
      <span
        data-space-thread-pill={state}
        className={cn("whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide", SPACE_THREAD_PILL[state].className)}
      >
        {SPACE_THREAD_PILL[state].label}
      </span>
    ) : null,
    time: SPACE_THREAD_PILL[state] ? null : (
      <time
        data-space-thread-time=""
        dateTime={new Date(at).toISOString()}
        className="absolute inset-y-0 right-1 flex items-center whitespace-nowrap text-xs tabular-nums text-subtle-foreground"
      >
        {compactAge(at)}
      </time>
    ),
    line: line ? (
      <span
        data-space-thread-line={line.kind}
        className={cn(
          "pointer-events-none min-w-0 basis-full truncate pr-2 leading-4",
          "pl-[15px] text-xs",
          LINE_TONE[line.kind],
          "group-data-[sidebar-touch-armed=true]/thread-row:hidden",
        )}
      >
        {line.text}
      </span>
    ) : (
      <span
        aria-hidden
        className="pointer-events-none basis-full leading-4 text-xs group-data-[sidebar-touch-armed=true]/thread-row:hidden"
      >
        {"\u00a0"}
      </span>
    ),
  };
}
