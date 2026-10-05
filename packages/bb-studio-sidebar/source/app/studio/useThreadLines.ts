import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadLine } from "./SpaceThreadRow.js";

/** `thread_lines` takes at most this many threads. */
export const THREAD_LINES_LIMIT = 60;
const REFRESH_MS = 30_000;
/** Status changes arrive in bursts; one fetch follows each burst. */
const SETTLE_MS = 300;

const linesSchema = z.object({
  lines: z.record(z.string(), z.object({
    text: z.string(),
    kind: z.enum(["progress", "failure", "blocked"]).catch("progress"),
    at: z.number().nullable().catch(null),
  })).catch({}),
});

const recency = (thread: SidebarThread) => Math.max(thread.updatedAt, thread.latestAttentionAt);

/** The threads to ask about: leads first, then the rest by recency, capped. */
export function threadLineIds(leads: readonly SidebarThread[], rest: readonly SidebarThread[]): string[] {
  const ids = new Set(leads.map((thread) => thread.id));
  for (const thread of [...rest].sort((a, b) => recency(b) - recency(a))) ids.add(thread.id);
  return [...ids].slice(0, THREAD_LINES_LIMIT);
}

/** What changes a thread's line: its status, attention and unread state. */
export function threadLineStatusKey(threads: readonly SidebarThread[], ids: readonly string[]): string {
  const wanted = new Set(ids);
  return threads
    .filter((thread) => wanted.has(thread.id))
    .map((thread) => `${thread.id}:${thread.status}:${thread.runtimeStatus}:${thread.indicator}:${thread.hasPendingInteraction}:${thread.isUnread}`)
    .join("|");
}

/**
 * Each listed thread's latest line from Studio (`thread_lines`, cached 15s
 * there). Refetches when the threads or their status change, on window
 * focus, and every 30 seconds while the window is visible. Lines already
 * shown stay until a fetch replaces them.
 */
export function useThreadLines(threadIds: readonly string[], statusKey: string): Readonly<Record<string, ThreadLine>> {
  const sdk = useSdk();
  const [lines, setLines] = useState<Readonly<Record<string, ThreadLine>>>({});
  const latestIds = useRef(threadIds);
  latestIds.current = threadIds;
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const ids = latestIds.current;
    if (!ids.length) return;
    const call = ++sequence.current;
    try {
      const result = await sdk.plugins.callRpc({
        pluginId: "studio",
        method: "thread_lines",
        input: { threadIds: [...ids] } as never,
        outputSchema: linesSchema,
        signal: AbortSignal.timeout(15_000),
      });
      if (call !== sequence.current) return;
      const fetched = linesSchema.parse(result ?? {}).lines;
      setLines((current) => {
        const next = { ...current };
        for (const id of ids) {
          const line = fetched[id];
          if (line?.text.trim()) next[id] = line;
          else delete next[id];
        }
        return next;
      });
    } catch {
      // Studio may be missing or busy; keep what shows.
    }
  }, [sdk]);

  const idsKey = threadIds.join(",");
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [idsKey, refresh, statusKey]);

  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (visible()) void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (visible()) void refresh();
    }, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [refresh]);

  return lines;
}
