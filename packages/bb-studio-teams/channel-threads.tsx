import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import { ThreadChat, useRpc } from "@get-bb/plugin-sdk/app";
import { Icon, ItemTile } from "@bb-studio/kit/app";
import type { Bot } from "./contract";
import type { rpcContract } from "./client-contract";
import type { ThreadView, ViewThread } from "./view-contract";
import { CHANNEL_LAYOUTS, activeThreads, arrangeGrid, byAttention, focusedThread, movePane, threadActivity, type ChannelLayout } from "./channel-layout";

const LAYOUT_ICONS: Record<ChannelLayout, string> = { merged: "MessageSquare", grid: "GridView", active: "Zap", focus: "Maximize2" };
const PANE_DRAG = "application/x-bb-channel-pane";
const readOrder = (key: string): string[] => { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter(id => typeof id === "string") : []; } catch { return []; } };
const time = (at: number) => at ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(at) : "";

/** Segmented switcher for the channel's four layouts. */
export function ChannelLayoutPicker({ value, onChange }: { value: ChannelLayout; onChange(layout: ChannelLayout): void }) {
  return <div className="channel-layout-picker" role="group" aria-label="Channel view">
    {CHANNEL_LAYOUTS.map(choice => <button key={choice.id} type="button" data-layout={choice.id} aria-pressed={value === choice.id} title={choice.detail} onClick={() => onChange(choice.id)}>
      <Icon name={LAYOUT_ICONS[choice.id]} className="size-3.5" aria-hidden />{choice.label}
    </button>)}
  </div>;
}

function Status({ thread, withTime = false }: { thread: ViewThread; withTime?: boolean }) {
  const activity = threadActivity(thread);
  return <span className="channel-status" data-activity={activity}>
    <span className="channel-status-dot" aria-hidden />{activity}{withTime && activity === "Idle" && thread.updatedAt ? <span className="text-subtle-foreground"> · {time(thread.updatedAt)}</span> : null}
  </span>;
}

export function ChannelThreads({ view, initialThreads, bots, layout, selected, onSelect, onReply, onOpen }: {
  view: ThreadView; initialThreads: ViewThread[]; bots: Bot[]; layout: Exclude<ChannelLayout, "merged">;
  selected: string | null; onSelect(id: string): void; onReply(id: string, focusComposer?: boolean): void; onOpen(id: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [threads, setThreads] = useState(initialThreads);
  useEffect(() => setThreads(initialThreads), [initialThreads]);
  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try { const next = await rpc.call("viewThreads", { id: view.id }); if (alive) setThreads(next); }
      catch {} finally { pending = false; }
    };
    const timer = setInterval(() => void refresh(), 3000);
    void refresh();
    return () => { alive = false; clearInterval(timer); };
  }, [rpc, view.id]);
  const botFor = (thread: ViewThread) => bots.find(bot => bot.id === thread.botId);
  const label = (thread: ViewThread) => botFor(thread)?.name || thread.title;
  const avatar = (thread: ViewThread) => <ItemTile icon={botFor(thread)?.avatar || null} kindIcon={thread.botId ? "Bot" : "MessageSquare"} size="sm" />;
  const choose = useCallback((id: string) => onReply(id, true), [onReply]);
  const orderKey = `bot-teams:grid-order:${view.id}`;
  const [order, setOrder] = useState(() => readOrder(orderKey));
  useEffect(() => setOrder(readOrder(orderKey)), [orderKey]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; place: "before" | "after"; axis: "x" | "y" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const roots = byAttention(threads.filter(thread => !thread.parentThreadId));
  const gridRoots = arrangeGrid(roots, order);
  const saveOrder = (next: string[]) => { setOrder(next); try { if (next.length) localStorage.setItem(orderKey, JSON.stringify(next)); else localStorage.removeItem(orderKey); } catch {} };
  const move = (id: string, target: string, place: "before" | "after") => {
    const ids = gridRoots.map(thread => thread.id), next = movePane(ids, id, target, place);
    if (next === ids) return;
    saveOrder(next);
    const moved = roots.find(thread => thread.id === id);
    setAnnouncement(`Moved ${moved ? label(moved) : "pane"} to position ${next.indexOf(id) + 1} of ${next.length}.`);
  };
  const nudge = (event: KeyboardEvent, id: string) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = gridRoots.map(thread => thread.id), target = ids[ids.indexOf(id) + step];
    if (target) move(id, target, step < 0 ? "before" : "after");
  };
  const dragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!dragging || !event.dataTransfer.types.includes(PANE_DRAG)) return;
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
  const unstarted = view.members.flatMap(member => member.kind === "bot" && !threads.some(thread => thread.botId === member.id) ? [bots.find(bot => bot.id === member.id) ?? { id: member.id, name: "Bot", avatar: null }] : []);
  const focused = focusedThread(threads, selected);
  const working = byAttention(activeThreads(threads));
  const visible = layout === "active" ? working : layout === "focus" ? focused ? [focused] : [] : gridRoots;
  const arrangeable = layout === "grid" && gridRoots.length > 1;
  // Rails list roots in attention order, with forks right after their parent.
  const railThreads = roots.flatMap(root => [root, ...byAttention(childrenOf(root.id))]);
  const recent = [...roots].filter(thread => !thread.error && thread.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const pane = (thread: ViewThread) => {
    const forks = childrenOf(thread.id);
    return <section key={thread.id} className="channel-thread-pane" data-channel-thread={thread.id} data-activity={threadActivity(thread)} aria-label={`${label(thread)} transcript`}
      data-dragging={dragging === thread.id || undefined} data-drop={drop?.id === thread.id && dragging !== thread.id ? drop.place : undefined} data-drop-axis={drop?.id === thread.id ? drop.axis : undefined}
      onDragOver={arrangeable ? event => dragOver(event, thread.id) : undefined}
      onDrop={arrangeable ? event => { event.preventDefault(); if (dragging && drop) move(dragging, drop.id, drop.place); endDrag(); } : undefined}>
      <header draggable={arrangeable || undefined} data-arrangeable={arrangeable || undefined}
        onDragStart={arrangeable ? event => { event.dataTransfer.setData(PANE_DRAG, thread.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 24, 20); setDragging(thread.id); } : undefined}
        onDragEnd={arrangeable ? endDrag : undefined}>
        {arrangeable && <button type="button" className="channel-pane-grip" aria-label={`Move ${label(thread)}`} title="Drag to rearrange. Arrow keys move it too." onKeyDown={event => nudge(event, thread.id)}><Icon name="DragDropVertical" className="size-3.5" /></button>}
        {avatar(thread)}
        <span className="min-w-0 flex-1">
          <button className="block max-w-full truncate text-left text-sm font-medium hover:underline" type="button" onClick={() => onOpen(thread.id)} title={`Open ${thread.title}`}>{label(thread)}</button>
          {layout === "focus" && thread.botId && thread.title !== label(thread) && <span className="block truncate text-xs text-subtle-foreground">{thread.title}</span>}
        </span>
        <Status thread={thread} withTime />
        <span className="channel-pane-actions">
          <button type="button" aria-label={`Reply to ${label(thread)}`} title="Reply in channel" onClick={() => choose(thread.id)} className="channel-pane-action"><Icon name="ArrowTurnBackward" className="size-3.5" /></button>
          {layout === "focus"
            ? <button type="button" aria-label={`Open ${label(thread)}`} title="Open thread" onClick={() => onOpen(thread.id)} className="channel-pane-action"><Icon name="ArrowUpRight" className="size-3.5" /></button>
            : <button type="button" aria-label={`Focus ${label(thread)}`} title="Focus thread" onClick={() => onSelect(thread.id)} className="channel-pane-action"><Icon name="Maximize2" className="size-3.5" /></button>}
        </span>
      </header>
      {thread.error ? <p className="p-4 text-sm text-destructive">{thread.error}</p> : <div className="channel-pane-body" onPointerDownCapture={() => onReply(thread.id)} onFocusCapture={() => onReply(thread.id)}><ThreadChat threadId={thread.id} variant="timeline" layout="contained" className="h-full" messageActions={[{ id: "channel-reply", title: "Reply in channel", icon: "ArrowTurnBackward", run: () => choose(thread.id) }]} /></div>}
      {forks.length > 0 && layout !== "focus" && <footer aria-label="Forks">{forks.map(child => <button type="button" key={child.id} onClick={() => onSelect(child.id)} title={child.title}><Icon name="GitBranch" className="size-3 shrink-0" aria-hidden /><span className="truncate">{child.title}</span><Status thread={child} /></button>)}</footer>}
    </section>;
  };
  const customOrder = order.some(id => roots.some(thread => thread.id === id));
  const gridFooter = (unstarted.length > 0 || customOrder) && <div className="channel-unstarted">
    {unstarted.length > 0 && <><span className="text-xs text-subtle-foreground">Not started</span>
      {unstarted.map(bot => <span key={bot.id} className="channel-unstarted-chip" title="Mention this bot in the composer to start its thread"><ItemTile icon={bot.avatar || null} kindIcon="Bot" size="sm" /><span className="truncate">{bot.name}</span></span>)}</>}
    {customOrder && <button type="button" className="channel-reset-order" onClick={() => { saveOrder([]); setAnnouncement("Panes sorted by attention again."); }} title="Put threads that need you first again">Reset order</button>}
  </div>;

  return <div className="channel-thread-layout" data-channel-layout={layout}>
    {layout === "focus" && <nav className="channel-member-rail" aria-label="Channel threads">
      {railThreads.map(thread => <button key={thread.id} type="button" aria-current={focused?.id === thread.id || undefined} data-fork={thread.parentThreadId ? "" : undefined} data-activity={threadActivity(thread)} onClick={() => onSelect(thread.id)} title={`${thread.title} · ${threadActivity(thread)}`}>
        {thread.parentThreadId ? <Icon name="GitBranch" className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden /> : avatar(thread)}
        <span className="channel-rail-name">{label(thread)}</span>
        <span className="channel-status-dot" aria-hidden /><span className="sr-only">{threadActivity(thread)}</span>
      </button>)}
      {unstarted.map(bot => <div key={bot.id} className="channel-member-unstarted" title="Not started. Mention this bot to start its thread."><ItemTile icon={bot.avatar || null} kindIcon="Bot" size="sm" /><span className="channel-rail-name">{bot.name}</span></div>)}
    </nav>}
    {layout === "active" && <nav className="channel-roster" aria-label="Channel threads">
      {roots.map(thread => <button key={thread.id} type="button" data-activity={threadActivity(thread)} onClick={() => onSelect(thread.id)} title={`Focus ${thread.title}`}>
        {avatar(thread)}<span className="channel-rail-name">{label(thread)}</span><Status thread={thread} />
      </button>)}
      {unstarted.map(bot => <span key={bot.id} className="channel-member-unstarted" title="Not started. Mention this bot to start its thread."><ItemTile icon={bot.avatar || null} kindIcon="Bot" size="sm" /><span className="channel-rail-name">{bot.name}</span></span>)}
    </nav>}
    <div className="channel-thread-stage" data-thread-count={visible.length}>
      {!visible.length && <div className="channel-stage-empty" role="status">
        {layout === "active"
          ? <><p className="font-medium">Nobody is working right now</p>
            {recent ? <p className="text-muted-foreground">Last reply from <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => onSelect(recent.id)}>{label(recent)}</button> at {time(recent.updatedAt)}. Threads appear here while they work.</p>
              : <p className="text-muted-foreground">Threads appear here while they work.</p>}</>
          : <><p className="font-medium">No conversations yet</p><p className="text-muted-foreground">Mention a member below to start one.</p></>}
      </div>}
      {visible.map(pane)}
    </div>
    {layout === "grid" && gridFooter}
    <span className="sr-only" aria-live="polite">{announcement}</span>
  </div>;
}
