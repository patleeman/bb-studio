import { WhiteboardExpandHost } from "./whiteboard-expand";
import { ThreadTitle, useRealtime } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, ItemHeader } from "../../kit/app/index";
import { useStudioOpen } from "../../ui/studio-open";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../kit/ui/index";
import { Icon } from "../../kit/ui/index";
import { cn } from "../../kit/ui/index";
import type { PageMetaView, RequestView } from "../contract";
import { PageConnection } from "./connection";
import { HistoryDialog } from "./dialogs";
import { pagePath, REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import { PageEditor } from "./PageEditor";
import { actorName, PageMenu, relativeTime, ICON_BUTTON, type BotsState, type Project, type Rpc } from "./shared";
import { pageFieldKey, toggleTalk, useTalk, type TalkView } from "./talk";
import { usePageTitle } from "./use-page-title";
import { NoteActions } from "./notes/NoteActions";
import { PageBreadcrumbs } from "./PageBreadcrumbs";
import { PageBody, PageColumn, PageHeading } from "./PageLayout";

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
      title={busy ? "Talk is busy with another recording." : "Dictate"}
      disabled={busy || !ready}
      onClick={onToggle}
      className={ICON_BUTTON}
    >
      <Icon name="Mic" className="size-4" />
    </button>
  );
}

function Breadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  return <PageBreadcrumbs page={page} pages={pages} />;
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
        <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => connection.exportRecovery()}>Download recovery file (.yjs)</button>
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

/** Historical requests and page chats, behind one pill. */
function ActivityPill({
  requests,
  chats,
  onOpenThread,
}: {
  requests: RequestView[];
  chats: Chat[];
  onOpenThread(threadId: string): void;
}) {
  if (!requests.length && !chats.length) return null;
  const active = requests.filter((request) => request.status === "queued" || request.status === "working");
  const label = active.length
    ? `${active[0]!.botName} is working${active.length > 1 ? ` +${active.length - 1}` : ""}`
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
            name={active.length ? "Spinner" : "Clock"}
            className={cn("size-3.5 shrink-0", active.length && "text-violet-500")}
          />
          <span className="truncate max-md:sr-only">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-auto">
        {requests.length ? (
          <>
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
                    {request.kind === "refresh" ? "a refresh" : "a request"}
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
            {requests.length ? <DropdownMenuSeparator /> : null}
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
  backLabel: string;
  onBack(): void;
}) {
  const { connection, status, ready } = useConnection(page.id);
  const presence = usePresence(connection);
  const talk = useTalk(pageFieldKey(page.id));
  const [dialog, setDialog] = useState<"history" | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const titleSave = usePageTitle(page, rpc);
  const { title } = titleSave;
  useEffect(() => {
    rpc.call("pages.requests", { pageId: page.id }).then((result) => setRequests(result.requests), () => {});
  }, [rpc, page.id, requestsVersion]);
  const loadChats = useCallback(() => {
    rpc.call("pages.chats", { pageId: page.id }).then((result) => setChats(result.chats), () => {});
  }, [rpc, page.id]);
  useEffect(loadChats, [loadChats]);
  useRealtime(REALTIME_CHANNEL, payload => {
    const event = payload as RealtimeEvent;
    if (event.type === "chats" && event.pageId === page.id) {
      loadChats();
    }
  });

  const open = useStudioOpen();
  const openThread = useCallback((threadId: string) => {
    open({ threadId });
  }, [open]);
  const openedRoute = useRef<string | null>(null);
  useEffect(() => {
    if (!chatThreadId || openedRoute.current === chatThreadId) return;
    openedRoute.current = chatThreadId;
    openThread(chatThreadId);
  }, [chatThreadId, openThread]);

  const shown = { ...page, title };

  return (
    // Floating chrome and the chat are placed against this box.
    <div className="pages-doc relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <WhiteboardExpandHost>
      {persistenceVisible(connection) ? <div className="shrink-0 px-4 pt-3 pb-2"><PersistenceBadge connection={connection} /></div> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <PageColumn>
          <PageHeading page={page} rpc={rpc} titleSave={titleSave} />
          <PageBody missing={status === "missing"}>
            {connection && ready && status !== "missing" ? (
              <PageEditor connection={connection} page={page} pages={pages} />
            ) : null}
          </PageBody>
        </PageColumn>
      </div>

      <ItemHeader
        backLabel={backLabel}
        onBack={onBack}
        item={{ title: title || "Untitled", href: pagePath(page.id) }}
        leading={<>
          <Breadcrumbs page={shown} pages={pages} />
          <SavingDot connection={connection} titleSaving={titleSave.status === "pending" || titleSave.status === "saving"} />
        </>}
        trailing={
          <>
          <NoteActions pageId={page.id} onDiscarded={onDeleted} />
          <ActivityPill
            requests={requests}
            chats={chats}
            onOpenThread={openThread}
          />
          <PresenceStack presence={presence} />
          <DictateButton talk={talk} ready={Boolean(connection && ready && status !== "missing")} onToggle={() => toggleTalk(pageFieldKey(page.id))} />
          <button type="button" aria-label="Version history" title="Version history" className={cn(ICON_BUTTON, "max-md:hidden")} onClick={() => setDialog("history")}>
            <Icon name="Clock" className="size-4" />
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
                  <Icon name="Clock" className="size-4" /> Version history…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void rpc.call("pages.markdown", { id: page.id }).then((result) => navigator.clipboard.writeText(result.markdown))}
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
      </WhiteboardExpandHost>
    </div>
  );
}
