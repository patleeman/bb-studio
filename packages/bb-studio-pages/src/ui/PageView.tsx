import { untitled } from "@bb-studio/kit/format";
import { ThreadTitle, useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, BarCrumb, BarSeparator, ItemHeader, ITEM_TITLE, useFloatAvailable, useInFloat, useStudioChatPresent, useOpenCompanion } from "@bb-studio/kit/app";
import { FLOAT_RIGHT_VAR } from "@bb-studio/kit/contract";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb-studio/kit/ui";
import { Icon } from "@bb-studio/kit/ui";
import { cn } from "@bb-studio/kit/ui";
import type { PageMetaView, RequestView } from "../contract";
import { PageConnection } from "./connection";
import { HistoryDialog } from "./dialogs";
import { PageChat } from "./PageChat";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import { PageEditor, type SidePanel } from "./PageEditor";
import { actorName, PageMenu, relativeTime, ICON_BUTTON, type BotsState, type Project, type Rpc } from "./shared";
import { pageFieldKey, toggleTalk, useTalk, type TalkView } from "./talk";
import { usePageTitle } from "./use-page-title";

const PAGE_ICONS = ["📄", "📝", "📋", "✅", "📊", "📈", "🗺️", "🧭", "💡", "🚀", "🧪", "🛠️", "📚", "🗓️", "🎯", "🔥", "⭐", "🧠", "🤖", "📣"];
type Chat = { threadId: string; createdAt: number };

export function useConnection(pageId: string) {
  const [connection, setConnection] = useState<PageConnection | null>(null);
  useEffect(() => {
    const next = new PageConnection(pageId);
    setConnection(next);
    return () => next.destroy();
  }, [pageId]);
  const current = connection?.pageId === pageId ? connection : null;
  useSyncExternalStore(
    useCallback((listener) => current?.subscribe(listener) ?? (() => {}), [current]),
    () => current?.snapshot ?? "connecting",
  );
  return { connection: current, status: current?.status ?? "connecting", synced: current?.synced ?? false, ready: current?.ready ?? false };
}

type Presence = { clientId: number; name: string; color: string; agent: boolean };

function usePresence(connection: PageConnection | null): Presence[] {
  const [presence, setPresence] = useState<Presence[]>([]);
  useEffect(() => {
    if (!connection) return;
    const read = () => {
      const seen = new Map<string, Presence>();
      for (const [clientId, state] of connection.awareness.getStates()) {
        if (clientId === connection.doc.clientID) continue;
        const user = (state as { user?: { name?: string; color?: string; agent?: boolean } }).user;
        if (!user?.name) continue;
        const key = `${user.name}:${user.agent ? 1 : 0}`;
        if (!seen.has(key)) seen.set(key, { clientId, name: user.name, color: user.color ?? "#888", agent: Boolean(user.agent) });
      }
      setPresence([...seen.values()]);
    };
    read();
    connection.awareness.on("change", read);
    return () => connection.awareness.off("change", read);
  }, [connection]);
  return presence;
}

/** A title that wraps onto more lines instead of scrolling sideways. */
function TitleField(props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, []);
  useEffect(fit, [fit, props.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder="Untitled"
      aria-label="Page title"
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/50", ITEM_TITLE)}
      {...props}
    />
  );
}

function Smiley({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

function IconPicker({ page, rpc, children }: { page: PageMetaView; rpc: Rpc; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        <div className="grid grid-cols-8 gap-1">
          {PAGE_ICONS.map((icon) => (
            <button key={icon} type="button" className="rounded p-1 text-lg hover:bg-state-hover" onClick={() => void rpc.call("update", { id: page.id, icon })}>
              {icon}
            </button>
          ))}
        </div>
        {page.icon ? (
          <DropdownMenuItem className="mt-1" onSelect={() => void rpc.call("update", { id: page.id, icon: "" })}>
            Remove icon
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TALK_WORKING_PHASES = new Set(["starting", "finalizing", "transcribing"]);

function DictateButton({ talk, ready, onToggle }: { talk: TalkView; ready: boolean; onToggle(): void }) {
  if (talk.mode === "unavailable") return null;
  if (talk.mode === "here") {
    const working = TALK_WORKING_PHASES.has(talk.phase);
    return (
      <button
        type="button"
        aria-pressed
        disabled={working}
        onClick={onToggle}
        className={cn(BAR_BUTTON, "text-foreground")}
      >
        <Icon name={working ? "Mic" : "Square"} className={cn("size-3.5", working ? "animate-pulse" : "text-red-500")} />
        {talk.phase === "starting" ? "Starting…" : working ? "Transcribing…" : "Stop"}
      </button>
    );
  }
  const busy = talk.mode === "elsewhere";
  return (
    <button
      type="button"
      aria-label="Dictate"
      title={busy ? "Talk is busy with another recording." : "Dictate into this page with Talk"}
      disabled={busy || !ready}
      onClick={onToggle}
      className={ICON_BUTTON}
    >
      <Icon name="Mic" className="size-4" />
    </button>
  );
}

function Breadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  const navigate = useBbNavigate();
  const trail: PageMetaView[] = [];
  let parent = page.parentId;
  while (parent && trail.length < 6) {
    const found = pages.find((candidate) => candidate.id === parent);
    if (!found) break;
    trail.unshift(found);
    parent = found.parentId;
  }
  return (
    <>
      {trail.map((crumb) => (
        <Fragment key={crumb.id}>
          <BarCrumb onClick={() => navigate.toPluginPanel("pages", { subPath: crumb.id })}>
            <span className="truncate max-md:max-w-24">{crumb.icon} {untitled(crumb.title)}</span>
          </BarCrumb>
          <BarSeparator />
        </Fragment>
      ))}
      <BarCrumb current><span className="truncate">{page.icon} {untitled(page.title)}</span></BarCrumb>
    </>
  );
}

function PresenceStack({ presence }: { presence: Presence[] }) {
  if (!presence.length) return null;
  return (
    <div className="flex items-center -space-x-1.5 px-1">
      {presence.slice(0, 5).map((user) => (
        <span
          key={user.clientId}
          title={`${user.name} ${user.agent ? "is editing" : "is here"}`}
          className={cn(
            "flex size-7 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold text-white",
            user.agent && "animate-pulse",
          )}
          style={{ background: user.color }}
        >
          {[...user.name][0]?.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

/** The badge only shows when something needs you: a failed save, offline, or a deleted page. Saving as you type is the dot in the bar. */
export function persistenceVisible(connection: PageConnection | null): boolean {
  if (!connection) return false;
  return connection.status === "offline" || connection.status === "missing" || connection.localSave === "failed" || connection.serverSave === "failed";
}

/** A quiet dot in the bar while edits are on their way to BB; nothing once they're saved. */
export function SavingDot({ connection, titleSaving }: { connection: PageConnection | null; titleSaving: boolean }) {
  const saving = titleSaving || (!!connection && !persistenceVisible(connection) && connection.serverSave !== "confirmed");
  if (!saving) return null;
  return <span role="status" aria-label="Saving" title="Saving to BB" className="ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />;
}

export function PersistenceBadge({ connection }: { connection: PageConnection | null }) {
  if (!connection || !persistenceVisible(connection)) return null;
  const local = connection.localSave === "saved";
  const failed = connection.localSave === "failed" || connection.serverSave === "failed";
  const missing = connection.status === "missing";
  const text = missing ? "Page deleted"
    : connection.localSave === "failed" ? "Local recovery failed"
    : connection.serverSave === "failed" ? "BB save failed"
    : connection.serverSave === "confirmed" ? connection.status === "offline" ? "Offline · content saved to BB" : "Content saved to BB"
    : connection.status === "offline" ? "Offline"
    : connection.localSave === "loading" ? "Loading recovery…" : "Saving content to BB…";
  const detail = connection.serverSave !== "confirmed" && !missing
    ? connection.localSave === "failed" ? "Keep this page open or download a recovery file"
      : local ? "Saved on this browser" : "Recovery is not yet saved on this browser"
    : null;
  return (
    <span className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
      <span role="status" aria-live="polite" title={[connection.localError, connection.serverError].filter(Boolean).join("\n") || undefined}>
        {text}{detail ? ` · ${detail}` : ""}
      </span>
      {(failed || connection.status === "offline") ? (
        <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => connection.retrySave()}>{missing ? "Retry local recovery" : "Retry save"}</button>
      ) : null}
      {failed || missing || connection.serverSave !== "confirmed" ? (
        <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Downloads a .yjs recovery file preserving blocks and comments. This is not a Markdown document." onClick={() => connection.exportRecovery()}>Download recovery file (.yjs)</button>
      ) : null}
    </span>
  );
}

const STATUS_STYLE: Record<RequestView["status"], string> = {
  queued: "text-muted-foreground",
  working: "text-violet-500",
  done: "text-emerald-500",
  failed: "text-red-500",
};
const STATUS_ICON: Record<RequestView["status"], string> = {
  queued: "Clock",
  working: "Spinner",
  done: "CircleCheck",
  failed: "AlertCircle",
};
const STATUS_VERB: Record<RequestView["status"], string> = {
  queued: "will pick up",
  working: "is working on",
  done: "finished",
  failed: "couldn't finish",
};

/** Previous requests, the keep-updated schedule and page chats, behind one pill. */
function ActivityPill({
  page,
  requests,
  chats,
  onOpenThread,
}: {
  page: PageMetaView;
  requests: RequestView[];
  chats: Chat[];
  onOpenThread(threadId: string): void;
}) {
  if (!page.refresh && !requests.length && !chats.length) return null;
  const active = requests.filter((request) => request.status === "queued" || request.status === "working");
  const label = active.length
    ? `${active[0]!.botName} is working${active.length > 1 ? ` +${active.length - 1}` : ""}`
    : page.refresh
      ? "Kept updated"
      : "Activity";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Page activity: ${label}`}
          className={cn(BAR_BUTTON, "max-w-56")}
        >
          <Icon
            name={active.length ? "Spinner" : page.refresh ? "Repeat" : "Clock"}
            className={cn("size-3.5 shrink-0", active.length && "text-violet-500")}
          />
          <span className="truncate max-md:sr-only">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-auto">
        {requests.length ? (
          <>
            {page.refresh ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Previous requests</DropdownMenuLabel>
            {requests.slice(0, 8).map((request) => (
              <DropdownMenuItem
                key={request.id}
                disabled={!request.threadId}
                className="items-start"
                onSelect={() => request.threadId && onOpenThread(request.threadId)}
              >
                <Icon name={STATUS_ICON[request.status]} className={cn("mt-0.5 size-3.5 shrink-0", STATUS_STYLE[request.status])} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">
                    {request.botName} {STATUS_VERB[request.status]}{" "}
                    {request.kind === "refresh" ? "a refresh" : request.kind === "comment" ? "a comment" : "a request"}
                    {request.summary && request.kind !== "refresh" ? `: “${request.summary}”` : ""}
                  </span>
                  {request.error ? <span className="line-clamp-2 text-xs text-red-500">{request.error}</span> : null}
                  <span className="text-xs text-muted-foreground">{relativeTime(request.updatedAt)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {chats.length ? (
          <>
            {page.refresh || requests.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Chats</DropdownMenuLabel>
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.threadId} onSelect={() => onOpenThread(chat.threadId)}>
                <Icon name="MessageSquare" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="pages-thread-title min-w-0 flex-1 truncate">
                  <ThreadTitle threadId={chat.threadId} />
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(chat.createdAt)}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PageView({
  page,
  pages,
  bots,
  projects,
  rpc,
  requestsVersion,
  chatThreadId,
  onCreateInside,
  onDeleted,
  backLabel,
  onBack,
}: {
  page: PageMetaView;
  pages: PageMetaView[];
  bots: BotsState;
  projects: Project[];
  rpc: Rpc;
  requestsVersion: number;
  /** Existing page chat links still open their conversation. */
  chatThreadId: string | null;
  onCreateInside(): void;
  onDeleted(): void;
  /** "Studio" when Studio is installed, else "Pages". */
  backLabel: string;
  onBack(): void;
}) {
  const { connection, status, ready } = useConnection(page.id);
  const presence = usePresence(connection);
  const talk = useTalk(pageFieldKey(page.id));
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [dialog, setDialog] = useState<"refresh" | "history" | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatThread, setChatThread] = useState<string | null>(chatThreadId);
  const titleSave = usePageTitle(page, rpc);
  const { title } = titleSave;
  useEffect(() => {
    rpc.call("requests", { pageId: page.id }).then((result) => setRequests(result.requests), () => {});
  }, [rpc, page.id, requestsVersion]);
  const loadChats = useCallback(() => {
    rpc.call("chats", { pageId: page.id }).then((result) => setChats(result.chats), () => {});
  }, [rpc, page.id]);
  useEffect(loadChats, [loadChats]);
  useRealtime(REALTIME_CHANNEL, payload => {
    const event = payload as RealtimeEvent;
    if (event.type === "chats" && event.pageId === page.id) {
      setChatThread(event.threadId);
      loadChats();
    }
  });

  const floatAvailable = useFloatAvailable();
  const inFloat = useInFloat();
  const studioChat = useStudioChatPresent();
  const open = useOpenCompanion();
  const openThread = useCallback((threadId: string) => {
    setChatThread(threadId);
    open({ kind: "thread", threadId });
  }, [open]);
  const openedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!chatThreadId || openedRoute.current === chatThreadId) return;
    openedRoute.current = chatThreadId;
    openThread(chatThreadId);
  }, [chatThreadId, openThread]);
  // Keeps the windows clear of the comments card.
  const besideComments = sidePanel === "comments";
  useEffect(() => {
    if (!floatAvailable || inFloat || !besideComments || !window.matchMedia("(min-width: 768px)").matches) return;
    const root = document.documentElement.style;
    root.setProperty(FLOAT_RIGHT_VAR, "344px");
    return () => void root.removeProperty(FLOAT_RIGHT_VAR);
  }, [floatAvailable, inFloat, besideComments]);

  const shown = { ...page, title };

  return (
    // Floating chrome, the comments card and the chat are placed against this box.
    <div className="pages-doc relative flex h-full min-h-0 flex-col bg-background text-foreground">
      {persistenceVisible(connection) ? <div className="shrink-0 px-4 pt-3 pb-2"><PersistenceBadge connection={connection} /></div> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn("mx-auto w-full max-w-[828px] pt-12 pb-40 max-md:pt-6", sidePanel && "min-[1280px]:max-w-[1168px] min-[1280px]:pr-[340px]")}>
          <div className="group/title px-[54px] max-md:px-4">
            {page.icon ? (
              <IconPicker page={page} rpc={rpc}>
                <button type="button" aria-label="Change icon" className="mb-3 rounded-md text-[44px] leading-none hover:bg-state-hover">
                  {page.icon}
                </button>
              </IconPicker>
            ) : null}
            <div className="relative">
              {!page.icon ? (
                <IconPicker page={page} rpc={rpc}>
                  <button
                    type="button"
                    aria-label="Add icon"
                    title="Add icon"
                    className="pages-reveal absolute top-2.5 -left-9 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/title:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:static max-md:mb-1 max-md:-ml-1.5"
                  >
                    <Smiley className="size-[18px]" />
                  </button>
                </IconPicker>
              ) : null}
              <TitleField
                value={title}
                maxLength={200}
                // A new page starts with its title, like a new document.
                autoFocus={!page.title && !page.archived}
                onChange={(event) => titleSave.controller.edit(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    (document.querySelector(".pages-editor .bn-editor") as HTMLElement | null)?.focus();
                  }
                }}
              />
            </div>
            {titleSave.status === "failed" || titleSave.status === "conflict" || titleSave.status === "recovered" || titleSave.localError || titleSave.alternatives.length ? (
              <div className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
                <p role="status" aria-live="polite" className={cn(titleSave.status === "failed" || titleSave.status === "conflict" || titleSave.localError ? "text-destructive" : "text-muted-foreground")}>
                  {titleSave.status === "conflict" ? "The title changed in BB. Your title draft is kept here."
                    : titleSave.status === "failed" ? "Title save failed."
                    : titleSave.status === "recovered" ? "Recovered an unsaved title draft."
                    : titleSave.status === "saved" ? "Title saved to BB."
                    : "Saving title to BB…"}
                  {titleSave.localError ? " Local title recovery failed. Keep this page open or download the draft."
                    : titleSave.status !== "saved" ? " Title draft saved on this browser." : ""}
                </p>
                {titleSave.error ? <p className="mt-1 break-words text-muted-foreground">{titleSave.error}</p> : null}
                {titleSave.status === "conflict" ? <p className="mt-1 break-words">Current title in BB: {untitled(titleSave.currentTitle)}</p> : null}
                <div className="flex flex-wrap gap-1">
                  {titleSave.localError ? (
                    <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.retryLocal}>Retry local title recovery</button>
                  ) : null}
                  {["failed", "recovered", "conflict"].includes(titleSave.status) ? (
                    <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.retry}>Retry title save</button>
                  ) : null}
                  {titleSave.status === "conflict" ? (
                    <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.useMine}>Use my title</button>
                  ) : null}
                  {titleSave.status !== "saved" || titleSave.localError ? (
                    <>
                      <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.export}>Download title draft</button>
                      {titleSave.status !== "saved" ? <button type="button" disabled={titleSave.status === "saving"} className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={titleSave.controller.discard}>Discard title draft</button> : null}
                    </>
                  ) : null}
                  {titleSave.alternatives.map(draft => (
                    <button key={draft.id} type="button" disabled={titleSave.status === "saving"} className="min-h-11 max-w-full rounded-md px-2 text-left underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => titleSave.controller.choose(draft.id)}>Recover other title: {untitled(draft.title)}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {page.archived ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Archive" className="size-3.5" /> Archived
                <button
                  type="button"
                  className="underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => void rpc.call("update", { id: page.id, archived: false })}
                >
                  Restore
                </button>
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex">
            {connection && ready && status !== "missing" ? (
              <PageEditor
                connection={connection}
                page={page}
                bots={bots.bots}
                pages={pages}
                sidePanel={sidePanel}
                onCloseSidePanel={() => setSidePanel(null)}
              />
            ) : status === "missing" ? (
              <p className="px-[54px] text-sm text-muted-foreground max-md:px-4">This page no longer exists.</p>
            ) : (
              <p className="px-[54px] text-sm text-muted-foreground max-md:px-4">Connecting…</p>
            )}
          </div>
        </div>
      </div>

      <ItemHeader
        backLabel={backLabel}
        onBack={onBack}
        item={{ title: title || "Untitled", href: `/plugins/pages/pages/${page.id}` }}
        leading={<>
          {inFloat ? null : <Breadcrumbs page={shown} pages={pages} />}
          <SavingDot connection={connection} titleSaving={titleSave.status === "pending" || titleSave.status === "saving"} />
        </>}
        chatAction={studioChat === false ? <PageChat page={page} threadId={chatThread ?? chats[0]?.threadId ?? null} /> : undefined}
        trailing={
          <>
          <ActivityPill
            page={page}
            requests={requests}
            chats={chats}
            onOpenThread={openThread}
          />
          <PresenceStack presence={presence} />
          <DictateButton talk={talk} ready={Boolean(connection && ready && status !== "missing")} onToggle={() => toggleTalk(pageFieldKey(page.id))} />
          <button type="button" aria-label="Version history" title="Version history" className={cn(ICON_BUTTON, "max-md:hidden")} onClick={() => setDialog("history")}>
            <Icon name="RotateCcw" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Comments"
            title="Comments"
            aria-pressed={sidePanel === "comments"}
            className={ICON_BUTTON}
            onClick={() => setSidePanel((panel) => (panel === "comments" ? null : "comments"))}
          >
            <Icon name="MessageCirclePlus" className="size-4" />
          </button>
          <PageMenu
            page={page}
            rpc={rpc}
            projects={projects}
            onChanged={() => {}}
            onDeleted={onDeleted}
            triggerClassName={ICON_BUTTON}
            leading={
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Edited {relativeTime(page.updatedAt)} by {actorName(page.updatedBy, bots.bots)}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCreateInside}>
                  <Icon name="Plus" className="size-4" /> Add a page inside
                </DropdownMenuItem>
                <DropdownMenuItem className="md:hidden" onSelect={() => setDialog("history")}>
                  <Icon name="RotateCcw" className="size-4" /> Version history…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void rpc.call("markdown", { id: page.id }).then((result) => navigator.clipboard.writeText(result.markdown))}
                >
                  <Icon name="Copy" className="size-4" /> Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            }
          />
          </>
        }
      />

      <HistoryDialog open={dialog === "history"} onClose={() => setDialog(null)} page={page} bots={bots.bots} rpc={rpc} />
    </div>
  );
}
