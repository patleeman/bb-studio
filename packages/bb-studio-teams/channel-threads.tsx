import { useCallback, useEffect, useState } from "react";
import { ThreadChat, useRpc } from "@get-bb/plugin-sdk/app";
import { Icon, ItemTile } from "@bb-studio/kit/app";
import type { Bot } from "./contract";
import type { rpcContract } from "./client-contract";
import type { ThreadView, ViewThread } from "./view-contract";
import { activeThreads, focusedThread, threadActivity, type ChannelLayout } from "./channel-layout";

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
  const focused = focusedThread(threads, selected);
  const visible = layout === "active" ? activeThreads(threads) : layout === "focus" ? focused ? [focused] : [] : threads.filter(thread => !thread.parentThreadId);
  const choose = useCallback((id: string) => onReply(id, true), [onReply]);
  const unusedBots = view.members.filter(member => member.kind === "bot" && !threads.some(thread => thread.botId === member.id));
  return <div className="channel-thread-layout" data-channel-layout={layout}>
    {layout !== "grid" && <nav className="channel-member-rail" aria-label="Channel threads">
      {threads.map(thread => <button key={thread.id} type="button" aria-pressed={focused?.id === thread.id && layout === "focus"} data-active={activeThreads([thread]).length > 0 || undefined} onClick={() => onSelect(thread.id)} title={thread.title}>
        <ItemTile icon={botFor(thread)?.avatar || null} kindIcon={thread.botId ? "Bot" : "MessageSquare"} size="sm" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{label(thread)}</span><span className="block text-xs text-subtle-foreground">{threadActivity(thread)}</span></span>
      </button>)}
      {unusedBots.map(member => <div key={member.id} className="channel-member-idle"><ItemTile icon={bots.find(bot => bot.id === member.id)?.avatar || null} kindIcon="Bot" size="sm" /><span className="truncate text-sm">{bots.find(bot => bot.id === member.id)?.name || "Bot"}<span className="block text-xs text-subtle-foreground">No conversation yet</span></span></div>)}
    </nav>}
    <div className="channel-thread-stage" data-thread-count={visible.length}>
      {!visible.length && <div className="channel-stage-empty" role="status"><Icon name="MessageSquare" className="size-5 text-muted-foreground" /><p>{layout === "active" ? "No threads are working right now." : "No conversations yet."}</p><p className="text-muted-foreground">{layout === "active" ? "Select a member to focus its thread, or message the channel." : "Mention a member below to start."}</p></div>}
      {visible.map(thread => <section key={thread.id} className="channel-thread-pane" data-channel-thread={thread.id} aria-label={`${label(thread)} transcript`}>
        <header><ItemTile icon={botFor(thread)?.avatar || null} kindIcon={thread.botId ? "Bot" : "MessageSquare"} size="sm" /><button className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" type="button" onClick={() => onOpen(thread.id)} title={thread.title}>{label(thread)}</button><span className="text-xs text-subtle-foreground">{threadActivity(thread)}</span><button type="button" aria-label={`Reply to ${label(thread)}`} title="Reply in channel" onClick={() => choose(thread.id)} className="channel-pane-action"><Icon name="ArrowTurnBackward" className="size-3.5" /></button><button type="button" aria-label={`Focus ${label(thread)}`} title="Focus thread" onClick={() => onSelect(thread.id)} className="channel-pane-action"><Icon name="Maximize" className="size-3.5" /></button></header>
        {thread.error ? <p className="p-4 text-sm text-destructive">{thread.error}</p> : <div className="min-h-0 flex-1" onPointerDownCapture={() => onReply(thread.id)} onFocusCapture={() => onReply(thread.id)}><ThreadChat threadId={thread.id} variant="timeline" layout="contained" className="h-full" messageActions={[{ id: "channel-reply", title: "Reply in channel", icon: "ArrowTurnBackward", run: () => choose(thread.id) }]} /></div>}
        {threads.some(child => child.parentThreadId === thread.id) && <footer>{threads.filter(child => child.parentThreadId === thread.id).map(child => <button type="button" key={child.id} onClick={() => onSelect(child.id)} className="truncate text-xs text-muted-foreground hover:text-foreground" title={child.title}>{child.title} · {threadActivity(child)}</button>)}</footer>}
      </section>)}
      {layout === "grid" && unusedBots.map(member => <section className="channel-thread-pane" key={member.id}><header><ItemTile icon={bots.find(bot => bot.id === member.id)?.avatar || null} kindIcon="Bot" size="sm" /><span className="text-sm font-medium">{bots.find(bot => bot.id === member.id)?.name || "Bot"}</span></header><div className="channel-stage-empty text-muted-foreground">Mention this bot below to start its conversation.</div></section>)}
    </div>
  </div>;
}
