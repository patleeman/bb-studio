import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { experimental_NewThreadComposer as NewThreadComposer, useBbNavigate, useSdk, useRealtime, useRpc, type NewThreadRequest, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { BarCrumb, BarSeparator, ICON_BUTTON, Icon, PageColumn, StudioBar, Tooltip, openCompanion } from "@bb-studio/kit/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@bb-studio/kit/ui";
import { errorMessage as message } from "@bb-studio/kit/format";
import "./styles.css";
const PLUGIN_ID = "studio";
import type { rpcContract } from "../contract";
import type { CommandAttachment, CommandPermissionMode, CommandSpace } from "./command-contract";
import { broadcastMentionText, spaceThreadMentionId, typedAliases } from "./mentions";
import { draftRecipients, useCommandDraft } from "./draft-recipients";
import { CommandSwitcher, CommandThreads, useCommandPanes, type CommandPanes } from "./command-threads";
import { claimsNewThreadKey, recipients } from "./command-layout";

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

/** The last data each Space showed, so reopening the view draws at once while it refreshes. */
const lastSpace = new Map<string, Space>();

function Placeholder({ rows }: { rows: number }) {
  return <div role="status" aria-label="Loading" className="flex flex-col gap-3 motion-safe:animate-pulse">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="flex flex-col gap-2 rounded-lg px-2"><div className="h-3.5 w-40 rounded bg-surface-recessed" /><div className="h-3 w-full rounded bg-surface-recessed" /><div className="h-3 w-2/3 rounded bg-surface-recessed" /></div>)}
  </div>;
}

/** A poll that changed nothing keeps the old object, so the panes and composer don't re-render. */
const same = (a: Space | null, b: Space) => !!a && JSON.stringify(a) === JSON.stringify(b);

/** New thread in this Space: a draft pane in the grid. ⌘N opens it too while this view is in use. */
function NewThreadButton({ space, onNew, root }: { space: Space["space"] | null; onNew(): void; root: RefObject<HTMLElement | null> }) {
  const latest = useRef({ space, onNew });
  latest.current = { space, onNew };
  useEffect(() => {
    let clickedInside = false;
    const onPointer = (event: PointerEvent) => { clickedInside = !!root.current?.contains(event.target as Node); };
    // Capture runs before BB's own handler, so the key starts the thread here instead.
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.space || !claimsNewThreadKey(event, root.current, clickedInside)) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onNew();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", onPointer, true); window.removeEventListener("keydown", onKey, true); };
  }, [root]);
  return <Tooltip label="New thread in this Space (⌘N)"><button type="button" aria-label={`New thread in ${space?.name ?? "this Space"}`} aria-keyshortcuts="Meta+N" className={ICON_BUTTON} disabled={!space} onClick={onNew}><Icon name="Plus" className="size-4" aria-hidden /></button></Tooltip>;
}

/**
 * A pane for starting a thread in the Space: BB's new-thread composer with
 * the Space's project picked. Once the thread starts it becomes its pane.
 */
function NewThreadPane({ space, panes, onStarted }: { space: Space["space"]; panes: CommandPanes; onStarted(): void }) {
  const rpc = useRpc<Contract>();
  const pane = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const focus = panes.draft?.focus ?? 0;
  useEffect(() => { if (focus) pane.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focus]);
  // Throwing keeps the draft in the composer.
  const submit = async (request: NewThreadRequest) => {
    setError(null);
    try {
      const { threadId } = await rpc.call("commandSpawn", { spaceId: space.id, request });
      panes.started(threadId);
      onStarted();
    } catch (cause) { setError(message(cause)); throw cause; }
  };
  return <section ref={pane} className="channel-thread-pane" data-command-new-thread aria-label="New thread">
    <header>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">New thread</span>
      <span className="shrink-0 text-xs text-subtle-foreground">in {space.name}</span>
      <span className="channel-pane-actions">
        <Tooltip label="Discard the new thread"><button type="button" aria-label="Close new thread" onClick={panes.discard} className="channel-pane-action"><Icon name="X" className="size-3.5" /></button></Tooltip>
      </span>
    </header>
    {panes.draft?.threadId
      ? <div className="channel-stage-empty" role="status"><p className="text-muted-foreground">Starting…</p></div>
      : <div className="command-new-thread-body">
        <NewThreadComposer layout="contained" defaultProjectId={space.defaultProjectId ?? undefined} draftKey={`studio:command-new-thread:${space.id}`} focusRequest={focus} placeholder={`What should a new thread in ${space.name} do?`} onSubmit={submit} />
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </div>}
  </section>;
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
  const [permission, setPermission] = useStored<CommandPermissionMode | null>(`studio:command-permission:${spaceId}`, value => MODE_CHOICES.find(choice => choice.id === value)?.id ?? null);
  // The thread picked to reply to.
  const [reply, setReply] = useState<string | null>(null);
  const draft = useCommandDraft(spaceId);
  const [focus, setFocus] = useState(0);
  const generation = useRef(0);
  const load = useCallback(() => {
    const seq = ++generation.current;
    void rpc.call("command", { spaceId }).then(next => { if (seq === generation.current) { lastSpace.set(spaceId, next); setSpace(current => same(current, next) ? current : next); setError(null); } }, e => { if (seq === generation.current) setError(message(e)); });
  }, [rpc, spaceId]);
  useEffect(() => {
    load();
    // Refresh Space membership even when another client changes it.
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 3000);
    return () => { clearInterval(timer); generation.current++; };
  }, [load]);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(COMMAND_TOPIC, () => {
    if (soon.current) return;
    soon.current = setTimeout(() => { soon.current = null; load(); }, 500);
  });
  useEffect(() => () => { if (soon.current) clearTimeout(soon.current); }, []);

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
    // Typed @all works like the picked mention, and a typed @a like picking thread a.
    if (/(^|[^a-zA-Z0-9_.-])@(all|everyone)(?![a-zA-Z0-9_.-])/i.test(text)) everyone = true;
    for (const alias of typedAliases(text)) {
      const named = space.threads.find(t => t.alias === alias);
      if (named) mentioned.push(named.id);
    }
    const command = /^\/(steer|followup|fork)\s+/.exec(text);
    let failure: string | null = null;
    try {
      const threadIds = recipients(mentioned, everyone, reply, space);
      const toLeadByDefault = !everyone && !mentioned.length && !reply;
      const result = await rpc.call("commandSend", { spaceId, threadIds, text: command ? text.slice(command[0].length) : text, attachments, mode: (command?.[1] ?? "auto") as "auto" | "steer" | "followup" | "fork", permissionMode: permission, projectId: request.projectId, toLeadByDefault });
      const failures = result.deliveries.filter(d => d.status === "error");
      if (failures.length) failure = failures.map(d => d.error).join("\n");
      else setReply(null);
      load();
    } catch (e) { failure = message(e); }
    if (failure) { setError(failure); throw new Error(failure); }
  };

  const threads = space?.threads ?? [];
  const thread = (id: string | null) => threads.find(t => t.id === id);
  const nameOf = (threadId: string) => thread(threadId)?.title || "Thread";
    const defaultTo = reply && thread(reply) ? reply : space?.leadThreadId ?? null;
  // Mentions in the draft decide who it goes to, ahead of the picked thread.
  const addressed = draftRecipients(draft, threads);
  const aliasOf = (threadId: string) => thread(threadId)?.alias;
  const panes = useCommandPanes(spaceId, threads, space?.leadThreadId ?? null);
  const sdk = useSdk();
  // Reading a pane marks its thread read in BB too, then refreshes the dots.
  const markSeen = useCallback((threadId: string) => { void sdk.threads.markRead({ threadId }).then(load, () => {}); }, [sdk, load]);
  const root = useRef<HTMLDivElement>(null);
  const pickReply = useCallback((threadId: string, focusComposer?: boolean) => { setReply(threadId); if (focusComposer) setFocus(value => value + 1); }, []);
  return <div ref={root} className="relative flex h-full min-h-0 flex-col" data-command-view>
    <StudioBar>
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
        <BarCrumb><span className="truncate">{space?.space.name ?? "Space"}</span></BarCrumb>
        <BarSeparator />
        <BarCrumb current>Command</BarCrumb>
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip label={panes.following ? "Following work: one pane shows whichever thread is working" : "Follow work: close the panes and show whichever thread is working"}><button type="button" aria-label="Follow work" aria-pressed={panes.following} className={ICON_BUTTON} disabled={!space} onClick={panes.follow}><Icon name="Zap" className="size-4" aria-hidden /></button></Tooltip>
        <NewThreadButton space={space?.space ?? null} onNew={panes.newThread} root={root} />
      </div>
    </StudioBar>
    {!space ? <div className="min-h-0 flex-1 overflow-auto"><div className="mx-auto w-full max-w-[760px] px-4 pt-6">{!error && <Placeholder rows={2} />}</div></div> : <CommandThreads panes={panes} threads={space.threads} leadThreadId={space.leadThreadId} draftPane={<NewThreadPane space={space.space} panes={panes} onStarted={load} />} onReply={pickReply} onSeen={markSeen} onOpen={openThread} />}
    <div className="command-dock">
    <div className="min-w-0">
      {/* Keep the existing draft key so moving Command preserves unsent messages. */}
      <div data-command-composer data-command-space={spaceId} onFocusCapture={markFocus} onKeyDownCapture={event => { if (event.key === "@") markFocus(); }}><NewThreadComposer layout="contained" className="view-composer" placeholder={defaultTo ? `Message ${nameOf(defaultTo)}. @mention threads, or @all for everyone.` : "@mention threads to message them, or @all for everyone."} draftKey={`bot-teams:command:${spaceId}`} focusRequest={focus} onSubmit={send} /></div>
      <div className="mt-1 flex min-h-6 select-none items-center justify-between gap-2 pl-[15px] pr-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {addressed === "everyone" ? <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-command-target><Icon name="ArrowTurnBackward" className="size-3.5 shrink-0" /><span className="truncate">To <span className="text-foreground">everyone</span></span></span>
          : addressed.length ? <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-command-target><Icon name="ArrowTurnBackward" className="size-3.5 shrink-0" /><span className="truncate">To {addressed.map((id, i) => <span key={id}>{i ? ", " : ""}{aliasOf(id) && <span className="channel-alias" aria-hidden>{aliasOf(id)}</span>}<span className="text-foreground">{nameOf(id)}</span></span>)}</span></span>
          : defaultTo && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-command-target><Icon name="ArrowTurnBackward" className="size-3.5 shrink-0" /><span className="truncate">To <span className="text-foreground">{nameOf(defaultTo)}</span>{defaultTo === space?.leadThreadId && !reply ? " · lead" : ""}</span>{reply && <Tooltip label="Send to the lead instead"><button type="button" aria-label="Send to the lead instead" className={ROW_ICON_BUTTON} onClick={() => setReply(null)}><Icon name="X" className="size-3.5" /></button></Tooltip>}</span>}
        </div>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Approval mode" className={`inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-xs font-medium leading-tight transition-colors hover:bg-state-hover data-[state=open]:bg-state-active ${permission === "full" ? "text-warning-text" : "text-muted-foreground hover:text-foreground"}`}><span className="truncate">{MODE_CHOICES.find(choice => choice.id === permission)!.label}</span><Icon name="ChevronDown" className="size-3 shrink-0" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-72">
            <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Approvals for every recipient</DropdownMenuLabel>
            {MODE_CHOICES.map(choice => <DropdownMenuItem key={choice.id ?? "own"} onSelect={() => setPermission(choice.id)} className="items-start"><span className="min-w-0 flex-1"><span className={`block text-sm ${choice.id === "full" ? "text-warning-text" : ""}`}>{choice.label}</span><span className="block text-xs text-subtle-foreground">{choice.detail}</span></span>{permission === choice.id && <Icon name="Check" className="mt-0.5 size-4" />}</DropdownMenuItem>)}
          </DropdownMenuContent></DropdownMenu>
      </div>
      {error && <div className="mt-2">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>}
    </div>
    {space && <CommandSwitcher panes={panes} threads={space.threads} leadThreadId={space.leadThreadId} targets={addressed === "everyone" ? space.threads.filter(t => !t.parentThreadId).map(t => t.id) : addressed.length ? addressed : defaultTo ? [defaultTo] : []} onReply={pickReply} />}
    </div>
  </div>;
}

/** /plugins/studio/studio/command/<spaceId>, opened from a Space's ⋯ menu in the sidebar. */
export function CommandPage({ subPath }: PluginNavPanelProps) {
  const spaceId = subPath.split("/")[0];
  if (!spaceId) return <PageColumn><p className="text-sm text-muted-foreground">Open a Space’s Command view from its ⋯ menu in the sidebar.</p></PageColumn>;
  return <CommandView key={spaceId} spaceId={spaceId} />;
}
