import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { Icon, ItemTile } from "@bb-studio/kit/app";
import type { CommandThread } from "./command-contract";
import { byAttention, followThread, movePane, threadActivity } from "./command-layout";

const PANE_DRAG = "application/x-bb-command-pane";
const readOpen = (key: string): string[] => { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter(id => typeof id === "string") : []; } catch { return []; } };
const time = (at: number) => at ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(at) : "";
const paneOf = (id: string) => document.querySelector<HTMLElement>(`[data-command-panes] [data-channel-thread="${CSS.escape(id)}"]`);

function Status({ thread, withTime = false }: { thread: CommandThread; withTime?: boolean }) {
  const activity = threadActivity(thread);
  return <span className="channel-status" data-activity={activity}>
    <span className="channel-status-dot" aria-hidden />{activity}{withTime && activity === "Idle" && thread.updatedAt ? <span className="text-subtle-foreground"> · {time(thread.updatedAt)}</span> : null}
  </span>;
}

/**
 * Keeps a transcript on its newest message while the owner stays at the
 * bottom, the way a thread page does. BB's timeline ThreadChat scrolls but
 * doesn't follow, so without this every pane opened at its first message.
 */
function useFollowLatest() {
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!body) return;
    let scroller: HTMLElement | null = null, follow = true, frame = 0;
    const toLatest = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (follow && scroller) scroller.scrollTop = scroller.scrollHeight; }); };
    // Scrolling up stops following; scrolling back to the bottom resumes it.
    const scrolled = () => { if (scroller) follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48; };
    const resized = new ResizeObserver(toLatest);
    // BB swaps its loading state for the scroller once the thread loads.
    const attach = () => {
      const next = body.querySelector<HTMLElement>('[class~="overflow-y-auto"]');
      if (next === scroller) return;
      scroller?.removeEventListener("scroll", scrolled);
      resized.disconnect();
      scroller = next;
      follow = true;
      if (!scroller) return;
      scroller.addEventListener("scroll", scrolled, { passive: true });
      resized.observe(scroller);
      for (const child of scroller.children) resized.observe(child);
    };
    const changed = new MutationObserver(() => { attach(); toLatest(); });
    changed.observe(body, { childList: true, subtree: true });
    attach();
    toLatest();
    return () => { cancelAnimationFrame(frame); changed.disconnect(); resized.disconnect(); scroller?.removeEventListener("scroll", scrolled); };
  }, [body]);
  return setBody;
}

/**
 * One thread's transcript. Re-rendering BB's timeline is costly, so it renders
 * only when the thread changes; the callbacks only set view state, so older
 * copies of them still work.
 */
const Transcript = memo(function Transcript({ threadId, onReply, choose }: { threadId: string; onReply(id: string): void; choose(id: string): void }) {
  const follow = useFollowLatest();
  const latest = useRef({ onReply, choose });
  latest.current = { onReply, choose };
  const actions = useMemo(() => [{ id: "command-reply", title: "Send to this thread", icon: "ArrowTurnBackward", run: () => latest.current.choose(threadId) }], [threadId]);
  return <div ref={follow} className="channel-pane-body" onPointerDownCapture={() => latest.current.onReply(threadId)} onFocusCapture={() => latest.current.onReply(threadId)}>
    <ThreadChat threadId={threadId} variant="timeline" layout="contained" className="h-full" messageActions={actions} />
  </div>;
}, (a, b) => a.threadId === b.threadId);

export type CommandPanes = ReturnType<typeof useCommandPanes>;

/**
 * Which threads have a pane. With none opened, one pane follows the work;
 * opening another thread keeps that one and adds a pane beside it, so the
 * view becomes a grid. Closing a pane only hides it; the thread list beside
 * the composer opens it again. Closing the last one goes back to following.
 */
export function useCommandPanes(spaceId: string, threads: CommandThread[], leadThreadId: string | null) {
  const key = `studio:command-open:${spaceId}`;
  const [opened, setOpened] = useState(() => readOpen(key));
  useEffect(() => setOpened(readOpen(key)), [key]);
  const [announcement, setAnnouncement] = useState("");
  const lastFollowed = useRef<string | null>(null);
  const pinned = opened.flatMap(id => threads.filter(thread => thread.id === id));
  const following = !pinned.length;
  const followed = following ? followThread(threads, lastFollowed.current, leadThreadId) : undefined;
  useEffect(() => { if (followed) lastFollowed.current = followed.id; }, [followed?.id]);
  const shown = following ? followed ? [followed] : [] : pinned;
  const ids = shown.map(thread => thread.id);
  const title = (id: string) => threads.find(thread => thread.id === id)?.title ?? "Thread";
  const save = (next: string[]) => {
    setOpened(next);
    try { if (next.length) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key); } catch {}
  };
  return {
    shown, following, announcement,
    open(id: string) {
      // A thread already on screen just scrolls into view.
      if (ids.includes(id)) return paneOf(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      save([...ids, id]);
      setAnnouncement(`Opened ${title(id)}.`);
    },
    close(id: string) {
      save(ids.filter(other => other !== id));
      setAnnouncement(ids.length > 1 ? `Closed ${title(id)}.` : "Following the work again.");
    },
    only(id: string) { save([id]); },
    follow() { save([]); setAnnouncement("Following the work again."); },
    move(id: string, target: string, place: "before" | "after") {
      const next = movePane(ids, id, target, place);
      if (next === ids) return;
      save(next);
      setAnnouncement(`Moved ${title(id)} to position ${next.indexOf(id) + 1} of ${next.length}.`);
    },
  };
}

/** A Space's open panes: one following the work, or the ones the owner opened, side by side. */
export function CommandThreads({ panes, threads, leadThreadId, onReply, onOpen }: {
  panes: CommandPanes; threads: CommandThread[]; leadThreadId: string | null;
  onReply(id: string, focusComposer?: boolean): void; onOpen(id: string): void;
}) {
  const label = (thread: CommandThread) => thread.title;
  const choose = useMemo(() => (id: string) => onReply(id, true), [onReply]);
  const [dragging, setDraggingState] = useState<string | null>(null);
  // Drag events can arrive before React re-renders, so handlers read the ref.
  const draggingRef = useRef<string | null>(null);
  const setDragging = (id: string | null) => { draggingRef.current = id; setDraggingState(id); };
  const [drop, setDrop] = useState<{ id: string; place: "before" | "after"; axis: "x" | "y" } | null>(null);
  const { shown, following } = panes;
  const arrangeable = shown.length > 1;
  const nudge = (event: KeyboardEvent, id: string) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = shown.map(thread => thread.id), target = ids[ids.indexOf(id) + step];
    if (target) panes.move(id, target, step < 0 ? "before" : "after");
  };
  const dragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!draggingRef.current || !event.dataTransfer.types.includes(PANE_DRAG)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect(), stage = event.currentTarget.parentElement?.getBoundingClientRect();
    // A pane that fills the row (phones) splits top and bottom; otherwise left and right.
    const stacked = !!stage && rect.width > stage.width * 0.8;
    const place = (stacked ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2) ? "before" : "after";
    if (drop?.id !== id || drop.place !== place) setDrop({ id, place, axis: stacked ? "y" : "x" });
  };
  const endDrag = () => { setDragging(null); setDrop(null); };
  const childrenOf = (id: string) => threads.filter(child => child.parentThreadId === id);

  const pane = (thread: CommandThread) => {
    const forks = childrenOf(thread.id);
    return <section key={thread.id} className="channel-thread-pane" data-channel-thread={thread.id} data-activity={threadActivity(thread)} aria-label={`${label(thread)} transcript`}
      data-dragging={dragging === thread.id || undefined} data-drop={drop?.id === thread.id && dragging !== thread.id ? drop.place : undefined} data-drop-axis={drop?.id === thread.id ? drop.axis : undefined}
      onDragOver={arrangeable ? event => dragOver(event, thread.id) : undefined}
      onDrop={arrangeable ? event => { event.preventDefault(); if (draggingRef.current && drop) panes.move(draggingRef.current, drop.id, drop.place); endDrag(); } : undefined}>
      <header draggable={arrangeable || undefined} data-arrangeable={arrangeable || undefined}
        onDragStart={arrangeable ? event => { event.dataTransfer.setData(PANE_DRAG, thread.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 24, 20); setDragging(thread.id); } : undefined}
        onDragEnd={arrangeable ? endDrag : undefined}>
        {arrangeable && <button type="button" className="channel-pane-grip" aria-label={`Move ${label(thread)}`} title="Drag to rearrange. Arrow keys move it too." onKeyDown={event => nudge(event, thread.id)}><Icon name="DragDropVertical" className="size-3.5" /></button>}
        <ItemTile icon={null} kindIcon="MessageSquare" size="sm" />
        <span className="min-w-0 flex-1">
          <button className="block max-w-full truncate text-left text-sm font-medium hover:underline" type="button" onClick={() => onOpen(thread.id)} title={`Open ${thread.title}`}>{label(thread)}</button>
        </span>
        {thread.id === leadThreadId && <span className="shrink-0 text-xs text-subtle-foreground" data-command-lead>Lead</span>}
        {following && <span className="shrink-0 text-xs text-subtle-foreground" title="This pane switches to whichever thread is working. Open another thread to keep this one." data-command-following>Following</span>}
        <Status thread={thread} withTime />
        <span className="channel-pane-actions">
          <button type="button" aria-label={`Send to ${label(thread)}`} title="Send to this thread" onClick={() => choose(thread.id)} className="channel-pane-action"><Icon name="ArrowTurnBackward" className="size-3.5" /></button>
          {arrangeable && <button type="button" aria-label={`Show only ${label(thread)}`} title="Close the other panes" onClick={() => panes.only(thread.id)} className="channel-pane-action"><Icon name="Maximize2" className="size-3.5" /></button>}
          {!following && <button type="button" aria-label={`Close ${label(thread)}`} title={arrangeable ? "Close. Open it again from the thread list." : "Close and follow the work again"} onClick={() => panes.close(thread.id)} className="channel-pane-action"><Icon name="X" className="size-3.5" /></button>}
        </span>
      </header>
      {thread.error ? <p className="p-4 text-sm text-destructive">{thread.error}</p> : <Transcript threadId={thread.id} onReply={onReply} choose={choose} />}
      {forks.length > 0 && <footer aria-label="Forks">{forks.map(child => <button type="button" key={child.id} onClick={() => panes.open(child.id)} title={`Open ${child.title}`}><Icon name="GitBranch" className="size-3 shrink-0" aria-hidden /><span className="truncate">{child.title}</span><Status thread={child} /></button>)}</footer>}
    </section>;
  };

  return <div className="channel-thread-layout" data-command-panes>
    <div className="channel-thread-stage" data-thread-count={shown.length}>
      {!shown.length && <div className="channel-stage-empty" role="status"><p className="font-medium">No threads in this Space</p><p className="text-muted-foreground">Add threads to the Space to command them here.</p></div>}
      {shown.map(pane)}
    </div>
    <span className="sr-only" aria-live="polite">{panes.announcement}</span>
  </div>;
}

/** Every thread in the Space, beside the composer: open one as a pane, or close it again. */
export function CommandSwitcher({ panes, threads, leadThreadId }: { panes: CommandPanes; threads: CommandThread[]; leadThreadId: string | null }) {
  const roots = byAttention(threads.filter(thread => !thread.parentThreadId));
  const lead = roots.filter(thread => thread.id === leadThreadId);
  // Lead first, then attention order, with forks right after their parent.
  const rows = [...lead, ...roots.filter(thread => thread.id !== leadThreadId)].flatMap(root => [root, ...byAttention(threads.filter(child => child.parentThreadId === root.id))]);
  const shown = new Set(panes.shown.map(thread => thread.id));
  return <nav className="channel-switcher" aria-label="Space threads">
    <div className="channel-switcher-list">
      <div className="channel-switcher-head">
        <span>Threads</span>
        {panes.following
          ? <span className="text-subtle-foreground" title="One pane follows whichever thread is working. Open another thread to add a pane.">Following work</span>
          : <button type="button" onClick={panes.follow} title="Close every pane and follow whichever thread is working">Follow work</button>}
      </div>
      {rows.map(thread => {
        const open = shown.has(thread.id), activity = threadActivity(thread);
        return <div key={thread.id} className="channel-switcher-row" data-current={open || undefined} data-fork={thread.parentThreadId ? "" : undefined} data-activity={activity}>
          <button type="button" aria-pressed={open} onClick={() => panes.open(thread.id)} aria-label={`${thread.title}, ${activity}${open ? ", open" : ""}`} title={open ? `${thread.title} · ${activity}` : `Open ${thread.title} · ${activity}`}>
            {thread.parentThreadId ? <Icon name="GitBranch" className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden /> : <ItemTile icon={null} kindIcon="MessageSquare" size="sm" />}
            <span className="channel-rail-name">{thread.title}</span>
            {thread.id === leadThreadId && <span className="shrink-0 text-xs text-subtle-foreground">Lead</span>}
            <span className="channel-status-dot" aria-hidden />
          </button>
          {open && !panes.following && <button type="button" className="channel-pane-action channel-switcher-close" aria-label={`Close ${thread.title}`} title="Close this pane" onClick={() => panes.close(thread.id)}><Icon name="X" className="size-3" /></button>}
        </div>;
      })}
    </div>
  </nav>;
}
