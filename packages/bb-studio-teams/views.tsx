import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown, useBbNavigate, useRealtime, useRpc, useSdk, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon, ItemHeader, ItemTile, PageColumn, AddOnCollection, openAppPath, studioPath, useStudioPresent, type ProviderCall } from "@bb-studio/kit/app";
import { Button, Input } from "@bb-studio/kit/ui";
import { Modal } from "./channel-controls";
import { ErrorMessage, message } from "./bot-ui";
import { PLUGIN_ID, VIEW_KIND } from "./studio-provider";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import type { Bot } from "./contract";
import type { rpcContract } from "./client-contract";
import type { ThreadView, ViewEntry, ViewMember, ViewThread } from "./view-contract";

type Contract = typeof rpcContract;
type Page = { view: ThreadView; threads: ViewThread[]; entries: ViewEntry[]; hasOlder: boolean };
const memberKey = (m: ViewMember) => `${m.kind}:${m.id}`;
function ViewEditor({ initial, open, onClose, onSaved }: { initial?: ThreadView; open: boolean; onClose(): void; onSaved(view: ThreadView): void }) {
  const rpc = useRpc<Contract>(), sdk = useSdk();
  const [name, setName] = useState(initial?.name ?? ""), [members, setMembers] = useState<ViewMember[]>(initial?.members ?? []);
  const [bots, setBots] = useState<Bot[]>([]), [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [query, setQuery] = useState(""), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([rpc.call("profiles", {}), sdk.threads.list({ limit: 100 })]).then(([bots, rows]) => {
      if (!alive) return;
      setBots(bots); setThreads(rows.filter(t => t.visibility !== "hidden").map(t => ({ id: t.id, title: t.title || t.titleFallback || "New thread" })));
    }, e => { if (alive) setError(message(e)); });
    return () => { alive = false; };
  }, [rpc, sdk, open]);
  const toggle = (m: ViewMember) => setMembers(current => current.some(v => memberKey(v) === memberKey(m)) ? current.filter(v => memberKey(v) !== memberKey(m)) : [...current, m]);
  const candidates = [...bots.map(b => ({ member: { kind: "bot" as const, id: b.id }, label: b.name, detail: `@${b.handle}` })), ...threads.map(t => ({ member: { kind: "thread" as const, id: t.id }, label: t.title, detail: "Thread" }))];
  const save = async () => {
    setPending(true); setError(null);
    try { onSaved(initial ? await rpc.call("viewUpdate", { ...initial, name, members, expectedUpdatedAt: initial.updatedAt }) : await rpc.call("viewCreate", { name, members, requestId: requestId.current })); }
    catch (e) { setError(message(e)); } finally { setPending(false); }
  };
  return <Modal title={initial ? "Edit view" : "New view"} open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      <label className="block text-sm">Name<Input aria-label="View name" value={name} maxLength={80} onChange={e => setName(e.target.value)} autoFocus /></label>
      <label className="block text-sm">Members<Input aria-label="Find bots and threads" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find bots and threads" /></label>
      <div className="max-h-64 overflow-auto" role="group" aria-label="View members">{candidates.filter(c => `${c.label} ${c.detail}`.toLowerCase().includes(query.toLowerCase())).map(c => <label key={memberKey(c.member)} className="flex min-w-0 items-center gap-2 py-1 text-sm"><input type="checkbox" checked={members.some(m => memberKey(m) === memberKey(c.member))} onChange={() => toggle(c.member)} /><span className="min-w-0 flex-1 truncate">{c.label}</span><span className="text-xs text-muted-foreground">{c.detail}</span></label>)}</div>
      <ErrorMessage error={error} /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !name.trim() || members.length > 32}>{pending ? "Saving…" : "Save view"}</Button></div>
    </form>
  </Modal>;
}
function ViewDetail({ id }: { id: string }) {
  const rpc = useRpc<Contract>(), navigate = useBbNavigate(), studio = useStudioPresent();
  const [page, setPage] = useState<Page | null>(null), [bots, setBots] = useState<Bot[]>([]), [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(""), [targets, setTargets] = useState<ViewMember[]>([]), [reply, setReply] = useState<string | null>(null);
  const [pending, setPending] = useState(false), [editing, setEditing] = useState(false), [fresh, setFresh] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const generation = useRef(0), retry = useRef<{ requestId: string; signature: string } | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!page || initialized.current) return;
    initialized.current = true;
    if (page.view.name === "New view" && !page.view.members.length) setEditing(true);
  }, [page]);
  const timeline = useRef<HTMLDivElement>(null), followLatest = useRef(true);
  useLayoutEffect(() => {
    if (followLatest.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [page?.entries.at(-1)?.id]);
  const load = useCallback(() => {
    const seq = ++generation.current;
    void rpc.call("view", { id }).then(next => {
      if (seq !== generation.current) return;
      setPage(previous => { const older = previous?.entries.filter(e => e.createdAt < (next.entries[0]?.createdAt ?? 0)) ?? []; return { ...next, entries: [...older, ...next.entries], hasOlder: older.length ? previous!.hasOlder : next.hasOlder }; });
    }, e => { if (seq === generation.current) setError(message(e)); });
  }, [rpc, id]);
  useEffect(() => { load(); void rpc.call("profiles", {}).then(setBots, e => setError(message(e))); return () => { generation.current++; }; }, [load, rpc]);
  useRealtime("views-changed", load);
  const send = async () => {
    if (!text.trim() || pending) return;
    setPending(true); setError(null);
    const command = /^\/(steer|followup|fork)\s+/.exec(text);
    const input = { id, text: command ? text.slice(command[0].length) : text, targets, replyThreadId: reply, fresh, mode: (command?.[1] ?? "auto") as "auto" | "steer" | "followup" | "fork" };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    try {
      const result = await rpc.call("viewSend", { ...input, requestId: retry.current!.requestId });
      const failures = result.deliveries.filter(d => d.status === "error");
      if (failures.length) setError(failures.map(d => d.error).join("\n"));
      else { setText(""); setReply(null); retry.current = null; setTargets([]); }
      load();
    } catch (e) { setError(message(e)); }
    finally { setPending(false); }
  };
  if (!page) return <PageColumn><ErrorMessage error={error} /><p role="status">Loading view…</p></PageColumn>;
  const botFor = (threadId: string) => bots.find(b => b.id === page.threads.find(t => t.id === threadId)?.botId);
  const roots = new Set(page.threads.filter(t => !t.parentThreadId).map(t => t.id));
  const renderEntry = (entry: ViewEntry) => {
    const bot = botFor(entry.threadId), thread = page.threads.find(t => t.id === entry.threadId);
    return <li key={entry.id} className="py-4" data-view-entry={entry.role}>
      <div className="mb-1 flex min-w-0 items-center gap-2 text-sm"><ItemTile icon={entry.role === "user" ? null : bot?.avatar || null} kindIcon={entry.role === "user" ? "UserRound" : "Bot"} size="sm" /><button type="button" className="min-w-0 truncate font-medium hover:underline" onClick={() => navigate.toThread(entry.threadId)}>{entry.role === "user" ? "You" : bot?.name || thread?.title || "Thread"}</button><time className="ml-auto shrink-0 text-xs text-muted-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(entry.createdAt)}</time><button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { setReply(entry.threadId); setTargets([]); }}>Reply</button></div>
      <div className="min-w-0 break-words pl-8"><Markdown content={entry.text} /></div>
    </li>;
  };
  const children = (parentId: string): React.ReactNode => page.threads.filter(t => t.parentThreadId === parentId).map(t => <li key={t.id}><details open={expanded.has(t.id)} onToggle={event => { const open = event.currentTarget.open; setExpanded(current => { const next = new Set(current); if(open) next.add(t.id); else next.delete(t.id); return next; }); }} className="ml-8 border-l border-border pl-3 py-2"><summary className="cursor-pointer text-sm text-muted-foreground">{t.title}{["active", "starting"].includes(t.status) ? " · Working…" : ""}</summary><ol>{page.entries.filter(e => e.threadId === t.id).map(renderEntry)}{children(t.id)}</ol></details></li>);
  const rootEntries = page.entries.filter(e => roots.has(e.threadId));
  const lastEntry = new Map(rootEntries.map(e=>[e.threadId,e.id]));
  const archive = async () => { try { await rpc.call("viewUpdate", { ...page.view, archived: !page.view.archived, expectedUpdatedAt: page.view.updatedAt }); load(); } catch(e) { setError(message(e)); } };
  return <div className="relative flex h-full min-h-0 flex-col" data-thread-view>
    <ItemHeader className="relative shrink-0 bg-background view-controls" backLabel={studio ? "Studio" : "Views"} onBack={() => studio ? openAppPath(studioPath(VIEW_KIND.id)) : navigate.toPluginPanel("views")} leading={<span className="min-w-0 truncate text-sm font-medium">{page.view.name}</span>} trailing={<><Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit view</Button><Button variant="ghost" size="sm" onClick={() => void archive()}>{page.view.archived ? "Restore" : "Archive"}</Button></>} />
    <div data-view-timeline ref={timeline} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="min-h-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-6 md:px-10"><h1 className="mb-4 text-2xl font-semibold">{page.view.name}</h1>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{page.threads.filter(t => !t.parentThreadId).map(t => <button type="button" key={t.id} onClick={() => navigate.toThread(t.id)} className="max-w-64 truncate text-muted-foreground hover:underline">{botFor(t.id)?.name || t.title}{["starting", "active"].includes(t.status) ? " · Working…" : ""}{t.error ? " · Unavailable" : ""}</button>)}</div>
      {page.hasOlder && <Button variant="ghost" size="sm" onClick={() => void rpc.call("view", { id, before: page.entries[0]?.createdAt, beforeId: page.entries[0]?.id }).then(older => setPage(current => current ? { ...current, entries: [...older.entries, ...current.entries], hasOlder: older.hasOlder } : older), e => setError(message(e)))}>Earlier replies</Button>}
      {!page.entries.length && <p className="py-12 text-center text-sm text-muted-foreground">Send a message to start work in this view.</p>}
      <ol className="divide-y divide-border">{rootEntries.map(entry => <li key={entry.id}><ol>{renderEntry(entry)}{lastEntry.get(entry.threadId) === entry.id ? children(entry.threadId) : null}</ol></li>)}{page.threads.filter(t => roots.has(t.id) && !lastEntry.has(t.id)).flatMap(t=>children(t.id))}</ol>

    </div></div>
    <form className="mx-auto w-full max-w-5xl shrink-0 space-y-2 border-t border-border px-4 py-3" onSubmit={e => { e.preventDefault(); void send(); }}>
      {reply && <div className="flex items-center gap-2 text-sm">Replying to {botFor(reply)?.name || page.threads.find(t => t.id === reply)?.title}<button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>×</button></div>}
      <div className="flex flex-wrap items-center gap-3 text-sm" role="group" aria-label="Recipients">{page.view.members.map(m => { const label = m.kind === "bot" ? bots.find(b => b.id === m.id)?.name : page.threads.find(t => t.id === m.id)?.title; return <label key={memberKey(m)} className="flex min-w-0 items-center gap-1.5"><input type="checkbox" checked={targets.some(t => memberKey(t) === memberKey(m))} onChange={() => setTargets(current => current.some(t => memberKey(t) === memberKey(m)) ? current.filter(t => memberKey(t) !== memberKey(m)) : [...current, m])} /><span className="max-w-40 truncate">{label || "Member"}</span></label>; })}<label className="ml-auto flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} />New bot threads</label></div>
      <label className="sr-only" htmlFor="view-message">Message to view</label><textarea id="view-message" className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" value={text} onChange={e => setText(e.target.value)} placeholder="Message or @mention members…" disabled={page.view.archived} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><ErrorMessage error={error} /></div><Button type="submit" disabled={pending || !text.trim() || page.view.archived}>{pending ? "Sending…" : retry.current && error ? "Retry send" : "Send"}</Button></div>
    </form><ViewEditor key={page.view.updatedAt} initial={page.view} open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
  </div>;
}
export function ViewsPage({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const id = subPath.split("/")[0];
  if (id && id !== "new") return <ViewDetail key={id} id={id} />;
  if (id === "new") return <ViewEditor open onClose={() => navigate.toPluginPanel("views")} onSaved={v => navigate.toPluginPanel("views", { subPath: v.id })} />;
  return <ViewCollection />;
}
function ViewCollection() {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call(method, input as never) as never, [rpc]);
  const [version, setVersion] = useState(0);
  useRealtime("views-changed", () => setVersion(value => value + 1));
  return <AddOnCollection pluginId={PLUGIN_ID} title="Views" kind={VIEW_KIND.id} call={call} refreshKey={version} />;
}
export function FormerChannelRedirect({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<Contract>(), navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = subPath.split("/")[0];
    if (!id) { navigate.toPluginPanel("views", { replace: true }); return; }
    let active = true;
    void rpc.call("view", { id }).then(page => {
      if (!active) return;
      if (page.view.members.length === 1 && page.threads[0]) navigate.toThread(page.threads[0].id);
      else navigate.toPluginPanel("views", { subPath: id, replace: true });
    }, e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [subPath, rpc, navigate]);
  return <PageColumn><ErrorMessage error={error} /><p role="status">Opening view…</p></PageColumn>;
}
