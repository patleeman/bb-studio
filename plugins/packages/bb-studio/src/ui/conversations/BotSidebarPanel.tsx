// The Bot sidebar (round 7, "the Bot as a space"): one Bot per sidebar.
// - Top, sticky: the Bot's space header (SpaceHeader.tsx): avatar, name, its
//   status (running count, Paused), a ··· menu (Edit space…, Default model
//   with bb's model picker, Archive: the older page, New Bot), and
//   its pages as rows (Memory, Skills, Library, Todos). Edit space
//   (EditSpace.tsx) covers the main view, or takes the lists' place where
//   BB has none.
// - Conversations, with "+ New" (BB's ghost button; BB's new-thread composer on
//   a Studio page, seeded with the Bot's default model): two-line rows, the title and
//   its time, then the latest reply (a spinner while it works), or, amber
//   and outlined, why it needs the user. A fork made at a message has no row:
//   it shows at that message, and its work and needs-you show on its parent's row.
// - Workers: the running ones and those needing the user, one line each, a
//   status glyph, the title, the repo it runs in
//   and a short time. The five newest finished (the server's view; a run of
//   one title folded into "×5") fold into one "N done" row that opens them in
//   place; older ones are on the Archive page (the ··· menu). A worker never
//   asks the user itself: the Bot raises it in the worker's conversation.
// - At the bottom, each Bot's icon (the shown one highlighted, an amber mark
//   when it needs the user) and + for a new Bot. A click, a two-finger swipe
//   sideways on the sidebar or "Studio: Show Bot <n>" (Ctrl+Option+1…9)
//   switches the whole sidebar; the main
//   view goes to that Bot's last-open conversation, else its Main.
// The server's view (bot_threads_view) and BB's live thread state are merged
// in model.ts. The header and the switcher are marked no-drag.
import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_useSidebarThreads, useBbNavigate, useSdk, type PluginThreadActionTarget, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type WheelEvent } from "react";
import type { BotSpace } from "../../bot-threads-contract";
import { Icon } from "../../kit/app/index";
import { noteBotThread } from "./bot-thread-owners";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "../../kit/ui/context-menu";
import { dragSourceProps, refDragItem, threadDragItem, writeDragItem } from "../../kit/app/item-drag";
import { NoDragStyle } from "../../kit/ui/no-drag";
import { buttonVariants } from "../../kit/ui/button";
import { cn } from "../../kit/ui/utils";
import { usePathname } from "../../kit/app/route";
import { BotPresence } from "../../presence/ui/BotPresence";
import { useCall, useLive } from "../live";
import { conversationLines, doneLabel, hiddenThreadTarget, isOlderPage, landingThread, olderLabel, olderPath, secondLine, shortAge, spaceDots, splitWorkers, swipeStep, switchTarget, SWIPE_START, workerLines, type ConversationLine, type LiveThread, type WorkerLine } from "./model";
import { currentBot, hasLanded, isLaunchPage, lastConversation, markLanded, newThreadAsked, rememberConversation, setBotSwitcher, setCurrentBot, setFocusHandler, setThreadOpener, useCurrentBot, watchNewThreadArrivals } from "./state";

import { MEMORY_SUBPATH } from "../../memory/shared";
import { skillsPagePath } from "../skills/paths";
import { loopsPath, useLoopsEnabled } from "../../loops/ui/hooks";
import { EditSpace } from "./EditSpace";
import { setLinkActionHandler } from "../../links/actions";
import { useMainViewRect } from "./EditSpaceStage";
import { DefaultModelDialog } from "../bot/DefaultModel";
import { newConversationPath } from "./new-conversation";
import { botLanding, threadLocator } from "../bot/threadListSwitch";
import { SpaceHeader, spaceLine, spacePageAt, type SpacePage } from "./SpaceHeader";
import { useAppMode } from "./app-mode";
import { accentOf } from "../../theme/engine";
import { publishSceneSignals, workerSlots } from "../../theme/signals";
import { shownAppearance, useAppearanceDraft, useThemeRegistry } from "../../theme/ui/state";
import { NONE_ID, saveTheme, themeChoices, type ThemeChoice } from "../../theme/ui/quick";
import { errorMessage } from "../../kit/format";
import { toast } from "sonner";
export { MEMORY_SUBPATH };
/** "+ New" in a section head: BB's ghost button (kit/ui/button.tsx, as bb's shared Button), at the head's size, pressed while held. */
export const OWN_SCROLL_ATTRIBUTE = "data-studio-own-scroll";
const GLASS_NAV = "studio-root relative flex h-full min-h-0 flex-1 flex-col px-1.5";
const GLASS_ROWS = "-mx-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 [scrollbar-width:none]";
const ROWS_FADE = "linear-gradient(to bottom, #000 calc(100% - 24px), transparent)";
const NEW_BUTTON = "h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground active:bg-state-active";
const SECTION_HEAD = "flex h-8 items-end gap-2 px-2 pb-1 text-xs font-semibold text-muted-foreground";
/** A row's second line and times: the ink at 55% (6a). */
const INK_55 = "text-[color-mix(in_oklab,var(--foreground)_55%,transparent)]";

/** The Bot the sidebar shows: this window's choice, else the server's current Bot, else the first. */
export function shownBot(bots: readonly BotSpace[], chosen: string | null, server: string | null): BotSpace | null {
  return bots.find((bot) => bot.id === chosen) ?? bots.find((bot) => bot.id === server) ?? bots[0] ?? null;
}

function StatusGlyph({ status, slot }: { status: WorkerLine["status"]; slot?: number }) {
  if (status === "running" && slot !== undefined) return <span role="img" aria-label="Running" data-status="running" data-testid="worker-dot" data-worker-slot={slot} className="mx-[2.5px] size-[7px] shrink-0 rounded-full bg-[var(--studio-worker)] shadow-[0_0_6px_var(--studio-worker)]" />;
  if (status === "running") return <span role="img" aria-label="Running" data-status="running" className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent" />;
  if (status === "needs-you") return <span role="img" aria-label="Waiting on an answer" data-status="needs-you" className="mx-[3px] size-1.5 shrink-0 rounded-full bg-warning" />;
  if (status === "failed") return <Icon name="X" className="size-3 shrink-0 text-destructive" aria-label="Failed" />;
  return <Icon name="Check" className="size-3 shrink-0 text-success" aria-label="Done" />;
}

export function ConversationRowView({ row, now, onOpen, menuTarget }: { row: ConversationLine; now: number; onOpen(row: ConversationLine): void; menuTarget: PluginThreadActionTarget | null }) {
  const line = secondLine(row);
  const button = (
    <button type="button" data-testid="conversation-row" data-thread-id={row.threadId} data-needs-you={row.needsYou ? "" : undefined} aria-current={row.selected ? "page" : undefined}
      onClick={() => onOpen(row)}
      draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: row.threadId, title: row.title })); }}
      className={`flex w-full min-w-0 flex-col rounded-md px-2 py-[5px] text-left outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active ${row.needsYou ? "bg-warning/10 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_45%,transparent)]" : ""}`}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span data-testid="conversation-title" className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-foreground">{row.title}</span>
        </span>
        <span data-testid="conversation-time" className={`shrink-0 text-xs tabular-nums ${INK_55}`}>{shortAge(row.updatedAt, now)}</span>
      </span>
      {line.text || line.tone !== "quiet" ? (
        <span data-testid="conversation-line" data-tone={line.tone} className={`flex min-w-0 items-center gap-1.5 text-xs leading-[17px] ${line.tone === "needs-you" ? "text-warning" : INK_55}`}>
          {line.tone === "needs-you" ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
          {line.tone === "running" ? <span role="img" aria-label="Working" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent" /> : null}
          <span className="min-w-0 truncate">{line.text}</span>
        </span>
      ) : null}
    </button>
  );
  return menuTarget ? <ThreadActionsContextMenu thread={menuTarget}><div>{button}</div></ThreadActionsContextMenu> : button;
}

function WorkerRowView({ row, now, onOpen, menuTarget, slot }: { row: WorkerLine; now: number; onOpen(row: WorkerLine): void; menuTarget: PluginThreadActionTarget | null; slot?: number }) {
  const button = (
    <button type="button" data-testid="worker-row" data-thread-id={row.threadId} data-status={row.status} aria-current={row.selected ? "page" : undefined}
      onClick={() => onOpen(row)}
      draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: row.threadId, title: row.title })); }}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[13px] text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active">
      <span className="flex w-3 shrink-0 justify-center"><StatusGlyph status={row.status} slot={slot} /></span>
      <span data-testid="worker-title" className="min-w-0 flex-1 truncate">{row.title}</span>
      {row.sameTitle > 1 ? <span data-testid="worker-repeats" aria-label={`${row.sameTitle} with this title`} className={`shrink-0 text-xs tabular-nums ${INK_55}`}>×{row.sameTitle}</span> : null}
      {row.tag ? <span data-testid="worker-tag" aria-label={row.branch ? `${row.tag} · ${row.branch}` : row.tag} className="max-w-[72px] shrink-0 truncate rounded bg-foreground/[0.06] px-1.5 text-[11px] leading-4 text-muted-foreground">{row.tag}</span> : null}
      <span data-testid="worker-time" className={`shrink-0 text-[11px] tabular-nums ${INK_55}`}>{shortAge(row.updatedAt, now)}</span>
    </button>
  );
  return menuTarget ? <ThreadActionsContextMenu thread={menuTarget}><div>{button}</div></ThreadActionsContextMenu> : button;
}

/**
 * The Bot switcher at the bottom (round 7): each Bot's own icon, the shown
 * one highlighted, an amber mark on one that needs the user, and "+" for a new
 * Bot. Right-click an icon for Edit space and its Theme submenu. Ctrl+Option+n shows the nth.
 */
export function SpaceDots({ bots, current, onSwitch, onNew, onEdit, accents, themes, themeOf, onTheme }: { bots: readonly BotSpace[]; current: string | null; onSwitch(botId: string): void; onNew(): void; onEdit(botId: string): void; accents?: Readonly<Record<string, string>>; themes?: readonly ThemeChoice[]; themeOf?: Readonly<Record<string, string | null>>; onTheme?(botId: string, themeId: string | null): void }) {
  const dots = spaceDots(bots, current);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = switchTarget(bots, current, { step: event.key === "ArrowRight" ? 1 : -1 });
    if (next) { event.preventDefault(); onSwitch(next); }
  };
  return (
    <div className="flex items-center justify-center gap-1.5 py-2" data-studio-no-drag="all">
      <div role="tablist" aria-label="Bots" data-testid="space-dots" onKeyDown={onKeyDown} className="flex items-center gap-1.5">
        {dots.map((dot) => {
          const bot = bots.find((each) => each.id === dot.id)!;
          return (
            <ContextMenu key={dot.id}>
              <ContextMenuTrigger asChild>
                <button type="button" role="tab" aria-selected={dot.active} aria-label={dot.label} tabIndex={dot.active ? 0 : -1}
                  title={dot.shortcut ? `${dot.name} (⌃⌥${dot.shortcut})` : dot.name} aria-keyshortcuts={dot.shortcut ? `Control+Alt+${dot.shortcut}` : undefined}
                  data-testid="space-dot" data-bot-id={dot.id} data-active={dot.active ? "" : undefined} data-amber={dot.amber ? "" : undefined}
                  {...dragSourceProps(refDragItem({ kind: "bot", id: dot.id }, dot.name))}
                  onClick={() => onSwitch(dot.id)}
                  className={`relative flex size-7 items-center justify-center rounded-md outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring ${dot.active ? "bg-state-active" : "opacity-60 hover:opacity-100"}`}>
                  <BotPresence bot={bot} size={24} />
                  {accents?.[dot.id] ? <span aria-hidden data-testid="space-dot-accent" className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full" style={{ background: accents[dot.id] }} /> : null}
                  {dot.amber ? <span aria-hidden data-testid="space-dot-amber" className="absolute right-0.5 top-0.5 size-2 rounded-full border border-[var(--sidebar,var(--background))] bg-warning" /> : null}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEdit(dot.id)}>Edit space…</ContextMenuItem>
                {themes?.length && onTheme ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger data-testid="space-dot-theme">Theme<span aria-hidden className="ml-auto pl-3 text-muted-foreground">›</span></ContextMenuSubTrigger>
                    <ContextMenuSubContent className="max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto">
                      {themes.map((choice) => (
                        <ContextMenuCheckboxItem key={choice.id ?? NONE_ID} checked={(themeOf?.[dot.id] ?? null) === choice.id} onSelect={() => onTheme(dot.id, choice.id)}>{choice.name}</ContextMenuCheckboxItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <button type="button" data-testid="space-new" aria-label="New Bot" onClick={onNew}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><Icon name="Plus" className="size-4" /></button>
    </div>
  );
}

export function BotSidebarPanel({ onNavigate, activeThreadId }: Pick<PluginThreadListProps, "onNavigate" | "activeThreadId">) {
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const call = useCall();
  const chosen = useCurrentBot();
  const spaces = useLive("bot_spaces", {}, { pollMs: 60_000 });
  const bots = spaces.data?.bots ?? NO_BOTS;
  const bot = shownBot(bots, chosen, spaces.data?.currentBotId ?? null);
  const view = useLive("bot_threads_view", bot ? { botId: bot.id } : {}, { enabled: !!bot, pollMs: 15_000 });
  const sidebar = experimental_useSidebarThreads();
  const pathname = usePathname();
  const olderOpen = isOlderPage(pathname);
  const page = spacePageAt(pathname);
  const list = useLive("bot_list", {}, { pollMs: 60_000 });
  const welcome = useLive("bot_welcome", {}, { enabled: !!spaces.data && !bots.length, pollMs: 2_000 });
  const loopsOn = useLoopsEnabled();
  const [editing, setEditing] = useState<string | null>(null);
  const [pickingModel, setPickingModel] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  // The server learns which Bot is shown, so the user's next thread is its conversation.
  useEffect(() => {
    setFocusHandler((botId) => { void call("bot_focus", { botId }).catch(() => {}); });
    return () => setFocusHandler(null);
  }, [call]);
  useEffect(() => { if (bot && currentBot() !== bot.id) setCurrentBot(bot.id); }, [bot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => new Map<string, LiveThread>(sidebar.threads.map((thread) => [thread.id, thread])), [sidebar.threads]);
  const targets = useMemo(() => new Map(sidebar.threads.map((thread): [string, PluginThreadActionTarget] => [thread.id, {
    id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId, parentNotifications: thread.parentNotifications, archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt, sectionId: thread.sectionId, isUnread: thread.isUnread, status: thread.status,
    environment: thread.environment?.id == null ? null : { id: thread.environment.id, path: thread.environment.path },
  }])), [sidebar.threads]);
  const data = view.data && bot && view.data.botId === bot.id ? view.data : null;
  useEffect(() => { for (const row of [...(data?.conversations ?? []), ...(data?.workers ?? [])]) noteBotThread(row.threadId, true); }, [data]);
  const conversations = useMemo(() => conversationLines(data?.conversations ?? [], live, activeThreadId), [data, live, activeThreadId]);
  const workers = useMemo(() => workerLines(data?.workers ?? [], live, activeThreadId), [data, live, activeThreadId]);
  const split = useMemo(() => splitWorkers(workers), [workers]);
  const rowTargets = useMemo(() => {
    const all = new Map(targets);
    for (const row of conversations) if (!all.has(row.threadId)) { const target = hiddenThreadTarget(row, row.running ? "running" : "idle"); if (target) all.set(row.threadId, target); }
    for (const row of workers) if (!all.has(row.threadId)) { const target = hiddenThreadTarget(row, row.status === "running" ? "running" : row.status === "failed" ? "failed" : "idle"); if (target) all.set(row.threadId, target); }
    return all;
  }, [targets, conversations, workers]);
  // The done workers open in place; the one on screen opens them too.
  const [doneOpen, setDoneOpen] = useState(false);
  useEffect(() => { if (split.done.some((row) => row.selected)) setDoneOpen(true); }, [split]);
  const listed = useMemo(() => new Set([...conversations, ...workers].map((row) => row.threadId)), [conversations, workers]);

  // The thread on screen: remembered as this Bot's last one; a thread of another Bot shows that Bot.
  // A switch leaves the thread on screen (or lands on one) without following it back to its own Bot:
  // only a thread opened after the switch moves the sidebar.
  const foreign = !!activeThreadId && !!data && !listed.has(activeThreadId);
  const owner = useLive("bot_thread_info", { threadId: activeThreadId ?? "" }, { enabled: foreign, pollMs: 0 });
  const stayOn = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!bot || !activeThreadId) return;
    if (listed.has(activeThreadId)) { rememberConversation(bot.id, activeThreadId); return; }
    if (stayOn.current.has(activeThreadId)) return;
    if (stayOn.current.size) stayOn.current = new Set();
    const info = owner.data?.info;
    if (info && info.threadId === activeThreadId && info.botId !== bot.id && info.archivedAt === null) { rememberConversation(info.botId, activeThreadId); setCurrentBot(info.botId); }
  }, [bot?.id, activeThreadId, listed, owner.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = useCallback((threadId: string) => { navigate.toThread(threadId); onNavigate(); }, [navigate, onNavigate]);
  // "Studio: Show the Bot" opens threads with BB's navigation while this is mounted.
  useEffect(() => { setThreadOpener((threadId) => navigate.toThread(threadId)); return () => setThreadOpener(null); }, [navigate]);
  useEffect(() => setLinkActionHandler("edit-space", () => { if (!bot) return false; setEditing(bot.id); return true; }), [bot]);
  useEffect(() => watchNewThreadArrivals(), []);
  const hasData = !!data;
  useEffect(() => {
    if (!bot || !data) return;
    const first = !hasLanded();
    markLanded();
    if (activeThreadId || !isLaunchPage(window.location.pathname)) return;
    if (!first && newThreadAsked()) return;
    const target = first ? landingThread(bot, lastConversation(bot.id), listed) : data.conversations.find((row) => row.isMain)?.threadId ?? landingThread(bot, null, null);
    if (target) navigate.toThread(target);
  }, [bot?.id, hasData, pathname, activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchTo = useCallback((botId: string) => {
    const space = bots.find((each) => each.id === botId);
    if (!space || space.id === bot?.id) return;
    setEditing(null);
    const last = lastConversation(botId);
    stayOn.current = new Set([activeThreadId, last, space.mainThreadId].filter((id): id is string => !!id));
    setCurrentBot(botId);
    if (!last && !space.mainThreadId) return;
    void botLanding(last, space.mainThreadId, threadLocator(sdk)).then((target) => {
      if (target) navigate.toThread(target.threadId);
      else navigate.toPluginPanel("studio", { subPath: `bot/${encodeURIComponent(botId)}` });
    });
  }, [bots, bot?.id, navigate, activeThreadId, sdk]);

  // "Studio: Show Bot <n>" (Ctrl+Option+1…9 by default, BB's own keybindings; app.tsx) while the sidebar is mounted.
  // BB keeps Ctrl+1…9 for its "Open thread <n>".
  useEffect(() => {
    setBotSwitcher({ count: bots.length, show: (index) => { const target = switchTarget(bots, bot?.id ?? null, { index }); if (target) switchTo(target); } });
    return () => setBotSwitcher(null);
  }, [bots, bot?.id, switchTo]);

  // A two-finger swipe sideways on the sidebar.
  const swipe = useRef(SWIPE_START);
  const onWheel = (event: WheelEvent<HTMLElement>) => {
    const result = swipeStep(swipe.current, { deltaX: event.deltaX, deltaY: event.deltaY, at: event.timeStamp || Date.now() });
    swipe.current = result.state;
    if (!result.step) return;
    const target = switchTarget(bots, bot?.id ?? null, { step: result.step });
    if (target) switchTo(target);
  };

  const newConversation = () => {
    if (!bot) return;
    markLanded();
    void call("bot_focus", { botId: bot.id }).catch(() => {});
    const main = data?.conversations.find((row) => row.isMain);
    navigate.toPluginPanel("studio", { subPath: newConversationPath(bot.id, main?.projectId ?? null) });
    onNavigate();
  };
  const toPanel = (subPath?: string) => { navigate.toPluginPanel("studio", subPath ? { subPath } : {}); onNavigate(); };
  const editingBot = editing ? bots.find((each) => each.id === editing) ?? null : null;
  const stage = useMainViewRect(!!editingBot);
  const editingInSidebar = !!editingBot && !stage;
  const appearanceDraft = useAppearanceDraft();
  const registry = useThemeRegistry();
  const appMode = useAppMode();
  const appearance = shownAppearance(bot, appearanceDraft);
  const theme = appearance ? registry.get(appearance.themeId) : null;
  const glass = !!theme?.glass;
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const content = glass ? navRef.current?.closest<HTMLElement>('[data-sidebar="content"]') : null;
    if (!content) return;
    content.setAttribute(OWN_SCROLL_ATTRIBUTE, "");
    return () => content.removeAttribute(OWN_SCROLL_ATTRIBUTE);
  });
  const slots = useMemo(() => (theme?.kind === "scene" && appearance?.effects.workers ? workerSlots(workers) : null), [theme, appearance?.effects.workers, workers]);
  const accents = useMemo(() => Object.fromEntries(bots.flatMap((each) => {
    const own = shownAppearance(each, appearanceDraft);
    const accent = own ? accentOf(registry.get(own.themeId), appMode) : null;
    return accent ? [[each.id, accent]] : [];
  })), [bots, appearanceDraft, registry, appMode]);
  const themes = useMemo(() => themeChoices(registry), [registry]);
  const themeOf = useMemo(() => Object.fromEntries(bots.map((each) => [each.id, shownAppearance(each, { draft: null, saved: appearanceDraft.saved })?.themeId ?? null])), [bots, appearanceDraft.saved]);
  const applyTheme = (botId: string, themeId: string | null) => {
    const target = bots.find((each) => each.id === botId);
    if (!target) return;
    saveTheme({ bot: target, themeId, registry, save: (id, next) => call("bot_set_appearance", { botId: id, appearance: next }) })
      .catch((cause: unknown) => { toast.error(errorMessage(cause) || "Couldn't apply the theme."); });
  };
  useEffect(() => {
    publishSceneSignals({
      botId: bot?.id ?? null,
      workers: workers.map((row) => ({ threadId: row.threadId, status: row.status })),
      conversations: conversations.map((row) => ({ threadId: row.threadId, running: row.running, needsYou: !!row.needsYou })),
    });
  }, [bot?.id, workers, conversations]);
  const botRow = list.data?.bots.find((each) => each.id === bot?.id);
  const running = workers.filter((row) => row.status === "running").length + conversations.filter((row) => row.running).length;
  const todosOn = loopsOn && !!bot?.primary;
  const loops = useLive("loops.list", {}, { enabled: todosOn, pollMs: 60_000 });
  const todos = todosOn ? loops.data?.needsYouNow.length ?? 0 : null;
  const openPage = (next: SpacePage) => {
    if (!bot) return;
    if (next === "memory") toPanel(`${MEMORY_SUBPATH}/${encodeURIComponent(bot.id)}`);
    else if (next === "skills") toPanel(skillsPagePath(bot.id));
    else if (next === "library") toPanel();
    else if (next === "automations") { navigate.toPluginPanel("automations"); onNavigate(); }
    else openAppPathTo(loopsPath(bot.id));
  };
  const openAppPathTo = (path: string) => { navigate.toPluginPanel("studio", { subPath: path.replace(/^\/plugins\/studio\/studio\/?/, "") }); onNavigate(); };

  if (spaces.data && !bots.length && welcome.data?.pending !== false) {
    return <nav aria-label="Bot" aria-busy="true" data-testid="bot-sidebar" className="studio-root" />;
  }
  if (spaces.data && !bots.length) {
    return (
      <nav aria-label="Bot" data-testid="bot-sidebar" className="studio-root flex flex-col gap-2 px-3 py-3 text-sm">
        <NoDragStyle />
        <p className="text-muted-foreground">No Bot yet.</p>
        <button type="button" data-studio-no-drag="all" onClick={() => toPanel("bot/new")} className="self-start rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Make your Bot</button>
      </nav>
    );
  }

  return (
    <nav aria-label={bot ? bot.name : "Bot"} data-testid="bot-sidebar" ref={navRef} onWheel={onWheel} className={glass ? GLASS_NAV : "studio-root relative flex min-h-full shrink-0 flex-col px-1.5"}>
      <NoDragStyle />
      <div data-testid="bot-sidebar-rows" {...(glass ? { "data-fork-overlay-scroll": "" } : {})} className={glass ? GLASS_ROWS : "contents"} style={glass ? { maskImage: ROWS_FADE, WebkitMaskImage: ROWS_FADE } : undefined}>
      <SpaceHeader bot={bot} line={spaceLine(botRow, running)} glass={glass} page={page} todos={todos} onPage={openPage}
        menu={{
          editSpace: () => { if (bot) setEditing(bot.id); },
          defaultModel: () => { if (bot) setPickingModel(bot.id); },
          archive: () => { if (bot) toPanel(olderPath(bot.id)); },
          newBot: () => toPanel("bot/new"),
        }} />
      {editingBot ? <EditSpace key={editingBot.id} bot={editingBot} bots={bots} stage={stage} onClose={() => setEditing(null)} /> : null}
      {editingInSidebar ? null : <>
      <section aria-label="Conversations" data-testid="conversations" className="flex flex-col">
        <div className={SECTION_HEAD}>
          <h3 className="min-w-0 flex-1 truncate">Conversations</h3>
          <button type="button" data-testid="new-conversation" onClick={newConversation} disabled={!bot} aria-label="New conversation"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), NEW_BUTTON)}>+ New</button>
        </div>
        {conversations.map((row) => <ConversationRowView key={row.threadId} row={row} now={now} onOpen={(each) => openThread(each.threadId)} menuTarget={rowTargets.get(row.threadId) ?? null} />)}
        {data && !conversations.length ? <Note>No conversations yet</Note> : null}
        {data && olderLabel(data.olderConversations, "conversation") ? <OlderRow testId="older-conversations" open={olderOpen} label={olderLabel(data.olderConversations, "conversation")!} onOpen={() => toPanel(olderPath(bot?.id ?? null))} botId={bot?.id ?? null} /> : null}
        {!data && view.error ? <Note>{view.error}</Note> : null}
      </section>
      <section aria-label="Workers" data-testid="workers" className="flex flex-col pb-2">
        <div className={SECTION_HEAD}><h3>Workers</h3></div>
        {split.active.map((row) => <WorkerRowView key={row.threadId} row={row} now={now} onOpen={(each) => openThread(each.threadId)} menuTarget={rowTargets.get(row.threadId) ?? null} slot={slots?.get(row.threadId)} />)}
        {split.done.length ? (
          <button type="button" data-testid="workers-done" aria-expanded={doneOpen} onClick={() => setDoneOpen((open) => !open)}
            className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none">
            <Icon name={doneOpen ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />{doneLabel(split.done.length)}
          </button>
        ) : null}
        {doneOpen ? split.done.map((row) => <WorkerRowView key={row.threadId} row={row} now={now} onOpen={(each) => openThread(each.threadId)} menuTarget={rowTargets.get(row.threadId) ?? null} />) : null}
        {data && !workers.length ? <Note>No workers yet</Note> : null}
      </section>
      </>}
      <div className="flex-1" />
      </div>
      {pickingModel ? <DefaultModelDialog key={pickingModel} botId={pickingModel} onClose={() => setPickingModel(null)} /> : null}
      {editingInSidebar ? null : <footer className={glass ? "-mx-1.5 shrink-0" : "sticky bottom-0 z-10 -mx-1.5 border-t border-border"} style={glass ? undefined : { background: "var(--sidebar, var(--background))" }}>
        <SpaceDots bots={bots} current={bot?.id ?? null} onSwitch={switchTo} onNew={() => toPanel("bot/new")} onEdit={(botId) => { switchTo(botId); setEditing(botId); }} accents={accents} themes={themes} themeOf={themeOf} onTheme={applyTheme} />
      </footer>}
    </nav>
  );
}

/** The quiet last row of a list: "N older conversations", opening the list in the main view; selected while that list is open. */
/** "N older conversations": the Archive's row, which drags as the Archive (src/tab-kinds.ts). */
function OlderRow({ testId, label, open, onOpen, botId }: { testId: string; label: string; open: boolean; onOpen(): void; botId: string | null }) {
  return (
    <button type="button" data-testid={testId} onClick={onOpen} aria-current={open ? "page" : undefined} {...dragSourceProps(refDragItem({ kind: "archive", id: botId }, "Archive"))}
      className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-state-active aria-[current=page]:text-foreground">{label}</button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}

const NO_BOTS: never[] = [];
