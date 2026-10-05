import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { experimental_NewThreadComposer as NewThreadComposer, experimental_useSidebarThreadActions, Markdown, useBbNavigate, useRealtime, useRpc, type NewThreadRequest, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { BarCrumb, BarSeparator, ICON_BUTTON, Icon, ItemTile, PageColumn, StudioBar, openCompanion } from "@bb-studio/kit/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@bb-studio/kit/ui";
import { errorMessage as message } from "@bb-studio/kit/format";
import "./styles.css";
const PLUGIN_ID = "studio";
import type { rpcContract } from "../contract";
import type { CommandAttachment, CommandEntry, CommandPermissionMode, CommandSpace } from "./command-contract";
import { broadcastMentionText, spaceThreadMentionId } from "./mentions";
import { CommandLayoutPicker, CommandThreads } from "./command-threads";
import { commandLayout, recipients, type CommandLayout } from "./command-layout";
import { handOffNewThreadSpace } from "../ui/ComposerSpaces";

type Contract = typeof rpcContract;
type Space = CommandSpace;
/** Matches the server's realtime topic in command.ts. */
const COMMAND_TOPIC = "command-changed";
const ROW_ICON_BUTTON = "inline-flex h-6 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";
/** BB's own approval-mode names, plus leaving each thread as it is. */
const MODE_CHOICES: { id: CommandPermissionMode | null; label: string; detail: string }[] = [
  { id: null, label: "Each thread’s own", detail: "Every thread keeps the approval mode it already has." },
  { id: "accept-edits", label: "Accept Edits", detail: "Applies edits inside the workspace automatically. Anything beyond it asks you first." },
  { id: "auto", label: "Approve for me", detail: "Same workspace sandbox, with requests reviewed automatically." },
  { id: "full", label: "Full Access", detail: "No sandbox and no approvals. The agent can run anything on your machine." },
];

/** BB's own New thread keys (⌘N, ⌘⇧O), which file the thread in this Space while Command is open. */
const isNewThreadKey = (event: KeyboardEvent) => (event.metaKey || event.ctrlKey) && !event.altKey && (event.key.toLowerCase() === "n" ? !event.shiftKey : event.key.toLowerCase() === "o" && event.shiftKey);

/** The last data each Space showed, so reopening the view draws at once while it refreshes. */
const lastSpace = new Map<string, Space>(), lastFeed = new Map<string, CommandEntry[]>();

function Placeholder({ rows }: { rows: number }) {
  return <div role="status" aria-label="Loading" className="flex flex-col gap-3 motion-safe:animate-pulse">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="flex flex-col gap-2 rounded-lg px-2"><div className="h-3.5 w-40 rounded bg-surface-recessed" /><div className="h-3 w-full rounded bg-surface-recessed" /><div className="h-3 w-2/3 rounded bg-surface-recessed" /></div>)}
  </div>;
}

/** A poll that changed nothing keeps the old object, so the panes and composer don't re-render. */
const same = (a: Space | null, b: Space) => !!a && JSON.stringify(a) === JSON.stringify(b);

/**
 * New thread in this Space. BB's thread actions hook re-renders on every
 * thread change, so it lives here rather than in the whole view.
 */
function NewThreadButton({ space }: { space: Space["space"] | null }) {
  const threadActions = experimental_useSidebarThreadActions();
  const latest = useRef({ space, threadActions });
  latest.current = { space, threadActions };
  const open = useCallback(() => {
    const { space, threadActions } = latest.current;
    if (!space) return;
    handOffNewThreadSpace(space.id, space.defaultProjectId);
    threadActions.openNewThread({ projectId: space.defaultProjectId ?? undefined, focusPrompt: true });
  }, []);
  useEffect(() => {
    // Capture runs before BB's own handler, so the key files the thread here instead.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || !latest.current.space || !isNewThreadKey(event) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return <button type="button" aria-label={`New thread in ${space?.name ?? "this Space"}`} aria-keyshortcuts="Meta+N" title="New thread in this Space (⌘N)" className={ICON_BUTTON} disabled={!space} onClick={open}><Icon name="Plus" className="size-4" aria-hidden /></button>;
}

function useStored<T extends string | null>(key: string, read: (value: string | null) => T) {
  const [value, setValue] = useState<T>(() => { try { return read(localStorage.getItem(key) ?? localStorage.getItem(key.replace("studio:", "bot-teams:"))); } catch { return read(null); } });
  useEffect(() => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); localStorage.removeItem(key.replace("studio:", "bot-teams:")); } catch {} }, [key, value]);
  return [value, setValue] as const;
}

function CommandView({ spaceId }: { spaceId: string }) {
  const rpc = useRpc<Contract>(), navigate = useBbNavigate();
  const openThread = (threadId: string) => { if (!openCompanion({ kind: "thread", threadId })) navigate.toThread(threadId); };
  const [space, setSpace] = useState<Space | null>(() => lastSpace.get(spaceId) ?? null), [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<CommandEntry[] | null>(() => lastFeed.get(spaceId) ?? null);
  const [layout, setLayout] = useStored<CommandLayout>(`studio:command-layout:${spaceId}`, commandLayout);
  const [permission, setPermission] = useStored<CommandPermissionMode | null>(`studio:command-permission:${spaceId}`, value => MODE_CHOICES.find(choice => choice.id === value)?.id ?? null);
  // The thread picked to reply to; Focus picks the thread it shows.
  const [reply, setReply] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const generation = useRef(0), feedGeneration = useRef(0);
  const load = useCallback(() => {
    const seq = ++generation.current;
    void rpc.call("command", { spaceId }).then(next => { if (seq === generation.current) { lastSpace.set(spaceId, next); setSpace(current => same(current, next) ? current : next); setError(null); } }, e => { if (seq === generation.current) setError(message(e)); });
  }, [rpc, spaceId]);
  const loadFeed = useCallback(() => {
    const seq = ++feedGeneration.current;
    void rpc.call("commandFeed", { spaceId }).then(next => { if (seq === feedGeneration.current) { lastFeed.set(spaceId, next.entries); setEntries(next.entries); } }, e => { if (seq === feedGeneration.current) setError(message(e)); });
  }, [rpc, spaceId]);
  useEffect(() => {
    load();
    // Refresh Space membership even when another client changes it.
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 3000);
    return () => { clearInterval(timer); generation.current++; };
  }, [load]);
  useEffect(() => { if (layout === "merged") loadFeed(); }, [layout, loadFeed]);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(COMMAND_TOPIC, () => {
    if (soon.current) return;
    soon.current = setTimeout(() => { soon.current = null; load(); if (layout === "merged") loadFeed(); }, 500);
  });
  useEffect(() => () => { if (soon.current) clearTimeout(soon.current); }, []);
  const timeline = useRef<HTMLDivElement>(null), followLatest = useRef(true);
  useLayoutEffect(() => {
    if (followLatest.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [entries?.at(-1)?.id]);

  // Tells the "This Space" mention provider which Space's threads to offer.
  const markFocus = () => { void rpc.call("commandFocus", { spaceId }).catch(() => {}); };
  /** BB's composer submits rich input: mentions pick recipients and files ride along. Throwing keeps the draft. */
  const send = async (request: NewThreadRequest) => {
    // Throwing keeps the draft until the Space has loaded.
    if (!space) throw new Error("This Space is still loading. Try again in a moment.");
    setError(null);
    const attachments = request.input.filter((part): part is CommandAttachment => part.type !== "text");
    const mentioned: string[] = [];
    let everyone = false;
    const text = request.input.flatMap(part => {
      if (part.type !== "text") return [];
      let out = part.text;
      for (const m of [...(part.mentions ?? [])].sort((x, y) => y.start - x.start)) {
        const r = m.resource, label = r.label.replace(/^@/, "");
        const ours = r.kind === "plugin" && r.pluginId === PLUGIN_ID;
        const broadcast = ours ? broadcastMentionText(r.itemId) : null;
        const picked = ours ? spaceThreadMentionId(r.itemId) : null;
        if (broadcast) everyone = true;
        if (picked) {
          if (!space.threads.some(t => t.id === picked)) throw new Error(`${label} is no longer in this Space.`);
          mentioned.push(picked);
        }
        if (r.kind === "thread" && space.threads.some(t => t.id === r.threadId)) mentioned.push(r.threadId);
        out = out.slice(0, m.start) + (broadcast ?? (picked ? `${label} (thread ${picked})` : r.kind === "thread" ? `${label} (thread ${r.threadId})` : label)) + out.slice(m.end);
      }
      return [out];
    }).join("\n").trim();
    // Typed @all works like the picked mention.
    if (/(^|[^a-zA-Z0-9_.-])@(all|everyone)(?![a-zA-Z0-9_.-])/i.test(text)) everyone = true;
    const command = /^\/(steer|followup|fork)\s+/.exec(text);
    let failure: string | null = null;
    try {
      const threadIds = recipients(mentioned, everyone, layout === "focus" ? reply ?? selected : reply, space);
      const result = await rpc.call("commandSend", { spaceId, threadIds, text: command ? text.slice(command[0].length) : text, attachments, mode: (command?.[1] ?? "auto") as "auto" | "steer" | "followup" | "fork", permissionMode: permission });
      const failures = result.deliveries.filter(d => d.status === "error");
      if (failures.length) failure = failures.map(d => d.error).join("\n");
      else { setReply(null); followLatest.current = true; }
      load();
      if (layout === "merged") loadFeed();
    } catch (e) { failure = message(e); }
    if (failure) { setError(failure); throw new Error(failure); }
  };

  const threads = space?.threads ?? [];
  const thread = (id: string | null) => threads.find(t => t.id === id);
  const nameOf = (threadId: string) => thread(threadId)?.title || "Thread";
  const target = layout === "focus" ? reply ?? selected : reply;
  const defaultTo = target && thread(target) ? target : space?.leadThreadId ?? null;
  const time = (at: number) => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(at);
  const working = threads.filter(t => !t.parentThreadId && ["starting", "active"].includes(t.status)).map(t => nameOf(t.id));
  const renderEntry = (entry: CommandEntry, previous?: CommandEntry) => {
    if (entry.role === "user") return <li key={entry.id} data-command-entry="user" className="ml-auto flex w-fit max-w-[70%] flex-col items-end gap-1">
      <time className="text-xs text-subtle-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time>
      <div className="max-w-full break-words rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5 text-sm leading-relaxed text-foreground"><Markdown content={entry.text} /></div>
    </li>;
    const continued = previous?.role === "assistant" && previous.threadId === entry.threadId && entry.createdAt - previous.createdAt < 5 * 60_000;
    return <li key={entry.id} data-command-entry="assistant" className={`group/message rounded-lg px-2 ${continued ? "-mt-2" : ""}`}>
      {!continued && <div className="mb-1.5 flex min-w-0 items-center gap-2 text-sm"><ItemTile icon={null} kindIcon="MessageSquare" size="sm" /><button type="button" className="min-w-0 truncate font-medium hover:underline" onClick={() => openThread(entry.threadId)}>{nameOf(entry.threadId)}</button><time className="shrink-0 text-xs text-subtle-foreground" dateTime={new Date(entry.createdAt).toISOString()}>{time(entry.createdAt)}</time></div>}
      <div className="min-w-0 break-words text-sm leading-relaxed"><Markdown content={entry.text} /></div>
      <button type="button" className="mt-1 text-xs text-subtle-foreground hover:text-foreground" onClick={() => { setReply(entry.threadId); setFocus(value => value + 1); }}>Send to {nameOf(entry.threadId)}</button>
    </li>;
  };
  return <div className="relative flex h-full min-h-0 flex-col" data-command-view>
    <StudioBar>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
        <BarCrumb><span className="truncate">{space?.space.name ?? "Space"}</span></BarCrumb>
        <BarSeparator />
        <BarCrumb current>Command</BarCrumb>
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        <NewThreadButton space={space?.space ?? null} />
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <CommandLayoutPicker value={layout} onChange={setLayout} />
      </div>
    </StudioBar>
    {layout === "merged" ? <div data-command-timeline ref={timeline} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} className="min-h-0 flex-1 overflow-auto"><div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 pt-6 pb-8">
      {(!space || !entries) && !error && <Placeholder rows={3} />}
      {space && entries && !entries.length && <div className="flex flex-1 flex-col items-center justify-center pb-16 text-center">
        <p className="text-sm font-medium">{space.space.name}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{space.threads.length ? "Message the lead, or @mention threads to message them together. Their replies land here." : "This Space has no threads yet."}</p>
      </div>}
      <ol className="flex flex-col gap-3">{(entries ?? []).map((entry, i, all) => renderEntry(entry, all[i - 1]))}</ol>
      {working.length > 0 && <p className="mt-6 px-2 text-sm text-subtle-foreground" role="status"><span className="animate-pulse motion-reduce:animate-none">{working.join(", ")} {working.length === 1 ? "is" : "are"} working…</span></p>}
    </div></div> : !space ? <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-[760px] px-4 pt-6">{!error && <Placeholder rows={2} />}</div></div> : <CommandThreads spaceId={spaceId} threads={space.threads} leadThreadId={space.leadThreadId} layout={layout} selected={selected} onSelect={threadId => { setSelected(threadId); setReply(null); setLayout("focus"); }} onReply={(threadId, focusComposer) => { setReply(threadId); if (focusComposer) setFocus(value => value + 1); }} onOpen={openThread} />}
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
      {/* Keep the existing draft key so moving Command preserves unsent messages. */}
      <div data-command-composer onFocusCapture={markFocus} onKeyDownCapture={event => { if (event.key === "@") markFocus(); }}><NewThreadComposer layout="contained" className="view-composer" placeholder={defaultTo ? `Message ${nameOf(defaultTo)}. @mention threads, or @all for everyone.` : "@mention threads to message them, or @all for everyone."} draftKey={`bot-teams:command:${spaceId}`} focusRequest={focus} onSubmit={send} /></div>
      <div className="mt-1 flex min-h-6 select-none items-center justify-between gap-2 pl-[15px] pr-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {defaultTo && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-command-target><Icon name="ArrowTurnBackward" className="size-3.5 shrink-0" /><span className="truncate">To <span className="text-foreground">{nameOf(defaultTo)}</span>{defaultTo === space?.leadThreadId && !reply ? " · lead" : ""}</span>{reply && <button type="button" aria-label="Send to the lead instead" title="Send to the lead instead" className={ROW_ICON_BUTTON} onClick={() => setReply(null)}><Icon name="X" className="size-3.5" /></button>}</span>}
        </div>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Approval mode" className={`inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium leading-tight transition-colors hover:bg-state-hover data-[state=open]:bg-state-active ${permission === "full" ? "text-warning-text" : "text-muted-foreground hover:text-foreground"}`}><span className="truncate">{MODE_CHOICES.find(choice => choice.id === permission)!.label}</span><Icon name="ChevronDown" className="size-3 shrink-0" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-72">
            <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Approvals for every recipient</DropdownMenuLabel>
            {MODE_CHOICES.map(choice => <DropdownMenuItem key={choice.id ?? "own"} onSelect={() => setPermission(choice.id)} className="items-start"><span className="min-w-0 flex-1"><span className={`block text-sm ${choice.id === "full" ? "text-warning-text" : ""}`}>{choice.label}</span><span className="block text-xs text-subtle-foreground">{choice.detail}</span></span>{permission === choice.id && <Icon name="Check" className="mt-0.5 size-4" />}</DropdownMenuItem>)}
          </DropdownMenuContent></DropdownMenu>
      </div>
      {error && <div className="mt-2">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>}
    </div>
  </div>;
}

/** /plugins/studio/studio/command/<spaceId>, opened from a Space's ⋯ menu in the sidebar. */
export function CommandPage({ subPath }: PluginNavPanelProps) {
  const spaceId = subPath.split("/")[0];
  if (!spaceId) return <PageColumn><p className="text-sm text-muted-foreground">Open a Space’s Command view from its ⋯ menu in the sidebar.</p></PageColumn>;
  return <CommandView key={spaceId} spaceId={spaceId} />;
}
