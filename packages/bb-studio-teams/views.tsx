import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown, useBbNavigate, useRealtime, useRpc, useSdk, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon, ItemHeader, ItemTile, PageColumn, AddOnCollection, openAppPath, studioPath, useStudioPresent, type ProviderCall } from "@bb-studio/kit/app";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Input } from "@bb-studio/kit/ui";
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
  const time = (at: number) => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(at);
  const renderEntry = (entry: ViewEntry, previous?: ViewEntry) => {
    const bot = botFor(entry.threadId), thread = page.threads.find(t => t.id === entry.threadId);
    const replyButton = <button type="button" className="text-xs text-subtle-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100" onClick={() => { setReply(entry.threadId); setTargets([]); }}>Reply</button>;
    if (entry.role === "user") return <li key={entry.id} data-view-entry="user" className="group/message ml-auto flex w-fit max-w-[70%] flex-col items-end gap-1">
      <div className="flex items-center gap-2 text-xs text-subtle-foreground">{replyButton}<time dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time></div>
      <div className="max-w-full break-words rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5 text-sm leading-relaxed text-foreground"><Markdown content={entry.text} /></div>
    </li>;
    const continued = previous?.role === "assistant" && previous.threadId === entry.threadId && entry.createdAt - previous.createdAt < 5 * 60_000;
    return <li key={entry.id} data-view-entry="assistant" className={`group/message px-2 ${continued ? "-mt-3" : ""}`}>
      {!continued && <div className="mb-1.5 flex min-w-0 items-center gap-2 text-sm"><ItemTile icon={bot?.avatar || null} kindIcon="Bot" size="sm" /><button type="button" className="min-w-0 truncate font-medium hover:underline" onClick={() => navigate.toThread(entry.threadId)}>{bot?.name || thread?.title || "Thread"}</button><time className="shrink-0 text-xs text-subtle-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time>{replyButton}</div>}
      <div className="min-w-0 break-words text-sm leading-relaxed">{continued && <div className="float-right ml-2">{replyButton}</div>}<Markdown content={entry.text} /></div>
    </li>;
  };
  const children = (parentId: string): React.ReactNode => page.threads.filter(t => t.parentThreadId === parentId).map(t => <li key={t.id} className="px-2"><details open={expanded.has(t.id)} onToggle={event => { const open = event.currentTarget.open; setExpanded(current => { const next = new Set(current); if(open) next.add(t.id); else next.delete(t.id); return next; }); }} className="ml-8 border-l border-border pl-4"><summary className="cursor-pointer text-xs text-subtle-foreground hover:text-foreground">{t.title}{["active", "starting"].includes(t.status) ? " · Working…" : ""}</summary><ol className="mt-3 space-y-5">{page.entries.filter(e => e.threadId === t.id).map((e, i, all) => renderEntry(e, all[i - 1]))}{children(t.id)}</ol></details></li>);
  const rootEntries = page.entries.filter(e => roots.has(e.threadId));
  const lastEntry = new Map(rootEntries.map(e=>[e.threadId,e.id]));
  const archive = async () => { try { await rpc.call("viewUpdate", { ...page.view, archived: !page.view.archived, expectedUpdatedAt: page.view.updatedAt }); load(); } catch(e) { setError(message(e)); } };
  const isTarget = (m: ViewMember) => targets.some(t => memberKey(t) === memberKey(m));
  const memberLabel = (m: ViewMember) => (m.kind === "bot" ? bots.find(b => b.id === m.id)?.name : page.threads.find(t => t.id === m.id)?.title) || "Member";
  const memberAvatar = (m: ViewMember) => m.kind === "bot" ? bots.find(b => b.id === m.id)?.avatar || null : null;
  const toggleTarget = (m: ViewMember) => setTargets(current => isTarget(m) ? current.filter(t => memberKey(t) !== memberKey(m)) : [...current, m]);
  const chosen = page.view.members.filter(isTarget);
  const working = page.threads.filter(t => !t.parentThreadId && ["starting", "active"].includes(t.status)).map(t => botFor(t.id)?.name || t.title);
  const avatars = (members: ViewMember[]) => <span className="flex -space-x-1.5">{members.slice(0, 4).map(m => <span key={memberKey(m)} className="rounded-lg bg-background ring-2 ring-background"><ItemTile icon={memberAvatar(m)} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /></span>)}</span>;
  return <div className="relative flex h-full min-h-0 flex-col" data-thread-view>
    <ItemHeader className="relative shrink-0 bg-background view-controls" backLabel={studio ? "Studio" : "Views"} onBack={() => studio ? openAppPath(studioPath(VIEW_KIND.id)) : navigate.toPluginPanel("views")} leading={<span className="min-w-0 truncate text-sm font-medium">{page.view.name}</span>} trailing={<><button type="button" aria-label="Edit view" title="Edit view" onClick={() => setEditing(true)} className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground">{page.view.members.length ? avatars(page.view.members) : <Icon name="Plus" className="size-4" />}<span className="max-sm:sr-only">{page.view.members.length || "Add"} {page.view.members.length === 1 ? "member" : "members"}</span></button><Button variant="ghost" size="sm" onClick={() => void archive()}>{page.view.archived ? "Restore" : "Archive"}</Button></>} />
    <div data-view-timeline ref={timeline} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="min-h-0 flex-1 overflow-auto"><div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 pt-6 pb-8">
      {page.hasOlder && <Button className="mb-4 self-center" variant="ghost" size="sm" onClick={() => void rpc.call("view", { id, before: page.entries[0]?.createdAt, beforeId: page.entries[0]?.id }).then(older => setPage(current => current ? { ...current, entries: [...older.entries, ...current.entries], hasOlder: older.hasOlder } : older), e => setError(message(e)))}>Earlier replies</Button>}
      {!page.entries.length && <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
        {page.view.members.length ? <div className="mb-4 scale-125">{avatars(page.view.members)}</div> : null}
        <p className="text-sm font-medium">{page.view.name}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{page.view.members.length ? `Message ${page.view.members.map(memberLabel).slice(0, 3).join(", ")}${page.view.members.length > 3 ? ` and ${page.view.members.length - 3} more` : ""} together. Their replies land here.` : "Add bots or threads to this view, then message them together."}</p>
      </div>}
      <ol className="flex flex-col gap-6">{rootEntries.map((entry, i) => <React.Fragment key={entry.id}>{renderEntry(entry, rootEntries[i - 1])}{lastEntry.get(entry.threadId) === entry.id ? children(entry.threadId) : null}</React.Fragment>)}{page.threads.filter(t => roots.has(t.id) && !lastEntry.has(t.id)).flatMap(t=>children(t.id))}</ol>
      {working.length > 0 && <p className="mt-6 px-2 text-sm text-subtle-foreground" role="status"><span className="animate-pulse motion-reduce:animate-none">{working.join(", ")} {working.length === 1 ? "is" : "are"} working…</span></p>}
    </div></div>
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
    <form className="relative w-full rounded-xl border border-border bg-background shadow-lift" onSubmit={e => { e.preventDefault(); void send(); }}>
      {reply && <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"><Icon name="Reply" className="size-3.5" /><span className="min-w-0 truncate">Replying to <span className="text-foreground">{botFor(reply)?.name || page.threads.find(t => t.id === reply)?.title}</span></span><button type="button" aria-label="Cancel reply" className="ml-auto rounded p-0.5 hover:bg-state-hover hover:text-foreground" onClick={() => setReply(null)}><Icon name="X" className="size-3.5" /></button></div>}
      <label className="sr-only" htmlFor="view-message">Message to view</label><textarea id="view-message" className="block max-h-[calc(50dvh-3rem)] min-h-[68px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed outline-none [field-sizing:content] placeholder:text-subtle-foreground disabled:cursor-not-allowed max-md:pointer-coarse:text-base" value={text} onChange={e => setText(e.target.value)} placeholder={page.view.archived ? "This view is archived." : `Message ${page.view.name}. @ to mention members.`} disabled={page.view.archived} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="flex items-center gap-1 px-2 pb-2">
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Choose recipients" className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"><span className="text-subtle-foreground">To</span>{chosen.length ? <><span className="max-sm:hidden">{avatars(chosen)}</span><span className="min-w-0 truncate text-foreground">{chosen.map(memberLabel).join(", ")}</span></> : <span className="text-foreground">{reply ? "Reply thread" : "Auto"}</span>}{fresh && <span className="rounded bg-foreground/[0.08] px-1 text-[11px]">New threads</span>}<Icon name="ChevronDown" className="size-3.5 shrink-0" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Leave empty to route by @mention</DropdownMenuLabel>
            <div role="group" aria-label="Recipients">{page.view.members.map(m => <DropdownMenuItem key={memberKey(m)} onSelect={e => { e.preventDefault(); toggleTarget(m); }} role="menuitemcheckbox" aria-checked={isTarget(m)}><ItemTile icon={memberAvatar(m)} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{memberLabel(m)}</span>{isTarget(m) && <Icon name="Check" className="size-4" />}</DropdownMenuItem>)}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={e => { e.preventDefault(); setFresh(value => !value); }} role="menuitemcheckbox" aria-checked={fresh}><Icon name="SquarePen" className="size-4" /><span className="flex-1 text-sm">New bot threads</span>{fresh && <Icon name="Check" className="size-4" />}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        <div className="ml-auto flex shrink-0 items-center"><button type="submit" aria-label={retry.current && error ? "Retry send" : "Send"} title="Send (Enter)" disabled={pending || !text.trim() || page.view.archived} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-foreground px-2 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:pointer-events-none disabled:opacity-50 max-md:pointer-coarse:h-10 max-md:pointer-coarse:px-3">{pending ? "Sending…" : retry.current && error ? "Retry send" : <Icon name="CornerDownLeft" className="size-4" />}</button></div>
      </div>
    </form>
    {error && <div className="mt-2"><ErrorMessage error={error} /></div>}
    </div><ViewEditor key={page.view.updatedAt} initial={page.view} open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
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
