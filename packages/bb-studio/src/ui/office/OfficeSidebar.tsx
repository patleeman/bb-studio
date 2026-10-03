// The sidebar below the navigation: who you work with (Team, as faces, and
// the conversations you have with them), what you return to (Favorites), and
// your work (Folders, where threads and artifacts sit together, newest first).
// Threads a bot or automation started never show here; they live under the
// bot's task and reach you through the Inbox.
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon, openAppPath } from "@bb-studio/kit/app";
import { useMemo, useState, type ReactNode } from "react";
import { Face, FaceStack } from "./Face";
import { externalAgentName, useExternalHealth } from "./external";
import { ThreadMenu } from "./ThreadMenu";
import { usePathname } from "./location";
import { itemRef, useLive, useSpaces, useSpaceTree, useTeam, type Conversation, type TeamBot, type TreeFolder, type TreeItem } from "./model";
import { currentOfficeSubPath, openOffice } from "./routes";
import { ROW, ROW_ACTIVE, ROW_GLYPH, ROW_LABEL, SECTION_ACTION, SECTION_HEADER, cn } from "./styles";

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

export function folderRows(folder: TreeFolder, threads: readonly PluginSidebarThread[]): Row[] {
  const rows: Row[] = [
    ...threads.filter((thread) => thread.projectId === folder.id && isMyThread(thread))
      .map((thread) => ({ type: "thread" as const, at: Math.max(thread.updatedAt, thread.latestAttentionAt), thread })),
    ...folder.items.map((item) => ({ type: "item" as const, at: item.updatedAt, item })),
  ];
  return rows.sort((a, b) => b.at - a.at);
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

function ThreadRow(props: { thread: PluginSidebarThread; active: boolean; indent?: boolean; onOpen: (id: string) => void }) {
  return (
    <ThreadMenu thread={props.thread}>
      {(editor) => editor ?? <ThreadButton {...props} />}
    </ThreadMenu>
  );
}

function ThreadButton({ thread, active, indent, onOpen }: { thread: PluginSidebarThread; active: boolean; indent?: boolean; onOpen: (id: string) => void }) {
  const running = RUNNING.has(thread.runtimeStatus);
  return (
    <button type="button" onClick={() => onOpen(thread.id)} aria-current={active ? "page" : undefined} className={cn(ROW, indent && "pl-7", active && ROW_ACTIVE)}>
      <span className={ROW_GLYPH}><Icon name="MessageSquare" aria-hidden /></span>
      <span className={cn(ROW_LABEL, thread.isUnread && "font-medium")}>{thread.displayTitle}</span>
      {thread.hasPendingInteraction
        ? <span aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning-foreground" />
        : running
          ? <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-muted-foreground/50 border-r-transparent motion-safe:animate-spin" />
          : thread.runtimeStatus === "pending"
            ? <span title="Scheduled" className="shrink-0 text-subtle-foreground"><Icon name="Clock" aria-label="Scheduled" className="size-3.5" /></span>
            : thread.isUnread
              ? <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-foreground" />
              : null}
    </button>
  );
}

function ItemRow({ item, author, active, indent }: { item: TreeItem; author: TeamBot | undefined; active: boolean; indent?: boolean }) {
  return (
    <button type="button" onClick={() => openAppPath(item.href)} aria-current={active ? "page" : undefined} className={cn(ROW, indent && "pl-7", active && ROW_ACTIVE)}>
      <span className={ROW_GLYPH}>{item.icon ? <span aria-hidden className="text-sm leading-none">{item.icon}</span> : <Icon name={KIND_ICONS[item.kind] ?? "File"} aria-hidden />}</span>
      <span className={ROW_LABEL}>{item.title || "Untitled"}</span>
      {author ? <span title={`Made by ${author.name}`}><Face name={author.name} avatar={author.avatar} size="xs" /></span> : null}
    </button>
  );
}

export function OfficeSidebar({ activeThreadId, onNavigate }: PluginThreadListProps) {
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
        {team.bots.length
          ? <div className="flex flex-wrap gap-1.5 px-1.5 pt-0.5 pb-2">
              {team.bots.map((bot) => {
                const selected = officeSub?.startsWith(`team/${bot.id}`) ?? false;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    title={[bot.name, bot.role, externalAgentName(bot.providerId) ? `${externalAgentName(bot.providerId)} agent${health[bot.providerId!]?.online === false ? ", offline" : ""}` : null].filter(Boolean).join(" · ")}
                    onClick={() => { openOffice(`team/${encodeURIComponent(bot.id)}`); onNavigate(); }}
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Face name={bot.name} avatar={bot.avatar} state={bot.state} selected={selected} external={externalAgentName(bot.providerId)} offline={health[bot.providerId ?? ""]?.online === false} />
                  </button>
                );
              })}
            </div>
          : team.loading ? null
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
            {favoriteItems.map((item) => <ItemRow key={itemRef(item)} item={item} author={item.authorBotId ? bots.get(item.authorBotId) : undefined} active={pathname === item.href} />)}
          </Section>
        : null}

      <Section
        title="Folders"
        action={<button type="button" aria-label="New folder" className={SECTION_ACTION} onClick={() => { openOffice("settings/folders/new"); onNavigate(); }}><Icon name="Plus" className="size-3.5" /></button>}
      >
        {folders.map((folder) => {
          const isOpen = open[folder.id] ?? true;
          const rows = folderRows(folder, threads);
          const shown = expanded[folder.id] ? rows : rows.slice(0, FOLDER_PREVIEW);
          return (
            <div key={folder.id}>
              <div className="group/folder relative">
                <button type="button" onClick={() => toggle(folder.id)} aria-expanded={isOpen} className={ROW}>
                  <span className={ROW_GLYPH}><Icon name={isOpen ? "ChevronDown" : "ChevronRight"} aria-hidden className="!size-3.5" /></span>
                  <span className={cn(ROW_LABEL, "font-medium")}>{folder.name}</span>
                  {folder.hasRepo && folder.branch
                    ? <span className="max-w-24 shrink-0 truncate font-mono text-[11px] text-subtle-foreground group-hover/folder:hidden" title={`Branch ${folder.branch}`}>⎇ {folder.branch}</span>
                    : null}
                </button>
                <button
                  type="button"
                  aria-label={`New thread in ${folder.name}`}
                  onClick={() => { threadActions.openNewThread({ projectId: folder.id, focusPrompt: true }); onNavigate(); }}
                  className="absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-muted-foreground group-hover/folder:flex focus-visible:flex"
                >
                  <Icon name="Plus" className="size-3.5" />
                </button>
              </div>
              {isOpen
                ? <div className="space-y-px">
                    {shown.map((row) => row.type === "thread"
                      ? <ThreadRow key={row.thread.id} thread={row.thread} indent active={row.thread.id === activeThreadId} onOpen={openThread} />
                      : <ItemRow key={itemRef(row.item)} item={row.item} indent author={row.item.authorBotId ? bots.get(row.item.authorBotId) : undefined} active={pathname === row.item.href} />)}
                    {rows.length > FOLDER_PREVIEW
                      ? <button type="button" onClick={() => setExpanded({ ...expanded, [folder.id]: !expanded[folder.id] })} className={cn(ROW, "pl-7 text-muted-foreground")}>
                          {expanded[folder.id] ? "Show less" : `Show ${rows.length - FOLDER_PREVIEW} more`}
                        </button>
                      : null}
                    {!rows.length ? <p className="py-1 pl-7 text-xs text-subtle-foreground">Empty</p> : null}
                  </div>
                : null}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
