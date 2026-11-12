// A thread that BB Studio mirrors from bb (a fork with the one-way import)
// is read-only here until someone takes it over. It shows as a read-only
// conversation: its composer is replaced by this box, which says so and
// offers the take-over (src/ui/conversations/ReadOnlyComposer.tsx). On a BB
// without the import routes the status request fails and nothing is drawn.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface MirrorStatus {
  mirrored: boolean;
  readOnly?: boolean;
  sourceStatus?: string;
  sourceQueuedMessages?: number;
}

const RUNNING = new Set(["starting", "active", "stopping"]);
const REFRESH_MS = 15_000;

async function readStatus(threadId: string, signal: AbortSignal): Promise<MirrorStatus | null> {
  try {
    const response = await fetch(`/api/v1/fork/import/threads/${encodeURIComponent(threadId)}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as MirrorStatus;
  } catch {
    return null;
  }
}

/** Why a take-over would be refused right now ("running in bb"), or null when it can go ahead. */
export function takeOverBlocker(status: MirrorStatus): string | null {
  if (status.sourceStatus !== undefined && RUNNING.has(status.sourceStatus)) return "running in bb";
  if ((status.sourceQueuedMessages ?? 0) > 0) return "messages queued in bb";
  return null;
}

/** The banner's one line: "Read-only", and why it can't be taken over yet. */
export function mirrorHeading(blocker: string | null): string {
  return blocker ? `Read-only · ${blocker}` : "Read-only";
}

interface MirrorEntry { status: MirrorStatus | null; listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null; control: AbortController | null }
const mirrors = new Map<string, MirrorEntry>();

function mirrorEntry(threadId: string): MirrorEntry {
  let entry = mirrors.get(threadId);
  if (!entry) { entry = { status: null, listeners: new Set(), timer: null, control: null }; mirrors.set(threadId, entry); }
  return entry;
}

/**
 * Whether a thread is mirrored from bb and read-only here, read from the
 * fork's import routes every 15 seconds while something shows it. Shared,
 * so the composer's replacement and its check ask once. Null while unknown
 * or on a BB without the routes.
 */
export function useMirrorStatus(threadId: string | null): MirrorStatus | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!threadId) return () => {};
    const entry = mirrorEntry(threadId);
    entry.listeners.add(listener);
    if (!entry.timer) {
      entry.control = new AbortController();
      const control = entry.control;
      const load = () => void readStatus(threadId, control.signal).then((next) => {
        if (control.signal.aborted) return;
        entry.status = next;
        for (const each of entry.listeners) each();
      });
      load();
      entry.timer = setInterval(load, REFRESH_MS);
    }
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size) return;
      if (entry.timer) clearInterval(entry.timer);
      entry.control?.abort();
      mirrors.delete(threadId);
    };
  }, [threadId]);
  return useSyncExternalStore(subscribe, () => (threadId ? mirrors.get(threadId)?.status ?? null : null), () => null);
}

/** Whether the thread is mirrored and still read-only here. */
export const isReadOnlyMirror = (status: MirrorStatus | null): boolean => !!status?.mirrored && status.readOnly === true;

/** Takes a mirrored thread over: it belongs to BB Studio from now on. Answers the note to show, or throws with why not. */
export async function takeOver(threadId: string): Promise<string> {
  const response = await fetch(`/api/v1/fork/import/threads/${encodeURIComponent(threadId)}/take-over`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { note?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? "The take-over did not go through.");
  const entry = mirrors.get(threadId);
  if (entry) { entry.status = { ...(entry.status ?? { mirrored: true }), readOnly: false }; for (const each of entry.listeners) each(); }
  return body.note ?? "This thread now belongs to BB Studio.";
}

/**
 * Whether focus was lost (nothing, or the page body, has it). BB focuses its
 * composer when a thread opens; when Studio replaces the composer that
 * textarea goes away and the browser keeps its Tab starting point where it
 * was, so the next Tab would land on the first control in this box.
 */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active === document.documentElement;
}

/**
 * The mirror's own box, where the composer goes: what it is, and Take over.
 * Taking over is never one keypress away (UX review 3, item 14):
 * - The box claims the lost focus on its description, which comes after the
 *   button in DOM order, so the next Tab leaves the box and only Shift+Tab
 *   reaches "Take over…". It never takes focus from anywhere else.
 * - "Take over…" only asks: "Take over Main? It stops following bb." with
 *   Cancel focused, so Enter cancels. Escape cancels too.
 */
export function MirrorBox({ threadId, status, title }: { threadId: string; status: MirrorStatus; title: string }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const description = useRef<HTMLParagraphElement | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusIsLost()) description.current?.focus({ preventScroll: true });
  }, [threadId]);
  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try { setDone(await takeOver(threadId)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The take-over did not go through."); setConfirming(false); }
    finally { setBusy(false); }
  };
  if (done !== null) return <p data-testid="mirror-banner-done" className="px-3 py-2 text-xs text-muted-foreground">{done}</p>;
  const blocker = takeOverBlocker(status);
  if (confirming) {
    return (
      <div data-testid="mirror-confirm" role="alertdialog" aria-label={`Take over ${title}?`} aria-describedby={`mirror-confirm-${threadId}`}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } }}
        className="flex items-center gap-3 rounded-[10px] border border-border px-3 py-2 text-xs">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Take over {title}?</p>
          <p id={`mirror-confirm-${threadId}`} className="text-muted-foreground">It stops following bb.</p>
        </div>
        <button type="button" data-testid="mirror-confirm-cancel" autoFocus disabled={busy} onClick={cancel}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Cancel</button>
        <button type="button" data-testid="mirror-confirm-take-over" disabled={busy} onClick={() => void run()}
          className="shrink-0 rounded-md bg-foreground/10 px-2.5 py-1 font-medium text-foreground hover:bg-foreground/15 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{busy ? "Taking over…" : "Take over"}</button>
      </div>
    );
  }
  return (
    <div data-testid="mirror-banner" className="flex flex-col gap-0.5 px-1 py-1 text-xs">
      <div className="flex items-center gap-3">
        <p data-testid="mirror-heading" className="min-w-0 flex-1 font-medium text-foreground">{mirrorHeading(blocker)}</p>
        <button ref={opener} type="button" data-testid="mirror-take-over" disabled={blocker !== null} onClick={() => setConfirming(true)} aria-haspopup="dialog"
          className="shrink-0 rounded-md border border-border px-2.5 py-1 font-medium text-foreground hover:bg-accent disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          Take over…
        </button>
      </div>
      <p ref={description} data-testid="mirror-description" tabIndex={-1} style={{ outline: "none", boxShadow: "none" }} className="text-muted-foreground outline-none">{message}</p>
    </div>
  );
}
