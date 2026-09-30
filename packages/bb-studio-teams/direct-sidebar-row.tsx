import { useRef, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { Bot, Conversation, DirectThreadInfo, DirectThreadView } from "./contract";
import { DirectMessageStatus } from "./bot-direct-chat";
import { message } from "./bot-ui";
import { isThreadSplitClick, threadLinkPath, useOpenThreadInSplit } from "./thread-split-navigation";
import { useSidebarInlineRename } from "./sidebar-inline-rename";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";

const botPages = [
  ["profile", "View profile", "UserRound"],
  ["mission", "View mission", "Target"],
  ["memory", "View memory", "Brain"],
  ["activity", "View activity", "Activity"],
] as const;

/** One direct thread. The bot rides on the row, so the list needs no bot headings. */
export function DirectSidebarThread({
  bot,
  conversation,
  info,
  status,
  onNavigate,
  onNewThread,
  onChanged,
  selected,
}: {
  bot: Bot;
  conversation: Conversation;
  info: DirectThreadInfo;
  status?: DirectThreadView;
  onNavigate: () => void;
  onNewThread: () => void;
  onChanged: () => void;
  selected: boolean;
}) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const rowLink = useRef<HTMLAnchorElement>(null);
  const openThreadInSplit = useOpenThreadInSplit(conversation.threadId);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const title = info.title || conversation.title || "Direct message";
  // An untitled thread is named for its bot; the muted bot label would only repeat it.
  const untitled = /^direct message$/i.test(title.trim());
  const label = untitled ? bot.name : title;
  const rename = useSidebarInlineRename({
    name: title,
    label: "Thread name",
    onSave: async (next) => {
      await sdk.threads.update({ threadId: conversation.threadId, title: next });
      onChanged();
    },
  });
  const archived = info.archivedAt !== null;
  const href = threadLinkPath(info.projectId, conversation.threadId);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
      onChanged();
    } catch (cause) {
      setError(message(cause));
    }
  };
  const open = () => {
    navigate.toThread(conversation.threadId);
    onNavigate();
  };
  const archive = () => void run(async () => {
    if (archived) {
      await sdk.threads.unarchive({ threadId: conversation.threadId });
      return;
    }
    const { nonDeletedChildCount } = await sdk.threads.childSummary({
      threadId: conversation.threadId,
    });
    if (nonDeletedChildCount) {
      if (!window.confirm(`Archive “${title}” and its ${nonDeletedChildCount} child threads?`))
        return;
      await sdk.threads.archiveAll({ threadId: conversation.threadId });
      return;
    }
    await sdk.threads.archive({ threadId: conversation.threadId });
  });
  const loadSections = () => {
    void sdk.threadSections.list().then(setSections, (cause) => setError(message(cause)));
  };
  const menuItems = (surface: "context" | "dropdown") => {
    const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
    const Separator = surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
    const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
    const SubTrigger = surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
    const SubContent = surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
    return <>
      {!bot.retired && <>
        <Item onSelect={onNewThread}><Icon name="Plus" /> New thread with {bot.name}</Item>
        <Separator />
      </>}
      <Item onSelect={() => {
        openThreadInSplit(rowLink.current);
        onNavigate();
      }}>
        <Icon name="Columns2" /> Open in split
      </Item>
      <Separator />
      <Item onSelect={() => void run(() => navigator.clipboard.writeText(
        new URL(href, window.location.origin).href,
      ))}>
        <Icon name="Copy" /> Copy thread link
      </Item>
      <Item onSelect={() => void run(() => info.unread
        ? sdk.threads.markRead({ threadId: conversation.threadId })
        : sdk.threads.markUnread({ threadId: conversation.threadId }))}>
        <Icon name={info.unread ? "MailOpen" : "Mail"} />
        {info.unread ? "Mark read" : "Mark unread"}
      </Item>
      <Item onSelect={() => void run(() => info.pinned
        ? sdk.threads.unpin({ threadId: conversation.threadId })
        : sdk.threads.pin({ threadId: conversation.threadId }))}>
        <Icon name={info.pinned ? "PinOff" : "Pin"} />
        {info.pinned ? "Unpin" : "Pin"}
      </Item>
      {!archived && <Sub>
        <SubTrigger><Icon name="Layers" /> Move to section</SubTrigger>
        <SubContent>
          <Item disabled={info.sectionId === null}
            onSelect={() => void run(() => sdk.threads.update({
              threadId: conversation.threadId, sectionId: null,
            }))}>Threads</Item>
          {sections.map((section) => <Item key={section.id}
            disabled={info.sectionId === section.id}
            onSelect={() => void run(() => sdk.threads.update({
              threadId: conversation.threadId, sectionId: section.id,
            }))}>{section.name}</Item>)}
        </SubContent>
      </Sub>}
      <Item onSelect={rename.startFromMenu}><Icon name="Edit" /> Rename</Item>
      <Sub>
        <SubTrigger><Icon name="Bot" /> {bot.name}</SubTrigger>
        <SubContent>
          {botPages.map(([tab, label, icon]) => <Item key={tab} onSelect={() => {
            navigate.toPluginPanel("bots", { subPath: `${bot.id}/${tab}` });
            onNavigate();
          }}><Icon name={icon} /> {label}</Item>)}
        </SubContent>
      </Sub>
      <Separator />
      <Item onSelect={archive}>
        <Icon name={archived ? "RotateCcw" : "Archive"} />
        {archived ? "Unarchive" : "Archive"}
      </Item>
      <Item className="text-destructive focus:text-destructive"
        onSelect={() => void run(async () => {
          const { nonDeletedChildCount } = await sdk.threads.childSummary({
            threadId: conversation.threadId,
          });
          const detail = nonDeletedChildCount
            ? ` and its ${nonDeletedChildCount} child threads`
            : "";
          if (!window.confirm(`Delete “${title}”${detail}? This cannot be undone.`)) return;
          await sdk.threads.delete({
            threadId: conversation.threadId,
            childThreadsConfirmed: nonDeletedChildCount > 0,
          });
        })}>
        <Icon name="Trash2" /> Delete
      </Item>
    </>;
  };
  return <>
    <ContextMenu onOpenChange={(open) => { if (open) loadSections(); }}>
      <ContextMenuTrigger asChild>
        <div className="direct-thread-nav-row" data-sidebar-thread-id={conversation.threadId}>
          {rename.editing ? <span className="channel-nav-row direct-thread-nav-link">
            {rename.editor}
          </span> : <a ref={rowLink} href={href} className="channel-nav-row direct-thread-nav-link"
            data-sidebar-thread-id={conversation.threadId}
            aria-current={selected ? "page" : undefined}
            title={untitled ? bot.name : `${title} · ${bot.name}`}
            onClick={(event) => {
              if (isThreadSplitClick(event.nativeEvent)) return;
              if (event.shiftKey || event.altKey) return;
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                openThreadInSplit(rowLink.current);
                onNavigate();
                return;
              }
              event.preventDefault();
              open();
            }}>
            <span className="direct-thread-avatar" aria-hidden>{bot.avatar}</span>
            <span className="channel-nav-name">{label}</span>
            {!untitled && <span className="direct-thread-bot">{bot.name}</span>}
            {archived && <span className="channel-nav-archived">Archived</span>}
            {status && !archived && <DirectMessageStatus thread={status} />}
            {!status && !archived && info.unread && !selected &&
              <span className="channel-unread-dot" role="img" aria-label="Unread direct message" />}
          </a>}
          <button type="button" className="direct-thread-options direct-thread-archive"
            aria-label={`${archived ? "Unarchive" : "Archive"} ${title}`}
            onClick={archive}>
            <Icon name={archived ? "RotateCcw" : "Archive"} />
          </button>
          <DropdownMenu onOpenChange={(open) => { if (open) loadSections(); }}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="direct-thread-options direct-thread-menu-trigger"
                aria-label={`${title} options`}>
                <Icon name="MoreHorizontal" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={`${title} options`}
              onCloseAutoFocus={rename.onCloseAutoFocus}>
              {menuItems("dropdown")}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} options`}
        onCloseAutoFocus={rename.onCloseAutoFocus}>{menuItems("context")}</ContextMenuContent>
    </ContextMenu>
    {error && <p role="alert" className="channel-menu-label">{error}</p>}
  </>;
}
