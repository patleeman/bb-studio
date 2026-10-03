// The sidebar below the navigation shows what's active, not everything: who
// you work with (Team faces and conversations), what you return to
// (Favorites), and recent work, by folder unless the section's ⋯ menu says
// otherwise (see activeWork.ts). Everything else lives in the Library. Closing
// a row hides it until it changes again. Threads a bot or automation started
// never show here; they live under the bot's task and reach you through the
// Inbox.
import * as Menu from "@radix-ui/react-dropdown-menu";
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
import { activeGroups, readView, rowKey, RUNNING, writeView, type ActiveGroup, type ActiveView, type GroupBy, type SortBy } from "./activeWork";
import { MENU, MENU_ITEM, MENU_LABEL, MENU_SEPARATOR, PORTAL_SCOPE, ROW, ROW_ACTIVE, ROW_GLYPH, ROW_HOVER_BUTTON, ROW_LABEL, SECTION_ACTION, SECTION_HEADER, cn } from "./styles";

const FOLDER_PREVIEW = 8;

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

/** A row's folder, shown on the right when rows aren't grouped by folder. */
function RowDetail({ text, hoverGroup }: { text: string | undefined; hoverGroup: "thread" | "rowmenu" }) {
  if (!text) return null;
  return <span className={cn("max-w-24 shrink-0 truncate text-xs text-subtle-foreground", hoverGroup === "thread" ? "group-hover/thread:hidden" : "group-hover/rowmenu:hidden")}>{text}</span>;
}

function ThreadRow(props: { thread: PluginSidebarThread; active: boolean; indent?: boolean; detail?: string; onOpen: (id: string) => void; onClose?: () => void }) {
  return (
    <ThreadMenu thread={props.thread}>
      {(editor) => editor ?? <>
        <ThreadButton {...props} />
        {props.onClose ? <CloseButton label={props.thread.displayTitle} onClose={props.onClose} /> : null}
      </>}
    </ThreadMenu>
  );
}

function ThreadButton({ thread, active, indent, detail, onOpen }: { thread: PluginSidebarThread; active: boolean; indent?: boolean; detail?: string; onOpen: (id: string) => void }) {
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
      <RowDetail text={detail} hoverGroup="thread" />
    </button>
  );
}

function ItemRow(props: { item: TreeItem; author: TeamBot | undefined; active: boolean; indent?: boolean; detail?: string; onChanged: () => void; onClose?: () => void }) {
  const groups = useItemActions(props.item, props.onChanged);
  return (
    <RowMenu label={props.item.title || "Untitled"} groups={groups}>
      <ItemButton {...props} />
      {props.onClose ? <CloseButton label={props.item.title || "Untitled"} onClose={props.onClose} /> : null}
    </RowMenu>
  );
}

function ItemButton({ item, author, active, indent, detail }: { item: TreeItem; author: TeamBot | undefined; active: boolean; indent?: boolean; detail?: string }) {
  return (
    <button type="button" onClick={() => openAppPath(item.href)} aria-current={active ? "page" : undefined} className={cn(ROW, indent && "pl-7", active && ROW_ACTIVE, "group-hover/rowmenu:pr-14")}>
      <span className={ROW_GLYPH}>{item.icon ? <span aria-hidden className="text-sm leading-none">{item.icon}</span> : <Icon name={KIND_ICONS[item.kind] ?? "File"} aria-hidden />}</span>
      <span className={ROW_LABEL}>{item.title || "Untitled"}</span>
      <RowDetail text={detail} hoverGroup="rowmenu" />
      {author ? <span title={`Made by ${author.name}`} className="group-hover/rowmenu:hidden"><Face name={author.name} avatar={author.avatar} size="xs" /></span> : null}
    </button>
  );
}

/** A group's collapsible header: a folder (with its branch) or a type (with its icon). */
function GroupHeader({ group, isOpen, onToggle }: { group: ActiveGroup; isOpen: boolean; onToggle: () => void }) {
  const { folder } = group;
  return (
    <button type="button" onClick={onToggle} aria-expanded={isOpen} className={cn(ROW, "group-hover/rowmenu:pr-8")}>
      <span className={ROW_GLYPH}><Icon name={isOpen ? "ChevronDown" : "ChevronRight"} aria-hidden className="!size-3.5" /></span>
      <span className={cn(ROW_LABEL, "font-medium")}>{group.label}</span>
      {folder?.hasRepo && folder.branch
        ? <span className="max-w-24 shrink-0 truncate font-mono text-[11px] text-subtle-foreground group-hover/rowmenu:hidden" title={`Branch ${folder.branch}`}>⎇ {folder.branch}</span>
        : folder ? null : <span className="shrink-0 text-xs tabular-nums text-subtle-foreground group-hover/rowmenu:hidden">{group.rows.length}</span>}
    </button>
  );
}

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "type", label: "Type" },
  { value: "none", label: "None" },
];
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "recent", label: "Recent activity" },
  { value: "name", label: "Name" },
];

/** The Active work section's ⋯ menu: grouping, sorting, and the folder actions that don't depend on one row. */
function ActiveWorkMenu({ view, onChange, onNewFolder, onFolderSettings }: { view: ActiveView; onChange: (view: ActiveView) => void; onNewFolder: () => void; onFolderSettings: () => void }) {
  const radio = (label: string, value: string, options: { value: string; label: string }[], set: (value: string) => void) => (
    <>
      <Menu.Label className={MENU_LABEL}>{label}</Menu.Label>
      <Menu.RadioGroup value={value} onValueChange={set}>
        {options.map((option) => (
          <Menu.RadioItem key={option.value} value={option.value} className={MENU_ITEM}>
            <span className="inline-flex size-3.5 items-center justify-center">
              <Menu.ItemIndicator><Icon name="Check" aria-hidden /></Menu.ItemIndicator>
            </span>
            {option.label}
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </>
  );
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="Active work options" className={cn(SECTION_ACTION, "data-[state=open]:opacity-100")}>
        <Icon name="MoreHorizontal" className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
          {radio("Group by", view.groupBy, GROUP_OPTIONS, (groupBy) => onChange({ ...view, groupBy: groupBy as GroupBy }))}
          <Menu.Separator className={MENU_SEPARATOR} />
          {radio("Sort by", view.sortBy, SORT_OPTIONS, (sortBy) => onChange({ ...view, sortBy: sortBy as SortBy }))}
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Item onSelect={onNewFolder} className={MENU_ITEM}><Icon name="Plus" aria-hidden />New folder</Menu.Item>
          <Menu.Item onSelect={onFolderSettings} className={MENU_ITEM}><Icon name="SlidersHorizontal" aria-hidden />Folder settings</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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
  const [view, setView] = useState<ActiveView>(readView);
  const changeView = (next: ActiveView) => { setView(next); writeView(next); };
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
  const toggle = (key: string) => {
    const next = { ...open, [key]: !(open[key] ?? true) };
    setOpen(next);
    try { globalThis.localStorage?.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const groups = activeGroups(folders, threads, closed, view);
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
        action={<span className="ml-auto flex items-center">
          <ActiveWorkMenu
            view={view}
            onChange={changeView}
            onNewFolder={() => { openOffice("settings/folders/new"); onNavigate(); }}
            onFolderSettings={() => { openOffice("settings"); onNavigate(); }}
          />
          <button type="button" aria-label="New folder" className={SECTION_ACTION} onClick={() => { openOffice("settings/folders/new"); onNavigate(); }}><Icon name="Plus" className="size-3.5" /></button>
        </span>}
      >
        {groups.map((group) => {
          // Ungrouped rows sit flush, with no header to collapse.
          const flat = view.groupBy === "none";
          const isOpen = flat || (open[group.key] ?? true);
          const isExpanded = expanded[group.key] ?? false;
          const { rows, folder } = group;
          const shown = isExpanded ? rows : rows.slice(0, FOLDER_PREVIEW);
          const showMore = () => setExpanded({ ...expanded, [group.key]: !isExpanded });
          return (
            <div key={group.key}>
              {flat ? null : (
                <RowMenu
                  label={group.label}
                  groups={[
                    folder ? [{ id: "new", label: "New thread here", icon: "Plus", run: () => { threadActions.openNewThread({ projectId: folder.id, focusPrompt: true }); onNavigate(); } }] : [],
                    [
                      { id: "toggle", label: isOpen ? "Collapse" : "Expand", icon: isOpen ? "ChevronUp" : "ChevronDown", run: () => toggle(group.key) },
                      ...(rows.length > FOLDER_PREVIEW ? [{ id: "all", label: isExpanded ? "Show recent only" : `Show all ${rows.length}`, icon: "ListView", run: showMore }] : []),
                    ],
                    folder ? [{ id: "settings", label: "Folder settings", icon: "SlidersHorizontal", run: () => { openOffice("settings"); onNavigate(); } }] : [],
                  ]}
                >
                  <GroupHeader group={group} isOpen={isOpen} onToggle={() => toggle(group.key)} />
                </RowMenu>
              )}
              {isOpen
                ? <div className="space-y-px">
                    {shown.map((row) => {
                      // Outside folder grouping, each row names its folder.
                      const detail = view.groupBy === "folder" ? undefined : row.folder.name;
                      return row.type === "thread"
                        ? <ThreadRow key={row.thread.id} thread={row.thread} indent={!flat} detail={detail} active={row.thread.id === activeThreadId} onOpen={openThread} onClose={() => close(rowKey(row))} />
                        : <ItemRow key={itemRef(row.item)} item={row.item} indent={!flat} detail={detail} author={row.item.authorBotId ? bots.get(row.item.authorBotId) : undefined} active={pathname === row.item.href} onChanged={tree.refresh} onClose={() => close(rowKey(row))} />;
                    })}
                    {rows.length > FOLDER_PREVIEW
                      ? <button type="button" onClick={showMore} className={cn(ROW, !flat && "pl-7", "text-muted-foreground")}>
                          {isExpanded ? "Show less" : `Show ${rows.length - FOLDER_PREVIEW} more`}
                        </button>
                      : null}
                  </div>
                : null}
            </div>
          );
        })}
        {tree.data && !groups.length
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
