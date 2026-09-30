import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useBbNavigate,
  useBbContext,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  experimental_Icon as Icon,
  type PluginNavPanelProps,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarDisplayMenuItems,
  SidebarGroupHeading,
  SidebarNote,
  SidebarPortal,
  SidebarSection,
  useExpandSidebarSection,
  useSidebarDisplay,
  useSidebarHosted,
  useSidebarNavigated,
  type SidebarDisplay,
} from "@bb-studio/kit/app";
import type {
  Bot,
  Conversation,
  DirectThreadInfo,
  Room,
  rpcContract,
  DirectThreadView,
  RoomWork,
  ThreadStatusView,
} from "./contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { sharedReads } from "./shared-read";
import { ErrorMessage, message } from "./bot-ui";
import { ChannelSidebarRow } from "./channel-sidebar-row";
import { DirectSidebarThread } from "./direct-sidebar-row";
import { channelLinkDestination } from "./channel-links";
import { mentionBotId } from "./mentions";
import { Modal } from "./channel-controls";

const uuid = /^[a-f0-9-]{36}$/;
const channelId = (subPath: string) =>
  uuid.test(subPath.split("/")[0] ?? "") ? subPath.split("/")[0]! : null;
const directMessageBotId = (subPath: string) => {
  const [kind, id] = subPath.split("/");
  return kind === "dm" && /^bot_[a-f0-9]{16}$/.test(id ?? "") ? id! : null;
};
function useRoster(reconcile = false) {
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [data, setData] = useState<{
    bots: Bot[];
    rooms: Room[];
    activeRoomIds: string[];
    directThreads: Record<string, DirectThreadView>;
    directConversations: Record<string, Conversation[]>;
    directThreadInfo: Record<string, DirectThreadInfo>;
    roomThreads: Record<string, ThreadStatusView[]>;
    roomWork: Record<string, RoomWork>;
    attentionCounts: Record<string, number>;
    approvalCounts: Record<string, number>;
  }>({
    bots: [],
    rooms: [],
    activeRoomIds: [],
    directThreads: {},
    directConversations: {},
    directThreadInfo: {},
    roomThreads: {},
    roomWork: {},
    attentionCounts: {},
    approvalCounts: {},
  });
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    sharedReads
      .read("roster", () => rpc.call("list"))
      .then(
        (d) => {
          if (seq === request.current) {
            setData(d);
            setError(null);
          }
        },
        (e) => {
          if (seq === request.current) setError(message(e));
        },
      );
  }, [rpc]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("changed", (event) => {
    sharedReads.invalidate(
      event && typeof event === "object" && "revision" in event
        ? event.revision
        : undefined,
    );
    void load();
  });
  useEffect(() => {
    if (reconcile && connectionState === "connected") load();
  }, [reconcile, connectionState, load]);
  const hasActiveWork = data.activeRoomIds.length > 0 ||
    Object.values(data.directThreads).some((thread) =>
      ["starting", "active", "stopping"].includes(thread.status) ||
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator)) ||
    Object.values(data.roomThreads).flat().some((thread) =>
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator));
  useEffect(() => {
    if (!reconcile) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") load();
    };
    const timer = window.setInterval(refresh, hasActiveWork ? 2_500 : 15_000);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reconcile, hasActiveWork, load]);
  return { ...data, error, load };
}
export function ChannelLinkNavigation() {
  const { rooms } = useRoster();
  const navigate = useBbNavigate();
  useEffect(() => {
    const knownChannelIds = new Set(rooms.map((room) => room.id));
    const restoreLegacyLink = () => {
      if (!window.location.pathname.startsWith("/plugins/bots/channels/"))
        return;
      const destination = channelLinkDestination(
        window.location.href,
        window.location.origin,
        knownChannelIds,
      );
      if (destination)
        navigate.toPluginPanel("channels", {
          subPath: destination,
          replace: true,
        });
    };
    restoreLegacyLink();
    window.addEventListener("popstate", restoreLegacyLink);
    const openLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      const botId = mentionBotId(href);
      if (botId) {
        event.preventDefault();
        event.stopPropagation();
        navigate.toPluginPanel("bots", { subPath: `${botId}/profile` });
        return;
      }
      const destination = channelLinkDestination(
        href,
        window.location.origin,
        knownChannelIds,
      );
      if (!destination) return;
      event.preventDefault();
      event.stopPropagation();
      // The route resolves the channel's thread; message links open the channel.
      navigate.toPluginPanel("channels", { subPath: destination });
    };
    document.addEventListener("click", openLink, true);
    return () => {
      document.removeEventListener("click", openLink, true);
      window.removeEventListener("popstate", restoreLegacyLink);
    };
  }, [rooms, navigate]);
  return null;
}
export function ChannelRedirect({ subPath }: { subPath?: string }) {
  const navigate = useBbNavigate();
  useEffect(
    () =>
      navigate.toPluginPanel("channels", {
        subPath: subPath ?? "new",
        replace: true,
      }),
    [navigate, subPath],
  );
  return null;
}
/**
 * Channels and Direct messages, as two sections of the Studio Sidebar above
 * the threads. Without Studio Sidebar as the thread list they don't show; the
 * Channels and Bots panels still reach everything.
 */
export function TeamsSidebar() {
  const hosted = useSidebarHosted();
  const { threadId } = useBbContext();
  const navigated = useSidebarNavigated();
  return hosted ? <ChannelsSidebar activeThreadId={threadId ?? null} onNavigate={navigated} /> : null;
}

type ChannelOrganization = "pinned" | "activity" | "none";
type ChannelSort = "updated" | "created" | "alpha";
type ChannelDisplay = SidebarDisplay<ChannelOrganization, ChannelSort>;
const channelDisplayKey = "bb:bots:channel-sidebar-display";
const defaultChannelDisplay: ChannelDisplay = {
  organization: "pinned",
  sort: "updated",
  direction: "descending",
};
const channelDisplayOptions = {
  organization: ["pinned", "activity", "none"],
  sort: ["updated", "created", "alpha"],
} as const;

function compareChannels(a: Room, b: Room, display: ChannelDisplay): number {
  const order = display.direction === "ascending" ? 1 : -1;
  const comparison = display.sort === "alpha"
    ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    : display.sort === "created"
      ? a.createdAt - b.createdAt
      : a.updatedAt - b.updatedAt;
  return comparison * order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function ChannelsSidebar({
  onNavigate,
  activeThreadId,
}: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) {
  const { bots, rooms, activeRoomIds, directThreads, directConversations, directThreadInfo, roomThreads, roomWork,
    attentionCounts, approvalCounts, error, load } =
      useRoster(true),
    rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [channelSearch, setChannelSearch] = useState(""),
    [directSearch, setDirectSearch] = useState(""),
    [channelSearching, setChannelSearching] = useState(false),
    [directSearching, setDirectSearching] = useState(false),
    [archived, setArchived] = useState(false),
    [showArchivedBots, setShowArchivedBots] = useState(false),
    [showArchivedDirectThreads, setShowArchivedDirectThreads] = useState(false),
    [display, updateDisplay] = useSidebarDisplay(channelDisplayKey, defaultChannelDisplay, channelDisplayOptions),
    [renaming, setRenaming] = useState<Room | null>(null),
    [deleting, setDeleting] = useState<Room | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const expandChannels = useExpandSidebarSection("channels");
  const expandDirect = useExpandSidebarSection("direct-messages");
  const archive = async (room: Room) => {
    setPending(true);
    setFailure(null);
    try {
      await rpc.call("channelState", { id: room.id, archived: !room.archived });
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  const changeChannelState = async (id: string, patch: {
    pinned?: boolean;
    lastReadAt?: number;
    markUnread?: boolean;
  }) => {
    setPending(true);
    setFailure(null);
    try {
      await rpc.call("channelState", { id, ...patch });
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  const copyChannelId = async (id: string) => {
    setFailure(null);
    try {
      await navigator.clipboard.writeText(id);
    } catch (e) {
      setFailure(`Could not copy channel ID: ${message(e)}`);
    }
  };
  const copyChannelLink = async (id: string) => {
    setFailure(null);
    try {
      await navigator.clipboard.writeText(
        new URL(`/plugins/bot-teams/channels/${id}`, window.location.origin).href,
      );
    } catch (e) {
      setFailure(`Could not copy channel link: ${message(e)}`);
    }
  };
  const open = (id: string) => {
    setFailure(null);
    void rpc.call("openChannelThread", { id }).then(
      ({ threadId }) => {
        navigate.toThread(threadId);
        onNavigate();
      },
      (e) => setFailure(message(e)),
    );
  };
  const channelQuery = channelSearch.trim().toLowerCase();
  const directQuery = directSearch.trim().toLowerCase();
  // One flat list: every visible direct thread, newest activity first, with its bot on the row.
  const directRows = bots
    .filter((bot) => showArchivedBots || !bot.retired)
    .flatMap((bot) => (directConversations[bot.id] ?? []).flatMap((conversation) => {
      const info = directThreadInfo[conversation.threadId];
      if (!info || (!showArchivedDirectThreads && info.archivedAt)) return [];
      const haystack = `${info.title} ${bot.name} @${bot.handle}`.toLowerCase();
      return haystack.includes(directQuery) ? [{ bot, conversation, info }] : [];
    }))
    .sort((a, b) => b.info.updatedAt - a.info.updatedAt ||
      a.info.title.localeCompare(b.info.title));
  const startDirectThread = async (bot: Bot) => {
    setPending(true);
    setFailure(null);
    try {
      const conversation = await rpc.call("newConversation", { id: bot.id });
      navigate.toThread(conversation.threadId);
      onNavigate();
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setPending(false);
    }
  };
  const list = rooms
    .filter(
      (r) =>
        (channelQuery ? true : !!r.archived === archived) &&
        r.name.toLowerCase().includes(channelQuery),
    )
    .sort((a, b) =>
      (display.organization === "pinned"
        ? Number(!!b.pinned) - Number(!!a.pinned)
        : 0) || compareChannels(a, b, display),
    );
  const needsInput = (id: string) =>
    (attentionCounts[id] ?? 0) + (approvalCounts[id] ?? 0) > 0 ||
    (roomThreads[id] ?? []).some((thread) =>
      ["waiting-for-input", "unread-error", "queued-failed"].includes(thread.indicator));
  const working = (id: string) => activeRoomIds.includes(id) ||
    (roomThreads[id] ?? []).some((thread) =>
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator));
  const groups: { label: string | null; rooms: Room[] }[] =
    display.organization === "activity"
      ? [
          { label: "Needs you", rooms: list.filter((r) =>
            needsInput(r.id)) },
          { label: "Working", rooms: list.filter((r) =>
            !needsInput(r.id) && working(r.id)) },
          { label: "Other channels", rooms: list.filter((r) =>
            !needsInput(r.id) && !working(r.id)) },
        ].filter((group) => group.rooms.length > 0)
      : [{ label: null, rooms: list }];
  return (
    <>
      <SidebarPortal id="channels" title="Channels" order={10}>
        <SidebarSection
          title="Channels"
          label={archived ? "Archived channels" : "Channels"}
          menuLabel="Channel list options"
          actions={[
            {
              label: "Search channels",
              icon: "Search",
              pressed: channelSearching,
              onClick: () => {
                setChannelSearching(!channelSearching);
                setChannelSearch("");
                expandChannels();
              },
            },
            {
              label: "New channel",
              icon: "Plus",
              onClick: () => {
                // "new" is a panel route, not a channel ID; CreateChannel makes the room.
                setFailure(null);
                navigate.toPluginPanel("channels", { subPath: "new" });
                onNavigate();
              },
            },
          ]}
          menu={
            <>
              <SidebarDisplayMenuItems
                noun="channels"
                display={display}
                onChange={updateDisplay}
                organize={[
                  ["pinned", "Pinned first"],
                  ["activity", "By activity"],
                  ["none", "No grouping"],
                ]}
                sort={[
                  ["updated", "Updated at", "descending"],
                  ["created", "Created at", "descending"],
                  ["alpha", "Alphabetical", "ascending"],
                ]}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                aria-label={archived ? "Show active channels" : "Show archived channels"}
                onSelect={() => {
                  setArchived(!archived);
                  setChannelSearch("");
                  expandChannels();
                }}
              >
                <Icon name={archived ? "ListView" : "Archive"} />
                {archived ? "Show active channels" : "Show archived channels"}
              </DropdownMenuItem>
            </>
          }
        >
          <div className="channels-sidebar-body">
            {channelSearching && (
              <Input
                autoFocus
                aria-label="Search channels"
                placeholder="Search channels…"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
              />
            )}
            {error && <ErrorMessage error={error} />}
            <ErrorMessage error={failure} />
            {groups.map((group) => (
              <div key={group.label ?? "all"} className="channels-sidebar-group">
                {group.label && <SidebarGroupHeading>{group.label}</SidebarGroupHeading>}
                {group.rooms.map((r) => (
                  <ChannelSidebarRow
                    key={r.id}
                    room={r}
                    selected={!!activeThreadId && r.threadId === activeThreadId}
                    active={activeRoomIds.includes(r.id)}
                    threads={roomThreads[r.id] ?? []}
                    work={roomWork[r.id]}
                    attentionCount={attentionCounts[r.id] ?? 0}
                    approvalCount={approvalCounts[r.id] ?? 0}
                    pending={pending}
                    onOpen={() => open(r.id)}
                    onNavigate={onNavigate}
                    onMarkRead={() => void changeChannelState(r.id,
                      r.updatedAt > (r.lastReadAt ?? 0)
                        ? { lastReadAt: r.updatedAt }
                        : { markUnread: true })}
                    onPin={() => void changeChannelState(r.id, { pinned: !r.pinned })}
                    onRename={(name) => rpc.call("updateRoom", { id: r.id, name })}
                    onCopyLink={() => void copyChannelLink(r.id)}
                    onCopyId={() => void copyChannelId(r.id)}
                    onArchive={() => void archive(r)}
                    onDelete={() => setDeleting(r)}
                  />
                ))}
              </div>
            ))}
            {!list.length && (
              <SidebarNote>
                {channelQuery
                  ? "No matching channels"
                  : archived
                    ? "No archived channels"
                    : "No active channels"}
              </SidebarNote>
            )}
          </div>
        </SidebarSection>
      </SidebarPortal>
      <SidebarPortal id="direct-messages" title="Direct messages" order={20}>
        <SidebarSection
          title="Direct messages"
          menuLabel="Direct message list options"
          actions={[
            {
              label: "Search direct messages",
              icon: "Search",
              pressed: directSearching,
              onClick: () => {
                setDirectSearching(!directSearching);
                setDirectSearch("");
                expandDirect();
              },
            },
          ]}
          trailing={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="teams-sidebar-control" aria-label="New direct message" title="New direct message">
                  <Icon name="Plus" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" aria-label="Choose a bot">
                {bots.filter((bot) => !bot.retired).sort((a, b) =>
                  a.name.localeCompare(b.name)).map((bot) => (
                  <DropdownMenuItem key={bot.id} disabled={pending}
                    onSelect={() => void startDirectThread(bot)}>
                    {bot.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          }
          menu={
            <>
              <DropdownMenuItem
                aria-label={showArchivedDirectThreads ? "Hide archived threads" : "Show archived threads"}
                onSelect={() => {
                  setShowArchivedDirectThreads(!showArchivedDirectThreads);
                  expandDirect();
                }}>
                <Icon name="Archive" />
                {showArchivedDirectThreads ? "Hide archived threads" : "Show archived threads"}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={showArchivedBots ? "Hide archived bots" : "Show archived bots"}
                onSelect={() => {
                  setShowArchivedBots(!showArchivedBots);
                  expandDirect();
                }}>
                <Icon name={showArchivedBots ? "ListView" : "Archive"} />
                {showArchivedBots ? "Hide archived bots" : "Show archived bots"}
              </DropdownMenuItem>
            </>
          }
        >
          <div className="channels-sidebar-body">
            {directSearching && (
              <Input autoFocus aria-label="Search direct messages"
                placeholder="Search direct messages…" value={directSearch}
                onChange={(event) => setDirectSearch(event.target.value)} />
            )}
            {directRows.map(({ bot, conversation, info }) => (
              <DirectSidebarThread key={conversation.threadId} bot={bot}
                conversation={conversation} info={info}
                status={directThreads[bot.id]?.threadId === conversation.threadId
                  ? directThreads[bot.id] : undefined}
                onNavigate={onNavigate} onNewThread={() => void startDirectThread(bot)}
                onChanged={load} selected={activeThreadId === conversation.threadId} />
            ))}
            {!directRows.length && <SidebarNote>
              {directQuery ? "No matching direct messages" : "No direct messages yet"}
            </SidebarNote>}
          </div>
        </SidebarSection>
      </SidebarPortal>
      {renaming && (
        <RenameChannel
          key={renaming.id}
          room={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteChannel room={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
function DeleteChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Delete channel?"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <div className="bot-form">
        <p className="text-sm leading-5">
          Permanently delete <strong>{room.name}</strong>, its thread, messages,
          and channel activity? This stops unfinished responses. Your
          bots and their workspaces are kept. This cannot be undone.
        </p>
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            autoFocus
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await rpc.call("deleteRoom", { id: room.id });
                localStorage.removeItem(`bb:bots:draft:${room.id}`);
                onClose();
              } catch (e) {
                setError(message(e));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : "Delete channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function RenameChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [name, setName] = useState(room.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Rename channel"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <form
        className="bot-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !name.trim()) return;
          setPending(true);
          setError(null);
          try {
            await rpc.call("updateRoom", { id: room.id, name: name.trim() });
            onClose();
          } catch (e) {
            setError(message(e));
          } finally {
            setPending(false);
          }
        }}
      >
        <Input
          autoFocus
          aria-label="Channel name"
          required
          maxLength={80}
          value={name}
          disabled={pending}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
        />
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
// BB owns tab selection, persistence, resizing, splits, and the compact drawer.
function CreateChannel() {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const opening = useRef<Promise<{ threadId: string }> | null>(null);
  const [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the request if React replays the effect while mounting.
    opening.current ??= rpc
      .call("createRoom", { memberIds: [] })
      .then((room) => rpc.call("openChannelThread", { id: room.id }));
    opening.current.then(
      ({ threadId }) => {
        if (active) navigate.toThread(threadId);
      },
      (e) => {
        if (active) setError(message(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, rpc, navigate]);
  return (
    <div className="bot-page">
      {error ? (
        <>
          <ErrorMessage error={error} />
          <Button
            onClick={() => {
              opening.current = null;
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <p role="status">Opening channel…</p>
      )}
    </div>
  );
}
/**
 * Channels are BB threads. This route only resolves the stable channel links
 * (`/plugins/bot-teams/channels/<id>`, message links, and old DM links) to
 * the thread that now holds the conversation.
 */
export function ChannelsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const id = channelId(subPath);
  const botId = directMessageBotId(subPath);
  const threadId = /^thread\/(thr_[a-z0-9]+)$/.exec(subPath)?.[1] ?? null;
  useEffect(() => {
    if (threadId) {
      navigate.toThread(threadId);
      return;
    }
    if (!id && !botId) return;
    let active = true;
    const target = botId
      ? rpc.call("conversation", { id: botId }).then((c) => c.threadId)
      : rpc.call("openChannelThread", { id: id! }).then((c) => c.threadId);
    target.then(
      (threadId) => active && navigate.toThread(threadId),
      (e) => active && setError(message(e)),
    );
    return () => {
      active = false;
    };
  }, [id, botId, threadId, rpc, navigate]);
  if (!id && !botId && !threadId) {
    if (!subPath || subPath === "new") return <CreateChannel />;
    return <div className="bot-page"><ErrorMessage error="Invalid channel link." /></div>;
  }
  return (
    <div className="bot-page">
      {error ? <ErrorMessage error={error} /> : <p role="status">Opening…</p>}
    </div>
  );
}
