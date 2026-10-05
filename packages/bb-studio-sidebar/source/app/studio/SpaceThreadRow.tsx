import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SidebarThread } from "../model/sidebar-thread.js";

/** A thread's latest line from Studio's `thread_lines`. */
export interface ThreadLine {
  text: string;
  kind: "progress" | "failure" | "blocked";
  at: number | null;
}

/** By space only: the latest line of each thread whose line has loaded. */
export const SpaceRowsContext = createContext<{ lines: Readonly<Record<string, ThreadLine>> } | null>(null);

export type SpaceThreadState = "needs-you" | "working" | "error" | "unread" | "idle";

const BUSY = new Set(["starting", "active", "stopping", "provisioning"]);

/** The one state a By space row's dot shows, most urgent first. */
export function spaceThreadState(thread: SidebarThread): SpaceThreadState {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus) || thread.indicator === "runtime") return "working";
  if (thread.indicator === "unread-error") return "error";
  if (thread.indicator === "unread-success" || thread.isUnread) return "unread";
  return "idle";
}

const DOT: Record<SpaceThreadState, { className: string; label: string | null }> = {
  "needs-you": { className: "bg-warning", label: "Needs you" },
  working: { className: "bg-success ring-[3px] ring-success/20", label: "Working" },
  error: { className: "bg-destructive", label: "Unread error" },
  unread: { className: "bg-blue-500", label: "Unread result" },
  idle: { className: "bg-subtle-foreground/50", label: null },
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
  const { className, label } = DOT[state];
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

const LINE_TONE: Record<ThreadLine["kind"], string> = {
  progress: "text-subtle-foreground",
  failure: "text-destructive/80",
  blocked: "text-warning/80",
};

/** What a By space row adds to BB's thread row; null in every other view. */
export interface SpaceThreadRow {
  className: string | undefined;
  style: CSSProperties | undefined;
  /** The status dot before the title; it replaces BB's status glyph. */
  dot: ReactNode;
  /** The relative time where BB shows the status glyph. */
  time: ReactNode;
  /** The latest line under the title, or a blank one until it loads. */
  line: ReactNode;
}

/**
 * By space's two-line row: a status dot, the title and its age on line one,
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
  return {
    className: "h-auto flex-wrap pb-1.5 max-md:pointer-coarse:h-auto",
    style: { rowGap: 0 },
    dot: <SpaceThreadDot state={spaceThreadState(thread)} />,
    time: (
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
