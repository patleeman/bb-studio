// One canvas, kept current: it loads by its backing thread and reloads on
// every realtime signal for that thread, so the board moves while the agent
// (or the hands-free voice) is still working. Older answers never replace
// newer ones: a view is taken only when its revision isn't behind.
// A page the agent is writing in its reply streams in over the same channel
// (canvas:stream): `stream` is the page so far, kept until the view has the
// finished page's revision, so the board never steps back to the old page.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { canvasContract } from "../contract";
import { CANVAS_CHANNEL, CANVAS_STREAM_TYPE, CANVAS_UPDATE_TYPE, isCanvasKind, type CanvasSignal, type CanvasStreamSignal, type CanvasView } from "../shared";

/** The page being written: its html so far; `until`: once the stream ends, the revision with the finished page. */
export interface CanvasStream { html: string; n: number; until: number | null; ended: boolean }

export function useCanvas(threadId: string | null) {
  const rpc = useRpc<typeof canvasContract>();
  const [canvas, setCanvas] = useState<CanvasView | null | undefined>(threadId ? undefined : null);
  const [stream, setStream] = useState<CanvasStream | null>(null);
  const latest = useRef({ threadId, ticket: 0, seen: -1 });
  if (latest.current.threadId !== threadId) latest.current = { threadId, ticket: 0, seen: -1 };
  const scope = latest.current;

  const load = useCallback(async () => {
    if (!threadId) { setCanvas(null); return; }
    const ticket = ++scope.ticket;
    try {
      const { canvas: next } = await rpc.call("canvas.get", { threadId });
      if (latest.current !== scope) return;
      const view = next as CanvasView | null;
      // Never go back a revision; a stale answer for the same one only when it's the latest asked.
      if (view && view.rev < scope.seen) return;
      if (view && view.rev === scope.seen && ticket !== scope.ticket) return;
      scope.seen = view?.rev ?? scope.seen;
      // Only kinds this build draws: retired ones (notes) never reach a board.
      setCanvas(view && { ...view, items: view.items.filter((item) => isCanvasKind(item.kind)) });
    } catch {
      if (latest.current === scope && scope.seen < 0) setCanvas(null);
    }
  }, [rpc, scope, threadId]);

  useEffect(() => { void load(); }, [load]);

  useRealtime(CANVAS_CHANNEL, (payload) => {
    const signal = payload as Partial<CanvasSignal> | CanvasStreamSignal | null;
    if (!signal || signal.threadId !== threadId) return;
    if (signal.type === CANVAS_UPDATE_TYPE) void load();
    if (signal.type === CANVAS_STREAM_TYPE) {
      const each = signal as CanvasStreamSignal;
      if (each.done) setStream((now) => (now && each.rev !== null ? { ...now, until: each.rev, ended: true } : null));
      else setStream((now) => (now && now.n > each.n && !now.ended ? now : { html: each.html, n: each.n, until: null, ended: false }));
    }
  });

  // The stream gives way to the board once the board has the finished page, or the turn is over.
  useEffect(() => {
    if (!stream || !canvas) return;
    if (stream.ended ? stream.until !== null && canvas.rev >= stream.until : canvas.status !== "working") setStream(null);
  }, [canvas, stream]);
  useEffect(() => { setStream(null); }, [threadId]);

  // Back on screen: catch up on anything missed while hidden.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** Sends a message (continuing from an old version when fromVersion is one); resolves to the canvas's thread now (a new one after a provider switch). */
  const send = useCallback(async (text: string, fromVersion: number | null = null): Promise<string> => {
    if (!threadId) throw new Error("No canvas yet.");
    const result = await rpc.call("canvas.send", { threadId, text, ...(fromVersion ? { fromVersion } : {}) });
    if (result.threadId === threadId) await load();
    return result.threadId;
  }, [load, rpc, threadId]);

  return { canvas, stream, reload: load, send };
}
