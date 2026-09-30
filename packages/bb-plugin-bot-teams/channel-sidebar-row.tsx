import { useId, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Room, RoomWork, ThreadStatusView } from "./contract";
import { isThreadSplitClick, useOpenThreadInSplit } from "./thread-split-navigation";
import { ChannelStatusIcon, useChannelStatus } from "./channel-status-view";
import { IconActionTooltip } from "./channel-controls";
import { useSidebarInlineRename } from "./sidebar-inline-rename";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./components/ui/context-menu";

function openOptions(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left,
      clientY: rect.bottom,
    }),
  );
}

export function ChannelSidebarRow({
  room,
  selected,
  active,
  threads,
  work,
  attentionCount = 0,
  approvalCount = 0,
  pending,
  onOpen,
  onNavigate,
  onMarkRead,
  onPin,
  onRename,
  onCopyLink,
  onCopyId,
  onArchive,
  onDelete,
}: {
  room: Room;
  selected: boolean;
  active: boolean;
  threads: readonly ThreadStatusView[];
  work?: RoomWork;
  attentionCount?: number;
  /** Bot requests waiting for an approval or answer in this channel. */
  approvalCount?: number;
  pending: boolean;
  onOpen: () => void;
  onNavigate: () => void;
  onMarkRead: () => void;
  onPin: () => void;
  onRename: (name: string) => Promise<unknown>;
  onCopyLink: () => void;
  onCopyId: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rename = useSidebarInlineRename({
    name: room.name,
    label: "Channel name",
    onSave: onRename,
  });
  const rowLink = useRef<HTMLAnchorElement>(null);
  const openThreadInSplit = useOpenThreadInSplit(room.threadId ?? "");
  const menuId = useId();
  const hasUnread = room.updatedAt > (room.lastReadAt ?? 0);
  const unread = hasUnread && !selected;
  const status = useChannelStatus({ roomId: room.id, threadId: room.threadId, threads, work, active, unread,
    needsAttention: attentionCount + approvalCount > 0 });
  const openInSplit = () => {
    if (!room.threadId) return;
    openThreadInSplit(rowLink.current);
    onNavigate();
  };
  const waitingLabel = [
    attentionCount > 0 &&
      `${attentionCount} ${attentionCount === 1 ? "request needs" : "requests need"} your attention`,
    approvalCount > 0 &&
      `${approvalCount} waiting for your approval`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          className="channel-sidebar-row"
          data-selected={selected || undefined}
          onKeyDown={(event) => {
            if (
              event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10")
            )
              return;
            event.preventDefault();
            openOptions(event.target as HTMLElement);
          }}
        >
          {rename.editing ? <span className="channel-nav-row channel-sidebar-rename-row">
            <span className="channel-hash" aria-hidden>#</span>
            {rename.editor}
          </span> : <a
            ref={rowLink}
            href={room.threadId ? `/threads/${room.threadId}` : `/plugins/bot-teams/channels/${room.id}`}
            className="channel-nav-row"
            aria-current={selected ? "page" : undefined}
            onClick={(event) => {
              if (isThreadSplitClick(event.nativeEvent)) return;
              if (event.shiftKey || event.altKey) return;
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                openInSplit();
                return;
              }
              event.preventDefault();
              onOpen();
            }}
          >
            {waitingLabel ? (
              <span className="channel-needs-attention" role="img"
                aria-label={waitingLabel}
                title={waitingLabel}>
                <Icon name="BellDot" />
              </span>
            ) : room.pinned ? (
              <Icon name="Pin" />
            ) : (
              <span className="channel-hash" aria-hidden>
                #
              </span>
            )}
            <span className="channel-nav-name">{room.name}</span>
            {room.archived && <span className="channel-nav-archived">Archived</span>}
            <ChannelStatusIcon status={status} />
          </a>}
          <span className="channel-nav-actions">
            <IconActionTooltip label="Channel options">
              <button
                type="button"
                className="channel-nav-action"
                aria-label={`${room.name} options`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={(event) => openOptions(event.currentTarget)}
              >
                <Icon name="MoreHorizontal" />
              </button>
            </IconActionTooltip>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent id={menuId} aria-label={`${room.name} options`}
        onCloseAutoFocus={rename.onCloseAutoFocus}>
        <ContextMenuItem disabled={!room.threadId} onSelect={openInSplit}>
          <Icon name="PanelRight" />
          Open in split
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCopyLink}>
          <Icon name="Link" />
          Copy channel link
        </ContextMenuItem>
        <ContextMenuItem disabled={pending} onSelect={onMarkRead}>
          <Icon name={hasUnread ? "MailOpen" : "Mail"} />
          {hasUnread ? "Mark read" : "Mark unread"}
        </ContextMenuItem>
        <ContextMenuItem disabled={pending} onSelect={onPin}>
          <Icon name="Pin" />
          {room.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={rename.startFromMenu}>
          <Icon name="Edit" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCopyId}>
          <Icon name="Copy" />
          Copy channel ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={pending} onSelect={onArchive}>
          <Icon name={room.archived ? "RotateCcw" : "Archive"} />
          {room.archived ? "Restore" : "Archive"}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onDelete}
        >
          <Icon name="Trash2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    </>
  );
}
