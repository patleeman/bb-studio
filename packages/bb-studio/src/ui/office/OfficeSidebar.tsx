// The sidebar below the navigation shows what's active, not everything: who
// you work with (Team faces and conversations), what you return to
// (Favorites), and recent work by folder. A thread is active while it runs,
// waits on you, is unread, or was touched this week; an item, while it was
// touched this week. Everything else lives in the Library. Closing a row hides
// it until it changes again. Threads a bot or automation started never show
// here; they live under the bot's task and reach you through the Inbox.
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon, openAppPath, studioPath } from "@bb-studio/kit/app";
import { useMemo, useState, type ReactNode } from "react";
import { Face, FaceStack } from "./Face";
import { externalAgentName, useExternalHealth } from "./external";
import { ThreadMenu } from "./ThreadMenu";
import { RowMenu, useItemActions } from "./RowMenus";
import { Hint, ProviderBadge } from "./ProviderBadge";
import { usePathname } from "./location";
import { itemRef, useLive, useSpaces, useSpaceTree, useTeam, type Conversation, type TeamBot, type TreeFolder, type TreeItem } from "./model";
import { currentOfficeSubPath, openOffice } from "./routes";
import { ROW, ROW_ACTIVE, ROW_GLYPH, ROW_HOVER_BUTTON, ROW_LABEL, SECTION_ACTION, SECTION_HEADER, cn } from "./styles";

const FOLDER_PREVIEW = 8;
// "pending" is work queued for later (a scheduled send), not work in progress.
const RUNNING = new Set(["active", "waiting-for-host", "host-reconnecting"]);
const BACKGROUND_ORIGINS = new Set(["bot-teams", "automations", "studio"]);

export const KIND_ICONS: Record<string, string> = {
  thread: "MessageSquare",
  page: "FileText",
  board: "GridView",
  task: "CircleCheck",
  table: "ListView",
  drawing: "Palette",
  recording: "Mic",
  dictation: "Mic",
  artifact: "PackageReceive",
};

/** True for threads you started yourself, at the top level. */
export function isMyThread(thread: PluginSidebarThread): boolean {
  if (thread.isHidden || thread.isArchived) return false;
  if (thread.parentThreadId || thread.lifecycleOwnerThreadId) return false;
  return !(thread.originPluginId && BACKGROUND_ORIGINS.has(thread.originPluginId));
}

type Row =
  | { type: "thread"; at: number; thread: PluginSidebarThread }
  | { type: "item"; at: number; item: TreeItem };

/** Kinds kept out of folders: tasks live on their boards and Home, dictations in All items. */
const HIDDEN_KINDS = new Set(["task", "dictation", "bot", "view", "space"]);

/** How long untouched work stays in the sidebar. */
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function threadIsLive(thread: PluginSidebarThread): boolean {
  return RUNNING.has(thread.runtimeStatus) || thread.runtimeStatus === "pending" || thread.hasPendingInteraction || thread.isUnread;
}

export function rowKey(row: Row): string {
  return row.type === "thread" ? `thread:${row.thread.id}` : `item:${itemRef(row.item)}`;
}

/** A folder's active rows, newest first: live or recent threads and recent items, minus closed ones. */
export function folderRows(folder: TreeFolder, threads: readonly PluginSidebarThread[], closed: Record<string, number> = {}, now = Date.now()): Row[] {
  const rows: Row[] = [
    ...threads.filter((thread) => thread.projectId === folder.id && isMyThread(thread) && !thread.isPinned)
      .map((thread) => ({ type: "thread" as const, at: Math.max(thread.updatedAt, thread.latestAttentionAt), thread })),
    ...folder.items.filter((item) => !HIDDEN_KINDS.has(item.kind) && item.title.trim() && item.title !== "Untitled").map((item) => ({ type: "item" as const, at: item.updatedAt, item })),
  ];
  return rows
    .filter((row) => (row.type === "thread" && threadIsLive(row.thread)) || now - row.at < ACTIVE_WINDOW_MS)
    .filter((row) => !(closed[rowKey(row)] && closed[rowKey(row)]! >= row.at))
    .sort((a, b) => b.at - a.at);
}

// Rows the user closed, with when; a row comes back once it changes after that.
const CLOSED_KEY = "bb-studio.office.closed-rows";
function readClosed(): Record<string, number> {
  try { return JSON.parse(globalThis.localStorage?.getItem(CLOSED_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Close ${label}`}
      title="Close (hide until it changes)"
      onClick={(event) => { event.stopPropagation(); onClose(); }}
      className={cn(ROW_HOVER_BUTTON, "absolute top-1/2 right-7 -translate-y-1/2 group-hover/thread:flex group-hover/rowmenu:flex")}
    >
      <Icon name="X" aria-hidden />
    </button>
  );
}

// Which folders are open, kept per browser.
const OPEN_KEY = "bb-studio.office.open-folders";
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(globalThis.localStorage?.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-3 first:mt-1">
      <h2 className={SECTION_HEADER}>{title}{action}</h2>
      <div className="space-y-px">{children}</div>
    </section>
  );
}

function ThreadRow(props: { thread: PluginSidebarThread; active: boolean; indent?: boolean; onOpen: (id: string) => void; onClose?: () => void }) {
  return (
    <ThreadMenu thread={props.thread}>
      {(editor) => editor ?? <>
        <ThreadButton {...props} />
        {props.onClose ? <CloseButton label={props.thread.displayTitle} onClose={props.onClose} /> : null}
      </>}
    </ThreadMenu>
  );
}

function ThreadButton({ thread, active, indent, onOpen }: { thread: PluginSidebarThread; active: boolean; indent?: boolean; onOpen: (id: string) => void }) {
  const running = RUNNING.has(thread.runtimeStatus);
  return (
    // Threads carry no kind icon, as in BB's own sidebar: the glyph slot shows
    // their state instead. Items always show a kind icon, so the two read apart.
    <button type="button" onClick={() => onOpen(thread.id)} aria-current={active ? "page" : undefined} className={cn(ROW, indent && "pl-7", active && ROW_ACTIVE, "group-hover/thread:pr-14")}>
      <span className={ROW_GLYPH}>
        {thread.hasPendingInteraction
          ? <span aria-label="Needs you" className="size-2 rounded-full bg-warning-foreground" />
          : running
            ? <span aria-label="Running" className="size-3 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />
            : thread.runtimeStatus === "pending"
              ? <Icon name="Clock" aria-label="Scheduled" className="!size-3.5" />
              : thread.isUnread
                ? <span aria-label="Unread" className="size-1.5 rounded-full bg-foreground" />
                : <span aria-hidden className="size-1 rounded-full bg-muted-foreground/30" />}
      </span>
      <span className={cn(ROW_LABEL, thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
    </button>
  );
}

function ItemRow(props: { item: TreeItem; author: TeamBot | undefined; active: boolean; indent?: boolean; onChanged: () => void; onClose?: () => void }) {
  const groups = useItemActions(props.item, props.onChanged);
  return (
    <RowMenu label={props.item.title || "Untitled"} groups={groups}>
      <ItemButton {...props} />
      {props.onClose ? <CloseButton label={props.item.title || "Untitled"} onClose={props.onClose} /> : null}
    </RowMenu>
  );
}

function ItemButton({ item, author, active, indent }: { item: TreeItem; author: TeamBot | undefined; active: boolean; indent?: boolean }) {
  return (
    <button type="button" onClick={() => openAppPath(item.href)} aria-current={active ? "page" : undefined} className={cn(ROW, indent && "pl-7", active && ROW_ACTIVE, "group-hover/rowmenu:pr-14")}>
      <span className={ROW_GLYPH}>{item.icon ? <span aria-hidden className="text-sm leading-none">{item.icon}</span> : <Icon name={KIND_ICONS[item.kind] ?? "File"} aria-hidden />}</span>
      <span className={ROW_LABEL}>{item.title || "Untitled"}</span>
      {author ? <span title={`Made by ${author.name}`} className="group-hover/rowmenu:hidden"><Face name={author.name} avatar={author.avatar} size="xs" /></span> : null}
    </button>
  );
}

export function OfficeSidebar({ activeThreadId, onNavigate, isCompactViewport }: PluginThreadListProps) {
  const { current } = useSpaces();
  const spaceId = current?.id ?? null;
  const pathname = usePathname();
  const officeSub = currentOfficeSubPath(pathname);
  const { threads } = useSidebarThreads();
  const threadActions = useSidebarThreadActions();
  const team = useTeam(spaceId);
  const talk = useLive<{ conversations: Conversation[] }>("talk_list", { spaceId }, { enabled: spaceId !== null });
  const conversations = talk.data?.conversations ?? [];
  const tree = useSpaceTree(spaceId);
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [closed, setClosed] = useState<Record<string, number>>(readClosed);
  const close = (key: string) => {
    const next = { ...closed, [key]: Date.now() };
    setClosed(next);
    try { globalThis.localStorage?.setItem(CLOSED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const bots = useMemo(() => new Map(team.bots.map((bot) => [bot.id, bot])), [team.bots]);
  const health = useExternalHealth(team.bots.map((bot) => bot.providerId));
  const folders: TreeFolder[] = (tree.data?.folders ?? []).filter((folder) => !folder.archived);
  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);

  const openThread = (id: string) => { threadActions.open(id); onNavigate(); };
  const toggle = (projectId: string) => {
    const next = { ...open, [projectId]: !(open[projectId] ?? true) };
    setOpen(next);
    try { globalThis.localStorage?.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const favoriteThreads = threads.filter((thread) => thread.isPinned && folderIds.has(thread.projectId) && !thread.isArchived);
  const favoriteRefs = new Set(tree.data?.favorites ?? []);
  const favoriteItems = folders.flatMap((folder) => folder.items).filter((item) => favoriteRefs.has(itemRef(item)));

  return (
    <div className="flex flex-col px-2 pb-6">
      <Section
        title="Team"
        action={<button type="button" aria-label="Add a bot" className={SECTION_ACTION} onClick={() => { openOffice("team/new"); onNavigate(); }}><Icon name="Plus" className="size-3.5" /></button>}
      >
        {team.bots.length && isCompactViewport
          // No hover on touch, so faces come with their names.
          ? <div className="space-y-px pb-1">
              {team.bots.map((bot) => (
                <button key={bot.id} type="button" onClick={() => { openOffice(`team/${encodeURIComponent(bot.id)}`); onNavigate(); }} className={cn(ROW, "h-10")}>
                  <Face name={bot.name} avatar={bot.avatar} state={bot.state} size="sm" />
                  <span className={ROW_LABEL}>{bot.name}</span>
                  {externalAgentName(bot.providerId) ? <span className="shrink-0 text-xs text-muted-foreground">{externalAgentName(bot.providerId)}</span> : null}
                </button>
              ))}
            </div>
          : team.bots.length
          ? <div className="flex flex-wrap gap-1.5 px-1.5 pt-0.5 pb-2">
              {team.bots.map((bot) => {
                const selected = officeSub?.startsWith(`team/${bot.id}`) ?? false;
                const agent = externalAgentName(bot.providerId);
                const offline = health[bot.providerId ?? ""]?.online === false;
                const status = offline ? "Offline" : bot.state === "needs_you" ? "Needs you" : bot.state === "working" ? "Working" : null;
                return (
                  <Hint
                    key={bot.id}
                    label={<>
                      <span className="block font-medium">{bot.name}</span>
                      {bot.role ? <span className="block opacity-80">{bot.role}</span> : null}
                      {agent || status ? <span className="block opacity-80">{[agent ? `${agent} agent` : null, status].filter(Boolean).join(" · ")}</span> : null}
                    </>}
                  >
                    <button
                      type="button"
                      aria-label={[bot.name, agent ? `${agent} agent` : null, status].filter(Boolean).join(", ")}
                      onClick={() => { openOffice(`team/${encodeURIComponent(bot.id)}`); onNavigate(); }}
                      className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Face
                        name={bot.name}
                        avatar={bot.avatar}
                        state={bot.state}
                        selected={selected}
                        external={agent}
                        offline={offline}
                        badge={agent && bot.providerId ? <ProviderBadge providerId={bot.providerId} label={`${agent} agent`} className="size-full" /> : null}
                      />
                    </button>
                  </Hint>
                );
              })}
            </div>
          : team.data === null || spaceId === null || team.loading ? null
          : <p className="px-2 pb-2 text-xs text-muted-foreground">No bots in this space yet.</p>}
        {conversations.filter((conversation) => !conversation.isDirect).map((conversation) => (
          <button key={conversation.id} type="button" onClick={() => { openAppPath(conversation.href); onNavigate(); }} className={cn(ROW, pathname === conversation.href && ROW_ACTIVE)}>
            <span className={cn(ROW_GLYPH, "text-[13px] font-medium")} aria-hidden>#</span>
            <span className={cn(ROW_LABEL, conversation.unread && "font-medium")}>{conversation.title}</span>
            {conversation.needsYou ? <span aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning-foreground" /> : null}
            <FaceStack faces={conversation.memberBotIds.map((id) => bots.get(id)).filter((bot): bot is TeamBot => Boolean(bot))} />
          </button>
        ))}
      </Section>

      {favoriteThreads.length || favoriteItems.length
        ? <Section title="Favorites">
            {favoriteThreads.map((thread) => <ThreadRow key={thread.id} thread={thread} active={thread.id === activeThreadId} onOpen={openThread} />)}
            {favoriteItems.map((item) => <ItemRow key={itemRef(item)} item={item} author={item.authorBotId ? bots.get(item.authorBotId) : undefined} active={pathname === item.href} onChanged={tree.refresh} />)}
          </Section>
        : null}

      <Section
        title="Active work"
        action={<button type="button" aria-label="New folder" className={SECTION_ACTION} onClick={() => { openOffice("settings/folders/new"); onNavigate(); }}><Icon name="Plus" className="size-3.5" /></button>}
      >
        {folders.map((folder) => ({ folder, rows: folderRows(folder, threads, closed) })).filter(({ rows }) => rows.length).map(({ folder, rows }) => {
          const isOpen = open[folder.id] ?? true;
          const shown = expanded[folder.id] ? rows : rows.slice(0, FOLDER_PREVIEW);
          return (
            <div key={folder.id}>
              <RowMenu
                label={folder.name}
                groups={[
                  [{ id: "new", label: "New thread here", icon: "Plus", run: () => { threadActions.openNewThread({ projectId: folder.id, focusPrompt: true }); onNavigate(); } }],
                  [
                    { id: "toggle", label: isOpen ? "Collapse" : "Expand", icon: isOpen ? "ChevronUp" : "ChevronDown", run: () => toggle(folder.id) },
                    ...(rows.length > FOLDER_PREVIEW ? [{ id: "all", label: expanded[folder.id] ? "Show recent only" : `Show all ${rows.length}`, icon: "ListView", run: () => setExpanded({ ...expanded, [folder.id]: !expanded[folder.id] }) }] : []),
                  ],
                  [{ id: "settings", label: "Folder settings", icon: "SlidersHorizontal", run: () => { openOffice("settings"); onNavigate(); } }],
                ]}
              >
                <button type="button" onClick={() => toggle(folder.id)} aria-expanded={isOpen} className={cn(ROW, "group-hover/rowmenu:pr-8")}>
                  <span className={ROW_GLYPH}><Icon name={isOpen ? "ChevronDown" : "ChevronRight"} aria-hidden className="!size-3.5" /></span>
                  <span className={cn(ROW_LABEL, "font-medium")}>{folder.name}</span>
                  {folder.hasRepo && folder.branch
                    ? <span className="max-w-24 shrink-0 truncate font-mono text-[11px] text-subtle-foreground group-hover/rowmenu:hidden" title={`Branch ${folder.branch}`}>⎇ {folder.branch}</span>
                    : null}
                </button>
              </RowMenu>
              {isOpen
                ? <div className="space-y-px">
                    {shown.map((row) => row.type === "thread"
                      ? <ThreadRow key={row.thread.id} thread={row.thread} indent active={row.thread.id === activeThreadId} onOpen={openThread} onClose={() => close(rowKey(row))} />
                      : <ItemRow key={itemRef(row.item)} item={row.item} indent author={row.item.authorBotId ? bots.get(row.item.authorBotId) : undefined} active={pathname === row.item.href} onChanged={tree.refresh} onClose={() => close(rowKey(row))} />)}
                    {rows.length > FOLDER_PREVIEW
                      ? <button type="button" onClick={() => setExpanded({ ...expanded, [folder.id]: !expanded[folder.id] })} className={cn(ROW, "pl-7 text-muted-foreground")}>
                          {expanded[folder.id] ? "Show less" : `Show ${rows.length - FOLDER_PREVIEW} more`}
                        </button>
                      : null}
                  </div>
                : null}
            </div>
          );
        })}
        {tree.data && !folders.some((folder) => folderRows(folder, threads, closed).length)
          ? <p className="px-2 py-1 text-xs text-muted-foreground">Nothing active this week.</p>
          : null}
        <button type="button" onClick={() => { openAppPath(studioPath()); onNavigate(); }} className={cn(ROW, "mt-1 text-muted-foreground")}>
          <span className={ROW_GLYPH}><Icon name="Layers" aria-hidden /></span>
          <span className={ROW_LABEL}>Browse everything in Library</span>
        </button>
      </Section>
    </div>
  );
}
