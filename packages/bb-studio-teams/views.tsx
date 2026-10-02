import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { experimental_NewThreadComposer as NewThreadComposer, Markdown, useBbNavigate, useRealtime, useRpc, useSdk, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon, ItemTile, PageColumn, AddOnCollection, type ProviderCall } from "@bb-studio/kit/app";
import { toast } from "sonner";
import { Button, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, Input } from "@bb-studio/kit/ui";
import { Modal } from "./channel-controls";
import { ErrorMessage, message } from "./bot-ui";
import { PLUGIN_ID, VIEW_KIND } from "./studio-provider";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import type { Bot } from "./contract";
import type { rpcContract } from "./client-contract";
import type { ThreadView, ViewAttachment, ViewEntry, ViewMember, ViewPermissionMode, ViewThread } from "./view-contract";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

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
  // Members picked when the dialog opened stay on top, so rows don't jump while toggling.
  const [pinned] = useState(() => new Set((initial?.members ?? []).map(memberKey)));
  const isMember = (m: ViewMember) => members.some(v => memberKey(v) === memberKey(m));
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const ordered = <T extends { member: ViewMember }>(rows: T[]) => [...rows].sort((x, y) => Number(pinned.has(memberKey(y.member))) - Number(pinned.has(memberKey(x.member))));
  const sections = [
    { label: "Bots", rows: ordered(bots.filter(b => !b.retired || pinned.has(`bot:${b.id}`)).map(b => ({ member: { kind: "bot" as const, id: b.id }, label: b.name, detail: `@${b.handle}`, icon: b.avatar || null, kindIcon: "Bot" })).filter(c => matches(`${c.label} ${c.detail}`))) },
    { label: "Threads", rows: ordered(threads.map(t => ({ member: { kind: "thread" as const, id: t.id }, label: t.title, detail: "", icon: null, kindIcon: "MessageSquare" })).filter(c => matches(c.label))) },
  ].filter(section => section.rows.length);
  const save = async () => {
    setPending(true); setError(null);
    try { onSaved(initial ? await rpc.call("viewUpdate", { ...initial, name, members, expectedUpdatedAt: initial.updatedAt }) : await rpc.call("viewCreate", { name, members, requestId: requestId.current })); }
    catch (e) { setError(message(e)); } finally { setPending(false); }
  };
  return <Modal title={initial ? "Edit view" : "New view"} open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Name</span><Input aria-label="View name" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Command Center" autoFocus /></label>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between"><span className="text-xs font-medium text-muted-foreground">Members</span><span className={`text-xs ${members.length > 32 ? "text-destructive" : "text-subtle-foreground"}`}>{members.length > 32 ? `${members.length} of 32 allowed` : `${members.length} selected`}</span></div>
        <div className="relative"><Icon name="Search" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" /><Input aria-label="Find bots and threads" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find bots and threads" className="pl-8" /></div>
        <div className="-mx-1 max-h-72 overflow-auto px-1" role="group" aria-label="View members">
          {sections.map(section => <section key={section.label} aria-label={section.label} className="pt-2 first:pt-1">
            <h3 className="px-2 pb-1 text-[11px] font-medium tracking-wide text-subtle-foreground uppercase">{section.label}</h3>
            {section.rows.map(c => <label key={memberKey(c.member)} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-state-hover"><Checkbox checked={isMember(c.member)} onCheckedChange={() => toggle(c.member)} aria-label={c.label} /><ItemTile icon={c.icon} kindIcon={c.kindIcon} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>{c.detail && <span className="max-w-40 shrink-0 truncate text-xs text-subtle-foreground">{c.detail}</span>}</label>)}
          </section>)}
          {!sections.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{bots.length || threads.length ? `Nothing matches "${query.trim()}".` : "Loading bots and threads…"}</p>}
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2 border-t border-border pt-3"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !name.trim() || members.length > 32}>{pending ? "Saving…" : initial ? "Save view" : "Create view"}</Button></div>
    </form>
  </Modal>;
}
const ROW_BUTTON = "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active";
const ROW_ICON_BUTTON = "inline-flex h-6 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";
const EDIT_VIEW_EVENT = "bot-teams:edit-view";
/** A thread's per-message hover actions. */
const MESSAGE_ACTION = "inline-flex size-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100 group-focus-within/message:opacity-100 max-md:pointer-coarse:opacity-100";
/** BB's own approval-mode names, plus leaving each thread as it is. */
const MODE_CHOICES: { id: ViewPermissionMode | undefined; label: string; detail: string }[] = [
  { id: undefined, label: "Each bot's own", detail: "Every thread keeps the approval mode it already has." },
  { id: "accept-edits", label: "Accept Edits", detail: "Applies edits inside the workspace automatically. Anything beyond it asks you first." },
  { id: "auto", label: "Approve for me", detail: "Same workspace sandbox, with requests reviewed automatically." },
  { id: "full", label: "Full Access", detail: "No sandbox and no approvals. The agent can run anything on your machine." },
];
const modeLabel = (mode: ViewPermissionMode) => MODE_CHOICES.find(c => c.id === mode)!.label;
type Permissions = { all?: ViewPermissionMode; members: Record<string, ViewPermissionMode> };
/** Approval choices are a per-view preference on this device, like a thread's composer picks. */
function useStoredPermissions(id: string) {
  const key = `bot-teams:view-permissions:${id}`;
  const [value, setValue] = useState<Permissions>(() => { try { return { members: {}, ...JSON.parse(localStorage.getItem(key) ?? "{}") }; } catch { return { members: {} }; } });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
/** The view's title bar: its name and menu where a thread's title sits, members on the right. */
export function ViewHeader({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<Contract>();
  const id = subPath.split("/")[0];
  const [views, setViews] = useState<ThreadView[]>([]), [bots, setBots] = useState<Bot[]>([]);
  const load = useCallback(() => { void rpc.call("views", {}).then(setViews, () => undefined); void rpc.call("profiles", {}).then(setBots, () => undefined); }, [rpc]);
  useEffect(load, [load]);
  useRealtime("views-changed", load);
  const view = views.find(v => v.id === id);
  if (!view) return null;
  const edit = () => window.dispatchEvent(new CustomEvent(EDIT_VIEW_EVENT, { detail: { id } }));
  const archive = () => void rpc.call("viewUpdate", { ...view, archived: !view.archived, expectedUpdatedAt: view.updatedAt }).then(load, e => toast.error(message(e)));
  return <div data-view-header className="flex min-w-0 flex-1 items-center gap-2">
    <p className="min-w-0 truncate text-sm font-semibold">{view.name}</p>
    {view.archived && <span className="shrink-0 rounded bg-foreground/[0.08] px-1.5 text-[11px] text-muted-foreground">Archived</span>}
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="View options" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"><Icon name="MoreHorizontal" className="size-4" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onSelect={edit}><Icon name="Edit" />Edit view</DropdownMenuItem>
        <DropdownMenuItem onSelect={archive}><Icon name="Archive" />{view.archived ? "Restore" : "Archive"}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    <button type="button" aria-label="Edit view" title="Members" onClick={edit} className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground">
      <span className="flex -space-x-1.5">{view.members.slice(0, 4).map(m => <span key={memberKey(m)} className="rounded-lg bg-background ring-2 ring-background"><ItemTile icon={m.kind === "bot" ? bots.find(b => b.id === m.id)?.avatar || null : null} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /></span>)}</span>
      <span className="max-sm:sr-only">{view.members.length || "Add"} {view.members.length === 1 ? "member" : "members"}</span>
    </button>
  </div>;
}
function ViewDetail({ id }: { id: string }) {
  const rpc = useRpc<Contract>(), navigate = useBbNavigate();
  const [page, setPage] = useState<Page | null>(null), [bots, setBots] = useState<Bot[]>([]), [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<ViewMember[]>([]), [reply, setReply] = useState<string | null>(null);
  const [editing, setEditing] = useState(false), [fresh, setFresh] = useState(false), [focus, setFocus] = useState(0);
  const [permissions, setPermissions] = useStoredPermissions(id);
  useEffect(() => {
    const edit = (event: Event) => { if ((event as CustomEvent<{ id?: string }>).detail?.id === id) setEditing(true); };
    window.addEventListener(EDIT_VIEW_EVENT, edit);
    return () => window.removeEventListener(EDIT_VIEW_EVENT, edit);
  }, [id]);
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
  /** BB's composer submits rich input: bot mentions become recipients and files ride along. Throwing keeps the draft. */
  const send = async (request: NewThreadRequest) => {
    if (!page) return;
    setError(null);
    const attachments = request.input.filter((part): part is ViewAttachment => part.type !== "text");
    const mentioned: ViewMember[] = [];
    const text = request.input.flatMap(part => {
      if (part.type !== "text") return [];
      let out = part.text;
      for (const m of [...(part.mentions ?? [])].sort((x, y) => y.start - x.start)) {
        const r = m.resource, label = r.label.replace(/^@/, "");
        const bot = r.kind === "plugin" && r.pluginId === PLUGIN_ID ? bots.find(b => b.id === r.itemId.replace(/^bots:/, "")) : undefined;
        if (bot && page.view.members.some(v => v.kind === "bot" && v.id === bot.id)) mentioned.push({ kind: "bot", id: bot.id });
        if (r.kind === "thread" && page.threads.some(t => t.id === r.threadId)) mentioned.push({ kind: "thread", id: r.threadId });
        out = out.slice(0, m.start) + (bot ? `@${bot.handle}` : r.kind === "thread" ? `${label} (thread ${r.threadId})` : label) + out.slice(m.end);
      }
      return [out];
    }).join("\n").trim();
    const command = /^\/(steer|followup|fork)\s+/.exec(text);
    const recipients = [...new Map([...targets, ...mentioned].map(m => [memberKey(m), m])).values()];
    const input = { id, text: command ? text.slice(command[0].length) : text, attachments, targets: recipients, replyThreadId: reply, fresh, mode: (command?.[1] ?? "auto") as "auto" | "steer" | "followup" | "fork", permissionMode: permissions.all ?? null, memberPermissionModes: page.view.members.flatMap(member => permissions.members[memberKey(member)] ? [{ member, mode: permissions.members[memberKey(member)]! }] : []) };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    let failure: string | null = null;
    try {
      const result = await rpc.call("viewSend", { ...input, requestId: retry.current!.requestId });
      const failures = result.deliveries.filter(d => d.status === "error");
      if (failures.length) failure = failures.map(d => d.error).join("\n");
      else { setReply(null); retry.current = null; setTargets([]); followLatest.current = true; }
      load();
    } catch (e) { failure = message(e); }
    if (failure) { setError(failure); throw new Error(failure); }
  };
  if (!page) return <PageColumn><ErrorMessage error={error} /><p role="status">Loading view…</p></PageColumn>;
  const botFor = (threadId: string) => bots.find(b => b.id === page.threads.find(t => t.id === threadId)?.botId);
  const roots = new Set(page.threads.filter(t => !t.parentThreadId).map(t => t.id));
  const time = (at: number) => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(at);
  const renderEntry = (entry: ViewEntry, previous?: ViewEntry) => {
    const bot = botFor(entry.threadId), thread = page.threads.find(t => t.id === entry.threadId);
    const replying = reply === entry.threadId && entry.role === "assistant";
    const action = (label: string, icon: string, run: () => void) => <button type="button" aria-label={label} title={label} onClick={run} className={MESSAGE_ACTION}><Icon name={icon} className="size-3.5" /></button>;
    const actions = <div className={`flex h-5 items-center gap-2 ${entry.role === "user" ? "justify-end pr-[13px]" : ""}`}>
      {action("Copy message", "Copy", () => void navigator.clipboard.writeText(entry.text).then(() => toast.success("Copied"), e => toast.error(message(e))))}
      {action(`Reply to ${entry.role === "user" ? thread?.title || "thread" : bot?.name || thread?.title || "thread"}`, "ArrowTurnBackward", () => { setReply(entry.threadId); setTargets([]); setFocus(value => value + 1); })}
      {entry.role === "assistant" && action("Open thread", "ArrowUpRight", () => navigate.toThread(entry.threadId))}
    </div>;
    if (entry.role === "user") return <li key={entry.id} data-view-entry="user" className="group/message ml-auto flex w-fit max-w-[70%] flex-col items-end gap-1">
      <time className="text-xs text-subtle-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time>
      <div className="max-w-full break-words rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5 text-sm leading-relaxed text-foreground"><Markdown content={entry.text} /></div>
      {actions}
    </li>;
    const continued = previous?.role === "assistant" && previous.threadId === entry.threadId && entry.createdAt - previous.createdAt < 5 * 60_000;
    return <li key={entry.id} data-view-entry="assistant" data-replying={replying || undefined} className={`group/message rounded-lg px-2 transition-colors data-[replying]:bg-foreground/[0.04] data-[replying]:py-2 ${continued ? "-mt-4" : ""}`}>
      {!continued && <div className="mb-1.5 flex min-w-0 items-center gap-2 text-sm"><ItemTile icon={bot?.avatar || null} kindIcon="Bot" size="sm" /><button type="button" className="min-w-0 truncate font-medium hover:underline" onClick={() => navigate.toThread(entry.threadId)}>{bot?.name || thread?.title || "Thread"}</button><time className="shrink-0 text-xs text-subtle-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time>{replying && <span className="text-xs text-subtle-foreground">· Replying</span>}</div>}
      <div className="min-w-0 break-words text-sm leading-relaxed"><Markdown content={entry.text} /></div>
      <div className="mt-1">{actions}</div>
    </li>;
  };
  const children = (parentId: string): React.ReactNode => page.threads.filter(t => t.parentThreadId === parentId).map(t => <li key={t.id} className="px-2"><details open={expanded.has(t.id)} onToggle={event => { const open = event.currentTarget.open; setExpanded(current => { const next = new Set(current); if(open) next.add(t.id); else next.delete(t.id); return next; }); }} className="ml-8 border-l border-border pl-4"><summary className="cursor-pointer text-xs text-subtle-foreground hover:text-foreground">{t.title}{["active", "starting"].includes(t.status) ? " · Working…" : ""}</summary><ol className="mt-3 space-y-5">{page.entries.filter(e => e.threadId === t.id).map((e, i, all) => renderEntry(e, all[i - 1]))}{children(t.id)}</ol></details></li>);
  const rootEntries = page.entries.filter(e => roots.has(e.threadId));
  const lastEntry = new Map(rootEntries.map(e=>[e.threadId,e.id]));
  const isTarget = (m: ViewMember) => targets.some(t => memberKey(t) === memberKey(m));
  const memberLabel = (m: ViewMember) => (m.kind === "bot" ? bots.find(b => b.id === m.id)?.name : page.threads.find(t => t.id === m.id)?.title) || "Member";
  const memberAvatar = (m: ViewMember) => m.kind === "bot" ? bots.find(b => b.id === m.id)?.avatar || null : null;
  const toggleTarget = (m: ViewMember) => setTargets(current => isTarget(m) ? current.filter(t => memberKey(t) !== memberKey(m)) : [...current, m]);
  const chosen = page.view.members.filter(isTarget);
  const working = page.threads.filter(t => !t.parentThreadId && ["starting", "active"].includes(t.status)).map(t => botFor(t.id)?.name || t.title);
  const overrides = page.view.members.filter(m => permissions.members[memberKey(m)]);
  const approvals = { label: `${permissions.all ? modeLabel(permissions.all) : "Each bot's own"}${overrides.length ? ` · ${overrides.length} custom` : ""}`, anyFull: permissions.all === "full" || overrides.some(m => permissions.members[memberKey(m)] === "full") };
  const approvalTitle = `Approval mode: ${permissions.all ? modeLabel(permissions.all) : "each thread keeps its own"}${overrides.map(m => `\n${memberLabel(m)}: ${modeLabel(permissions.members[memberKey(m)]!)}`).join("")}`;
  const avatars = (members: ViewMember[]) => <span className="flex -space-x-1.5">{members.slice(0, 4).map(m => <span key={memberKey(m)} className="rounded-lg bg-background ring-2 ring-background"><ItemTile icon={memberAvatar(m)} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /></span>)}</span>;
  return <div className="relative flex h-full min-h-0 flex-col" data-thread-view>
    <div data-view-timeline ref={timeline} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="min-h-0 flex-1 overflow-auto"><div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 pt-6 pb-8">
      {page.hasOlder && <Button className="mb-4 self-center" variant="ghost" size="sm" onClick={() => void rpc.call("view", { id, before: page.entries[0]?.createdAt, beforeId: page.entries[0]?.id }).then(older => setPage(current => current ? { ...current, entries: [...older.entries, ...current.entries], hasOlder: older.hasOlder } : older), e => setError(message(e)))}>Earlier replies</Button>}
      {!page.entries.length && <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
        {page.view.members.length ? <div className="mb-4 scale-125">{avatars(page.view.members)}</div> : null}
        <p className="text-sm font-medium">{page.view.name}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{page.view.members.length ? `Message ${page.view.members.map(memberLabel).slice(0, 3).join(", ")}${page.view.members.length > 3 ? ` and ${page.view.members.length - 3} more` : ""} together. Their replies land here.` : "Add bots or threads to this view, then message them together."}</p>
      </div>}
      <ol className="flex flex-col gap-5">{rootEntries.map((entry, i) => <React.Fragment key={entry.id}>{renderEntry(entry, rootEntries[i - 1])}{lastEntry.get(entry.threadId) === entry.id ? children(entry.threadId) : null}</React.Fragment>)}{page.threads.filter(t => roots.has(t.id) && !lastEntry.has(t.id)).flatMap(t=>children(t.id))}</ol>
      {working.length > 0 && <p className="mt-6 px-2 text-sm text-subtle-foreground" role="status"><span className="animate-pulse motion-reduce:animate-none">{working.join(", ")} {working.length === 1 ? "is" : "are"} working…</span></p>}
    </div></div>
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
    {page.view.archived ? <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">This view is archived. Restore it from the ··· menu to send messages.</p>
      : <div data-view-composer><NewThreadComposer layout="contained" className="view-composer" placeholder={`Message ${page.view.name}. @ to mention members.`} draftKey={`bot-teams:view:${id}`} focusRequest={focus} onSubmit={send} /></div>}
    <div className="mt-1 flex min-h-6 select-none items-center justify-between gap-2 pl-[15px] pr-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Choose recipients" className={`${ROW_BUTTON} -ml-1.5`}><Icon name="Bot" className="size-3.5 shrink-0" />{chosen.length ? <span className="truncate text-foreground">{chosen.map(memberLabel).join(", ")}</span> : <span className="truncate">{reply ? `Reply to ${botFor(reply)?.name || page.threads.find(t => t.id === reply)?.title || "thread"}` : "Auto recipients"}</span>}{fresh && <span className="shrink-0 text-subtle-foreground">· new threads</span>}<Icon name="ChevronDown" className="size-3 shrink-0" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Send to. Leave empty to route by @mention.</DropdownMenuLabel>
            <div role="group" aria-label="Recipients">{page.view.members.map(m => <DropdownMenuItem key={memberKey(m)} onSelect={e => { e.preventDefault(); toggleTarget(m); }} role="menuitemcheckbox" aria-checked={isTarget(m)}><ItemTile icon={memberAvatar(m)} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{memberLabel(m)}</span>{isTarget(m) && <Icon name="Check" className="size-4" />}</DropdownMenuItem>)}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={e => { e.preventDefault(); setFresh(value => !value); }} role="menuitemcheckbox" aria-checked={fresh}><Icon name="MessageSquarePlus" className="size-4" /><span className="flex-1 text-sm">New bot threads</span>{fresh && <Icon name="Check" className="size-4" />}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        {reply && <button type="button" aria-label="Cancel reply" title="Cancel reply" className={ROW_ICON_BUTTON} onClick={() => setReply(null)}><Icon name="X" className="size-3.5" /></button>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Approval mode" title={approvalTitle} className={`inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium leading-tight transition-colors hover:bg-state-hover data-[state=open]:bg-state-active ${approvals.anyFull ? "text-warning-text" : "text-muted-foreground hover:text-foreground"}`}><span className="truncate">{approvals.label}</span><Icon name="ChevronDown" className="size-3 shrink-0" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-72">
            <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Approvals for everyone</DropdownMenuLabel>
            {MODE_CHOICES.map(choice => <DropdownMenuItem key={choice.id ?? "own"} onSelect={() => setPermissions(current => ({ ...current, all: choice.id }))} className="items-start"><span className="min-w-0 flex-1"><span className={`block text-sm ${choice.id === "full" ? "text-warning-text" : ""}`}>{choice.label}</span><span className="block text-xs text-subtle-foreground">{choice.detail}</span></span>{permissions.all === choice.id && <Icon name="Check" className="mt-0.5 size-4" />}</DropdownMenuItem>)}
            {page.view.members.length > 1 && <><DropdownMenuSeparator /><DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Per member</DropdownMenuLabel>
              {page.view.members.map(m => { const own = permissions.members[memberKey(m)]; return <DropdownMenuSub key={memberKey(m)}><DropdownMenuSubTrigger><ItemTile icon={memberAvatar(m)} kindIcon={m.kind === "bot" ? "Bot" : "MessageSquare"} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{memberLabel(m)}</span><span className={`shrink-0 text-xs ${own === "full" ? "text-warning-text" : "text-subtle-foreground"}`}>{own ? modeLabel(own) : "Same"}</span></DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">{[{ id: undefined, label: "Same as everyone" }, ...MODE_CHOICES.filter(c => c.id)].map(choice => <DropdownMenuItem key={choice.id ?? "same"} onSelect={() => setPermissions(current => { const members = { ...current.members }; if (choice.id) members[memberKey(m)] = choice.id; else delete members[memberKey(m)]; return { ...current, members }; })}><span className={`flex-1 text-sm ${choice.id === "full" ? "text-warning-text" : ""}`}>{choice.label}</span>{own === choice.id && <Icon name="Check" className="size-4" />}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>; })}</>}
          </DropdownMenuContent></DropdownMenu>
      </div>
    </div>
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
