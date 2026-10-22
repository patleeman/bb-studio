// The sidebar: Studio's thread list provider ("Bot (Studio)"), which replaces
// BB's thread list on every page but the Studio panel (threadListSwitch.ts).
// Threads on top, under BB's New thread (ThreadsSection.tsx), then Bots.
// A "Bots" list: every Bot (the primary first), the selected one (the Bot
// page's route, selection.ts; on a thread, the thread's owner) expanded under
// it into the threads it started: Needs you, Running, Runners, Recurring,
// Recent (each nested under the thread that started it) and its earlier
// conversations. A thread opens as a BB thread in the main pane, as from BB's
// own list; so does a Bot's row, which opens its chat, with the Bot info
// panel action open beside it. Each Bot's ⓘ opens its Info: beside the chat
// on its thread (the Bot info panel action), else its Bot page.
// A thread dragged onto a Bot's row (from Threads, or another Bot's list)
// moves under that Bot (bot_thread_adopt); one from a Bot's list dropped on
// Threads comes back to the user (ThreadsSection.tsx).
import { Icon } from "../../kit/ui/index";
import { openAppPath, usePathname } from "../../kit/app/index";
import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_ThreadActionsMenu as ThreadActionsMenu, experimental_useProviders as useProviders, useSdk, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { botPath, forBot, lastBot, NEW_BOT_PATH, rememberBot, useBotSelection } from "./selection";
import { useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import type { BotActivityView, BotScheduledView, BotSideThreadListView, BotThreadView, BotView } from "../../contract";
import { useCall, useLive } from "../live";
import { runningCount, statusLabel } from "./BotHome";
import { BOT_STYLES, BotAvatar, botProvider, colorForName } from "./BotAvatar";
import { ProviderStatusMark, threadStatusTone, type ProviderCatalogEntry } from "./ProviderStatusMark";
import { isBotPath, isStudioPath, syncThreadList, threadIdForPath } from "./threadListSwitch";
import { ArchiveButton, BOT_THREAD_DRAG, RenameInput, THREAD_DRAG, ThreadsSection } from "./ThreadsSection";
import { RunnerSidebarRow, useOpenRunner, useRunners } from "./Runners";
import { forgetThreadStrips, noteOpenThread, sidebarGroups, useOpenBotInfo, useOpenBotInfoOnChat, useOpenThread, type TreeNode } from "./workspace";

const LAYOUT_KEY = "studio.bot.sidebar";
type Layout = { closed: string[] };

function readLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return { closed: Array.isArray(raw?.closed) ? raw.closed.filter((each): each is string => typeof each === "string") : ["earlier"] };
  } catch {
    return { closed: ["earlier"] };
  }
}

function useLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const [layout, setLayout] = useState(readLayout);
  const update = (patch: Partial<Layout>) => setLayout((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  return [layout, update];
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
function age(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return relative.format(-Math.round(minutes / 10080), "week").replace(/\s?ago$/, "");
}

/**
 * The provider's component. It shows on every page but the Studio panel; there
 * it shows only by mistake (a second window, a reload mid-switch), puts this
 * window's list back at once and shows a quiet placeholder for that moment.
 */
export function BotThreadList({ onNavigate, activeThreadId }: PluginThreadListProps) {
  const sdk = useSdk();
  const pathname = usePathname();
  const onStudio = isStudioPath(pathname);
  useEffect(() => { if (onStudio) void syncThreadList(sdk, pathname); }, [sdk, onStudio, pathname]);
  if (onStudio) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading threads…</p>;
  const threadId = isBotPath(pathname) ? null : threadIdForPath(pathname);
  return (
    <>
      <ThreadsSection activeThreadId={activeThreadId ?? null} onNavigate={onNavigate} />
      <BotsList onNavigate={onNavigate} activeThreadId={activeThreadId ?? null} threadId={threadId} />
    </>
  );
}

/**
 * Mounted in every window (an app overlay): keeps this window's mode and BB's
 * sidebar in line with its route (the Studio list on the Studio panel, the
 * Bots list everywhere else) and re-applies it when the window gains focus,
 * so the window in use decides.
 */
export function ThreadListSwitcher() {
  const sdk = useSdk();
  const pathname = usePathname();
  useEffect(() => {
    noteOpenThread(threadIdForPath(pathname));
    const sync = () => void syncThreadList(sdk, pathname);
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [sdk, pathname]);
  return null;
}

type BotSummary = NonNullable<BotView["bot"]>;

/** `threadId`: the Bot thread open in the main pane, if any (not on the Bot page). */
function BotsList({ onNavigate, activeThreadId, threadId }: { onNavigate(): void; activeThreadId: string | null; threadId: string | null }) {
  const providerState = useProviders();
  const providers = providerState.providers;
  // The removed Threads tab kept its opened threads in localStorage; drop them once.
  useEffect(() => forgetThreadStrips(), []);
  const route = useBotSelection();
  // On a thread the route names no Bot: its owner does, or the Bot last selected here until that answers.
  const owner = useLive<{ botId: string | null }>("bot_thread_owner", { threadId: threadId ?? "" }, { pollMs: 120_000, enabled: !!threadId });
  const botId = threadId ? owner.data?.botId ?? lastBot() : route.botId;
  const creating = !threadId && route.creating;
  const list = useLive<{ bots: BotSummary[] }>("bot_list", {}, { pollMs: 30_000 });
  const view = useLive<BotView>("bot_get", forBot(botId), { pollMs: 30_000 });
  const bots = list.data?.bots ?? [];
  const selected = creating ? null : view.data?.bot ?? null;
  useEffect(() => { if (selected) rememberBot(selected.id); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // No Bot yet, once the list says so: a row for the welcome, not a message.
  const none = !bots.length && !!list.data && !list.error;
  return (
    <nav aria-label="Bots" className="studio-root flex flex-col gap-0.5 px-1.5 pb-3">
      <style>{BOT_STYLES}</style>
      <div className="flex h-7 items-center gap-1 pl-2 text-[11px] font-medium text-muted-foreground">
        <span className="min-w-0 flex-1">Bots</span>
        <button type="button" aria-label="New bot" title="New bot" data-testid="bot-new" onClick={() => { openAppPath(NEW_BOT_PATH); onNavigate(); }}
          className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Plus" className="size-3.5" /></button>
      </div>
      {(creating && bots.length) || none ? (
        <button type="button" aria-current={creating || !threadId ? "page" : undefined} data-testid="bot-new-row" onClick={() => { openAppPath(NEW_BOT_PATH); onNavigate(); }}
          className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover aria-[current=page]:bg-state-active">
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50"><Icon name="Plus" className="size-3" /></span>
          <span className="min-w-0 flex-1 truncate">{none ? "Your first bot" : "New bot"}</span>
        </button>
      ) : null}
      {bots.length ? bots.map((bot) => bot.id === selected?.id
        ? <BotEntry key={bot.id} view={view.data!} onNavigate={onNavigate} active={activeThreadId} onThread={!!threadId} providers={providers} />
        : <BotRow key={bot.id} bot={bot} onNavigate={onNavigate} />)
        : none ? null : <p className="px-2 text-xs text-muted-foreground">{list.loading || view.loading ? "Loading…" : list.error ?? view.error}</p>}
    </nav>
  );
}

/** Opens a Bot's chat as a BB thread (its Bot page when it has none). */
function useOpenBot(onNavigate: () => void): (bot: BotSummary) => void {
  const openThread = useOpenThread();
  return (bot) => {
    rememberBot(bot.id);
    if (bot.threadId) openThread(bot.threadId);
    else openAppPath(botPath(bot.id));
    onNavigate();
  };
}

/** The ⓘ beside a Bot's row: its Info. Shown on hover or focus, always on the selected Bot. */
function InfoButton({ bot, onThread, onNavigate, always = false }: { bot: BotSummary; onThread: boolean; onNavigate(): void; always?: boolean }) {
  const openInfo = useOpenBotInfo();
  return (
    <button type="button" aria-label={`Open ${bot.name} info`} title="Bot info" data-testid="bot-info"
      onClick={() => { rememberBot(bot.id); openInfo(bot, onThread); onNavigate(); }}
      className={`flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 ${always ? "" : "opacity-0 group-hover/bot:opacity-100"}`}>
      <Icon name="Info" className="size-3.5" />
    </button>
  );
}

/** A Bot's row as a drop target: a thread dropped on it moves under the Bot. */
function useThreadDrop(bot: BotSummary): { over: boolean; props: { onDragOver(event: DragEvent): void; onDragLeave(event: DragEvent): void; onDrop(event: DragEvent): void } } {
  const call = useCall();
  const [over, setOver] = useState(false);
  const dragged = (event: DragEvent) => event.dataTransfer.types.includes(THREAD_DRAG);
  return {
    over,
    props: {
      onDragOver: (event) => { if (!dragged(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(true); },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); },
      onDrop: (event) => {
        setOver(false);
        const threadId = event.dataTransfer.getData(THREAD_DRAG);
        if (!threadId) return;
        event.preventDefault();
        call("bot_thread_adopt", { botId: bot.id, threadId }).then(
          () => toast.success(`Moved to ${bot.name}`),
          (error: unknown) => toast.error(`Couldn't move it to ${bot.name}: ${error instanceof Error ? error.message : String(error)}`),
        );
      },
    },
  };
}
const DROP_RING = "ring-2 ring-inset ring-[var(--bot-accent,var(--ring))]";

/** A Bot that isn't selected: one row that opens its chat, and its ⓘ. */
function BotRow({ bot, onNavigate }: { bot: BotSummary; onNavigate(): void }) {
  const openBot = useOpenBot(onNavigate);
  const drop = useThreadDrop(bot);
  return (
    <div {...drop.props} data-drop-over={drop.over || undefined} style={{ "--bot-accent": bot.color ?? colorForName(bot.name) } as CSSProperties}
      className={`group/bot flex min-w-0 items-center rounded-md pr-1 hover:bg-state-hover ${drop.over ? DROP_RING : ""}`}>
      <button type="button" data-testid="bot-row" data-bot={bot.id} title={bot.name} onClick={() => openBot(bot)}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
        <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} image={bot.avatarImageUrl} size={22} provider={botProvider(bot)} />
        <span className="min-w-0 flex-1 truncate text-sm">{bot.name}</span>
        {bot.state !== "active" ? <span className="shrink-0 text-[11px] text-muted-foreground">{bot.state}</span> : null}
      </button>
      <InfoButton bot={bot} onThread={false} onNavigate={onNavigate} />
    </div>
  );
}

/** One bot: its row, and (it's the selected bot) its threads under it. */
function BotEntry({ view, onNavigate, active, onThread, providers }: { view: BotView; onNavigate(): void; active: string | null; onThread: boolean; providers: readonly ProviderCatalogEntry[] }) {
  const bot = view.bot!;
  const activity = useLive<BotActivityView>("bot_activity", { botId: bot.id }, { pollMs: 15_000 });
  const chain = useLive<{ threadIds: string[]; threads?: { id: string; title: string }[] }>("bot_chain", { botId: bot.id }, { pollMs: 120_000 });
  const [layout, setLayout] = useLayout();
  const openThread = useOpenThread();
  const openBot = useOpenBot(onNavigate);
  const running = runningCount(activity.data);
  const status = statusLabel(view.run, bot.state, running);
  const [showArchived, setShowArchived] = useState(false);
  const older = useLive<{ threads: BotThreadView[] }>("bot_maintenance_threads", { botId: bot.id }, { enabled: showArchived && bot.kind !== "external" });
  const recentActivity = activity.data ? { ...activity.data, completed: activity.data.completed.filter((t) => Date.now() - t.updatedAt < 7 * 86_400_000) } : null;
  const groups = sidebarGroups(recentActivity);
  const ids = chain.data?.threadIds ?? [];
  const chatOpen = active !== null && (active === bot.threadId || ids.includes(active));
  const earlier = bot.threadId && ids.at(-1) === bot.threadId ? ids.slice(0, -1).reverse() : [];
  // Bot info opens beside the Bot's own chat when it opens.
  useOpenBotInfoOnChat(active, bot.threadId ? [...ids, bot.threadId] : ids);
  // Chain threads are hidden, so BB's ThreadTitle shows nothing for them; bot_chain reads their titles.
  const titles = new Map((chain.data?.threads ?? []).map((thread) => [thread.id, thread.title]));
  const color = bot.color ?? colorForName(bot.name);
  const accent = { "--bot-accent": color } as CSSProperties;
  const toggle = (id: string) => setLayout({ closed: layout.closed.includes(id) ? layout.closed.filter((each) => each !== id) : [...layout.closed, id] });
  const onOpen = (threadId: string) => { openThread(threadId); onNavigate(); };
  const sideThreads = useLive<{ threads: BotSideThreadListView[] }>("bot_side_threads_for_bot", { botId: bot.id }, { pollMs: 60_000 });
  const runners = useRunners(bot.id);
  const openRunner = useOpenRunner(bot.id, onOpen, () => { runners.refresh(); activity.refresh(); });
  const tree = (nodes: TreeNode[]) => <ThreadTree nodes={nodes} depth={0} active={active} onOpen={onOpen} providers={providers} />;
  const drop = useThreadDrop(bot);

  return (
    <div className="flex flex-col" style={accent}>
      {/* The bot: its row opens its chat as a BB thread; ⓘ opens its Info. */}
      {/* Tinted in the Bot's color only while its chat (or an earlier conversation of it) is the open thread. */}
      <div {...drop.props} data-drop-over={drop.over || undefined} className={`group/bot flex min-w-0 items-center rounded-md pr-1 hover:bg-state-hover ${drop.over ? DROP_RING : ""}`} style={chatOpen ? { background: "color-mix(in oklab, var(--bot-accent) 14%, transparent)" } : undefined}>
      <button type="button" aria-current={chatOpen ? "page" : undefined} data-testid="bot-main" title={`${bot.name}: ${status}`}
        onClick={() => openBot(bot)}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left hover:brightness-110">
        <span className="relative shrink-0">
          <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} image={bot.avatarImageUrl} size={28} working={running > 0} provider={botProvider(bot)} />
          {groups.needsYou.length ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-background" aria-label="Needs you" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{bot.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">{status}</span>
        </span>
      </button>
      <InfoButton bot={bot} onThread={onThread} onNavigate={onNavigate} always />
      </div>

      <div className="mt-2 ml-3 flex flex-col gap-2.5 border-l pl-1.5" style={{ borderColor: "color-mix(in oklab, var(--bot-accent) 35%, transparent)" }}>
        {groups.needsYou.length ? (
          <Group id="needs" title="Needs you" closed={layout.closed} onToggle={toggle} badge={groups.needsYou.length}>
            {groups.needsYou.map((thread) => <Row key={thread.id} thread={thread} depth={0} active={active === thread.id} onOpen={onOpen} providers={providers} />)}
          </Group>
        ) : null}
        {groups.running.length ? <Group id="running" title="Running" closed={layout.closed} onToggle={toggle}>{tree(groups.running)}</Group> : null}
        {runners.data?.runners.length ? (
          <Group id="runners" title="Runners" closed={layout.closed} onToggle={toggle}>
            {runners.data.runners.map((runner) => <RunnerSidebarRow key={runner.id} runner={runner} active={!!runner.threadId && active === runner.threadId} onOpen={openRunner} providers={providers} fallbackProviderId={bot.providerId} />)}
          </Group>
        ) : null}
        {groups.recurring.length ? (
          <Group id="recurring" title="Schedule" closed={layout.closed} onToggle={toggle}>
            {groups.recurring.map((item) => <RecurringRow key={item.id} item={item} />)}
          </Group>
        ) : null}
        {groups.recent.length ? <Group id="recent" title="Recent" closed={layout.closed} onToggle={toggle}>{tree(groups.recent)}</Group> : null}
        {bot.kind !== "external" ? <button type="button" className="self-start px-2 text-xs text-muted-foreground hover:text-foreground" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide archived" : "Show archived"}</button> : null}
        {showArchived ? older.error ? <p role="alert" className="px-2 text-xs">{older.error}</p> : older.data?.threads.map((thread) => <Row key={thread.id} thread={thread} depth={0} active={active === thread.id} onOpen={onOpen} providers={providers} />) : null}
        {sideThreads.data?.threads.length ? (
          <Group id="threads" title="Side threads" closed={layout.closed} onToggle={toggle}>
            {sideThreads.data.threads.map((thread) => <SideThreadRow key={thread.threadId} thread={thread} active={active === thread.threadId} onOpen={onOpen} />)}
          </Group>
        ) : null}
        {!groups.needsYou.length && !groups.running.length && !groups.recent.length && !sideThreads.data?.threads.length ? (
          <p className="px-2 text-xs text-muted-foreground">Threads {bot.name} starts show up here.</p>
        ) : null}
        {earlier.length ? (
          <Group id="earlier" title="Earlier conversations" closed={layout.closed} onToggle={toggle}>
            {earlier.map((id) => (
              <button key={id} type="button" onClick={() => onOpen(id)} aria-current={active === id ? "true" : undefined}
                className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground aria-[current]:bg-state-active aria-[current]:text-foreground">
                <Icon name="Clock" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{titles.get(id) || "Untitled"}</span>
              </button>
            ))}
          </Group>
        ) : null}
      </div>
    </div>
  );
}

function Group({ id, title, closed, onToggle, badge, children }: { id: string; title: string; closed: string[]; onToggle(id: string): void; badge?: number; children: ReactNode }) {
  const open = !closed.includes(id);
  return (
    <section aria-label={title} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => onToggle(id)}
        className="group flex h-6 items-center gap-1 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
        <span className="min-w-0 truncate">{title}</span>
        {badge ? <span className="rounded-full bg-warning/20 px-1.5 text-[10px] leading-4 text-foreground">{badge}</span> : null}
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 opacity-0 group-hover:opacity-100" />
      </button>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </section>
  );
}

function ThreadTree({ nodes, depth, active, onOpen, providers }: { nodes: TreeNode[]; depth: number; active: string | null; onOpen(threadId: string): void; providers: readonly ProviderCatalogEntry[] }) {
  return (
    <ul className={depth ? "relative ml-[15px] border-l border-border/70 pl-1" : "flex flex-col"}>
      {nodes.map((node) => (
        <li key={node.thread.id}>
          <Row thread={node.thread} depth={depth} active={active === node.thread.id} onOpen={onOpen} providers={providers} />
          {node.children.length ? <ThreadTree nodes={node.children} depth={depth + 1} active={active} onOpen={onOpen} providers={providers} /> : null}
        </li>
      ))}
    </ul>
  );
}

function Row({ thread, active, onOpen, providers }: { thread: BotThreadView; depth: number; active: boolean; onOpen(threadId: string): void; providers: readonly ProviderCatalogEntry[] }) {
  const tone = threadStatusTone(thread.status, thread.needsYou);
  return (
    <button type="button" data-thread={thread.id} aria-current={active ? "true" : undefined} onClick={() => onOpen(thread.id)} title={thread.title}
      draggable onDragStart={(event) => { event.dataTransfer.setData(THREAD_DRAG, thread.id); event.dataTransfer.setData(BOT_THREAD_DRAG, thread.id); event.dataTransfer.effectAllowed = "move"; }}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover aria-[current]:bg-state-active">
      <ProviderStatusMark providerId={thread.providerId} tone={tone} providers={providers} />
      <span className={`min-w-0 flex-1 truncate ${tone === "idle" ? "text-muted-foreground" : ""}`}>{thread.title}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{age(thread.updatedAt)}</span>
    </button>
  );
}

/**
 * A side thread on one of the Bot's replies (src/bot-side-threads.ts): its
 * title, replies and age, with BB's own Archive on hover and its thread
 * menu (right-click or the hover ⋯) to rename, pin or delete it.
 */
function SideThreadRow({ thread, active, onOpen }: { thread: BotSideThreadListView; active: boolean; onOpen(threadId: string): void }) {
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const replies = thread.replies === 1 ? "1 reply" : `${thread.replies} replies`;
  // Titled "<Bot> · <reply>"; under its Bot, the reply is enough (and the name may have changed).
  const title = thread.title.replace(/^[^·]{1,60} · /, "");
  const target = { id: thread.threadId, ...thread.menu, status: thread.menu.status as never, archivedAt: null, environment: null };
  return (
    <ThreadActionsContextMenu thread={target} requestRename={() => setRenaming(true)} disabled={renaming}>
      <div data-thread={thread.threadId} aria-current={active ? "true" : undefined} role="button" tabIndex={0} title={`${title} · ${replies}`}
        onClick={() => { if (!renaming) onOpen(thread.threadId); }}
        onKeyDown={(event) => { if (!renaming && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(thread.threadId); } }}
        className="group/side-thread flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover aria-[current]:bg-state-active">
        {thread.working
          ? <span className="size-1.5 shrink-0 rounded-full bg-success bot-pulse" role="img" aria-label="Running" />
          : <Icon name="MessageSquare" className="size-3.5 shrink-0 text-muted-foreground" />}
        {renaming
          ? <RenameInput thread={{ id: thread.threadId, title: thread.title, displayTitle: thread.title }} onDone={() => setRenaming(false)} />
          : <span className="min-w-0 flex-1 truncate">{title}</span>}
        <span className={`shrink-0 text-[11px] text-muted-foreground tabular-nums ${menuOpen ? "hidden" : "group-hover/side-thread:hidden"}`}>{thread.replies ? `${thread.replies} · ` : ""}{age(thread.updatedAt)}</span>
        <span className={`shrink-0 items-center gap-0.5 ${menuOpen ? "flex" : "hidden group-hover/side-thread:flex"}`}>
          <ArchiveButton thread={target} title={title} />
          <ThreadActionsMenu
            thread={target}
            requestRename={() => setRenaming(true)}
            onOpenChange={setMenuOpen}
            align="start"
            trigger={(props) => (
              <button type="button" aria-label={`Actions for ${title}`} {...props} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onClick?.(event); }}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
                <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
              </button>
            )}
          />
        </span>
      </div>
    </ThreadActionsContextMenu>
  );
}

function RecurringRow({ item }: { item: BotScheduledView }) {
  const next = item.nextRunAt ? new Date(item.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-2 text-[13px]" title={next ? `Next: ${next}` : undefined}>
      <Icon name="Repeat" className={`size-3.5 shrink-0 ${item.enabled ? "text-muted-foreground" : "text-muted-foreground/40"}`} />
      <span className={`min-w-0 flex-1 truncate ${item.enabled ? "" : "text-muted-foreground"}`}>{item.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{item.enabled ? next ?? "on" : "off"}</span>
    </div>
  );
}
