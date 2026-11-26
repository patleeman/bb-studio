// The Bot sidebar (round 7, "the Bot as a space"): one Bot per sidebar.
// - Top, sticky: the Bot's space header (SpaceHeader.tsx): avatar, name, its
//   status (running count, Paused), a ··· menu (Edit <name>…, Bot settings…, Default model
//   with bb's model picker, New Bot), and its pages as rows (Memory,
//   Skills, Library, Todos, Conversations: every conversation, active and
//   archived, with search; OlderPage.tsx). Edit space
//   (EditSpace.tsx) covers the main view, or takes the lists' place where
//   BB has none.
// - Conversations, with "+ New" (BB's ghost button; BB's new-thread composer on
//   a Studio page, seeded with the Bot's default model): two-line rows, the title and
//   its time, then the latest reply (a spinner while it works), or, amber
//   and outlined, why it needs the user. A fork made at a message has no row:
//   it shows at that message, and its work and needs-you show on its parent's row.
// - Workers nest under the conversation that started them: a conversation
//   with workers has a toggle on its second line (a chevron and the count; a
//   spinner while one runs, amber while one needs the user) that opens its
//   worker threads under it, indented, remembered per conversation. A worker
//   another worker started sits under that one, indented once more. Each
//   level shows the running and waiting ones and folds the rest into "N done".
//   The Bot's own threads (area runners, automation and check-in runs) sit
//   under its Main in a "Runners" fold, closed by default. A worker with no
//   home at all is under "Other workers" at the bottom, which only shows when
//   it has one. A worker never asks the user itself: the Bot raises it in the
//   worker's conversation.
// - At the bottom, each Bot's icon (the shown one highlighted, an amber mark
//   when it needs the user) and + for a new Bot. A click, a two-finger swipe
//   sideways on the sidebar or "Studio: Show Bot <n>" (Ctrl+Option+1…9)
//   switches the whole sidebar; the main
//   view goes to that Bot's last-open conversation, else its Main.
// The server's view (bot_threads_view) and BB's live thread state are merged
// in model.ts. The header and the switcher are marked no-drag.
import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_useProviders as useProviders, experimental_useSidebarThreads, useBbNavigate, useSdk, type PluginThreadActionTarget, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type WheelEvent } from "react";
import type { BotSpace } from "../../bot-threads-contract";
import { Icon } from "../../kit/app/index";
import { useNow } from "../../kit/app/visible-poll";
import { noteBotThread } from "./bot-thread-owners";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "../../kit/ui/context-menu";
import { dragSourceProps, refDragItem, threadDragItem, writeDragItem } from "../../kit/app/item-drag";
import { NoDragStyle } from "../../kit/ui/no-drag";
import { buttonVariants } from "../../kit/ui/button";
import { cn } from "../../kit/ui/utils";
import { usePathname } from "../../kit/app/route";
import { BotPresence } from "../../presence/ui/BotPresence";
import { resolveTheme } from "../../theme/appearance";
import { useCall, useLive } from "../live";
import { conversationLines, doneLabel, foldLevel, hiddenThreadTarget, landingThread, nestLabel, olderPath, secondLine, shortAge, spaceDots, subtree, swipeStep, switchTarget, SWIPE_START, workerLines, workerNests, type ConversationLine, type LiveThread, type WorkerLine, type WorkerNest, type WorkerCounts, type WorkerNode } from "./model";
import { currentBot, hasLanded, isLaunchPage, lastConversation, markLanded, newThreadAsked, openWorkerNests, rememberConversation, setBotSwitcher, setCurrentBot, setConversationStarter, setFocusHandler, setThreadOpener, setWorkerNestOpen, useCurrentBot, watchNewThreadArrivals } from "./state";

import { MEMORY_SUBPATH } from "../../memory/shared";
import { skillsPagePath } from "../skills/paths";
import { EditSpace } from "./EditSpace";
import { setLinkActionHandler } from "../../links/actions";
import { useMainViewRect } from "./EditSpaceStage";
import { DefaultModelDialog } from "../bot/DefaultModel";
import { newConversationPath } from "./new-conversation";
import { botLanding, threadLocator } from "../bot/threadListSwitch";
import { resumeWord, SpaceHeader, spaceLine, spacePageAt, type SpacePage } from "./SpaceHeader";
import { useAppMode } from "./app-mode";
import { accentOf } from "../../theme/engine";
import { publishSceneSignals, workerSlots } from "../../theme/signals";
import { ProviderMark } from "./ProviderMark";
import type { ProviderCatalogEntry } from "../bot/ProviderStatusMark";
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

/**
 * A conversation's workers toggle: a chevron and how many workers it has; a
 * spinner while one runs, amber while one needs the user, so a closed nest
 * still shows its work. Separate from the row's own click.
 */
export const WorkersToggle = memo(function WorkersToggle({ nest, open, onToggle, title }: { nest: Pick<WorkerNest<unknown>, "total" | "running" | "needsYou">; open: boolean; onToggle(): void; title: string }) {
  const tone = nest.needsYou ? "needs-you" : nest.running ? "running" : "quiet";
  return (
    <button type="button" data-testid="workers-toggle" data-tone={tone} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${title}'s workers: ${nestLabel(nest)}`}
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      className={`flex h-[18px] items-center gap-1 rounded px-1 text-[11px] font-medium tabular-nums outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring ${tone === "needs-you" ? "bg-warning/15 text-warning" : tone === "running" ? "text-foreground" : INK_55} ${open ? "bg-state-active" : ""}`}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3 shrink-0" />
      {tone === "needs-you" ? <span aria-hidden data-testid="workers-toggle-amber" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
      {tone === "running" ? <span aria-hidden data-testid="workers-toggle-spinner" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none" /> : null}
      <span data-testid="workers-toggle-count">{nest.total}</span>
    </button>
  );
});

export const ConversationRowView = memo(function ConversationRowView({ row, now, onOpen, menuTarget, providers = NO_PROVIDERS, toggle = null }: { row: ConversationLine; now: number; onOpen(row: ConversationLine): void; menuTarget: PluginThreadActionTarget | null; providers?: readonly ProviderCatalogEntry[]; toggle?: ReactNode }) {
  const line = secondLine(row);
  const button = (
    <button type="button" data-testid="conversation-row" data-thread-id={row.threadId} data-needs-you={row.needsYou ? "" : undefined} aria-current={row.selected ? "page" : undefined}
      onClick={() => onOpen(row)}
      draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: row.threadId, title: row.title })); }}
      className={`flex w-full min-w-0 flex-col rounded-md px-2 py-[5px] text-left outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active ${row.needsYou ? "bg-warning/10 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_45%,transparent)]" : ""}`}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <ProviderMark provider={row} providers={providers} />
          <span data-testid="conversation-title" className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-foreground">{row.title}</span>
        </span>
        <span data-testid="conversation-time" className={`shrink-0 text-xs tabular-nums ${INK_55}`}>{shortAge(row.updatedAt, now)}</span>
      </span>
      {line.text || line.tone !== "quiet" || toggle ? (
        <span data-testid="conversation-line" data-tone={line.tone} className={`flex min-h-[17px] min-w-0 items-center gap-1.5 text-xs leading-[17px] ${toggle ? "pr-12" : ""} ${line.tone === "needs-you" ? "text-warning" : line.tone === "failed" ? "text-destructive" : INK_55}`}>
          {line.tone === "needs-you" ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
          {line.tone === "running" ? <span role="img" aria-label="Working" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent" /> : null}
          {line.tone === "failed" ? <Icon name="X" className="size-3 shrink-0" aria-hidden /> : null}
          <span className="min-w-0 truncate">{line.text}</span>
        </span>
      ) : null}
    </button>
  );
  const item = toggle ? <div className="relative">{button}<span className="absolute bottom-[5px] right-1.5 flex">{toggle}</span></div> : button;
  return menuTarget ? <ThreadActionsContextMenu thread={menuTarget}><div>{item}</div></ThreadActionsContextMenu> : item;
});

export const WorkerRowView = memo(function WorkerRowView({ row, now, onOpen, menuTarget, slot, providers = NO_PROVIDERS }: { row: WorkerLine; now: number; onOpen(row: WorkerLine): void; menuTarget: PluginThreadActionTarget | null; slot?: number; providers?: readonly ProviderCatalogEntry[] }) {
  const button = (
    <button type="button" data-testid="worker-row" data-thread-id={row.threadId} data-status={row.status} aria-current={row.selected ? "page" : undefined}
      onClick={() => onOpen(row)}
      draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "all"; writeDragItem(event.dataTransfer, threadDragItem({ id: row.threadId, title: row.title })); }}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[13px] text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-state-active">
      <span className="flex w-3 shrink-0 justify-center"><StatusGlyph status={row.status} slot={slot} /></span>
      <ProviderMark provider={row} providers={providers} />
      <span data-testid="worker-title" className="min-w-0 flex-1 truncate">{row.title}</span>
      {row.sameTitle > 1 ? <span data-testid="worker-repeats" aria-label={`${row.sameTitle} with this title`} className={`shrink-0 text-xs tabular-nums ${INK_55}`}>×{row.sameTitle}</span> : null}
      {row.tag ? <span data-testid="worker-tag" aria-label={row.branch ? `${row.tag} · ${row.branch}` : row.tag} className="max-w-[72px] shrink-0 truncate rounded bg-foreground/[0.06] px-1.5 text-[11px] leading-4 text-muted-foreground">{row.tag}</span> : null}
      <span data-testid="worker-time" className={`shrink-0 text-[11px] tabular-nums ${INK_55}`}>{shortAge(row.updatedAt, now)}</span>
    </button>
  );
  return menuTarget ? <ThreadActionsContextMenu thread={menuTarget}><div>{button}</div></ThreadActionsContextMenu> : button;
});

const NEST_INDENT = "pl-3";

/**
 * One level of a nest: the running and waiting workers, each with the workers
 * it started under it, then "N done" folding the rest (open while the worker
 * on screen is among them). A single finished worker shows as it is: its fold
 * would take the same row.
 */
export function WorkerNestLevel({ nodes, foldKey, now, row: rowProps, folds, onFold, fold = true }: {
  nodes: readonly WorkerNode<WorkerLine>[]; foldKey: string; now: number;
  /** Fold the finished ones into "N done"; off under a finished worker, whose workers are all finished too and show as they are. */
  fold?: boolean;
  /** The user's choice for each "N done" (by its parent's id, or the conversation's); without one it is open while it holds the worker on screen. */
  folds: ReadonlyMap<string, boolean>; onFold(key: string, open: boolean): void;
  row: Omit<Parameters<typeof WorkerRowView>[0], "row" | "menuTarget" | "slot"> & { targetOf(threadId: string): PluginThreadActionTarget | null; slotOf(threadId: string): number | undefined };
}) {
  const level = fold ? foldLevel(nodes) : { shown: [...nodes], done: [], doneCount: 0 };
  const holdsSelected = level.done.some((node) => subtree(node).some((each) => each.selected));
  const open = folds.get(foldKey) ?? holdsSelected;
  const draw = (node: WorkerNode<WorkerLine>, folding: boolean) => (
    <div key={node.row.threadId} data-testid="worker-node" data-thread-id={node.row.threadId}>
      <WorkerRowView row={node.row} now={now} onOpen={rowProps.onOpen} providers={rowProps.providers} menuTarget={rowProps.targetOf(node.row.threadId)} slot={rowProps.slotOf(node.row.threadId)} />
      {node.children.length ? (
        <div role="group" aria-label={`Started by ${node.row.title}`} data-testid="worker-children" className={NEST_INDENT}>
          <WorkerNestLevel nodes={node.children} foldKey={node.row.threadId} now={now} row={rowProps} folds={folds} onFold={onFold} fold={folding} />
        </div>
      ) : null}
    </div>
  );
  return <>
    {level.shown.map((node) => draw(node, fold))}
    {level.doneCount ? (
      <button type="button" data-testid="nest-done" aria-expanded={open} onClick={() => onFold(foldKey, !open)}
        className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${INK_55}`}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3 shrink-0" />{doneLabel(level.doneCount)}
      </button>
    ) : null}
    {open ? level.done.map((node) => draw(node, false)) : null}
  </>;
}

/**
 * The Bot's own threads (area runners, automation and check-in runs) in a
 * fold of their own inside Main's nest: closed by default, with a count, a
 * spinner while one runs, amber while one needs the user; open while it holds
 * the thread on screen, until the user closes it.
 */
export function RunnersFold({ nodes, counts, foldKey, now, row, folds, onFold }: Omit<Parameters<typeof WorkerNestLevel>[0], "fold"> & { counts: WorkerCounts }) {
  const holdsSelected = nodes.some((node) => subtree(node).some((each) => each.selected));
  const open = folds.get(foldKey) ?? holdsSelected;
  const tone = counts.needsYou ? "needs-you" : counts.running ? "running" : "quiet";
  return <>
    <button type="button" data-testid="runners-fold" data-tone={tone} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} runners: ${nestLabel(counts, "thread")}`}
      onClick={() => onFold(foldKey, !open)}
      className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tone === "needs-you" ? "text-warning" : INK_55}`}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Runners</span>
      {tone === "needs-you" ? <span aria-hidden data-testid="runners-fold-amber" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
      {tone === "running" ? <span aria-hidden data-testid="runners-fold-spinner" className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none" /> : null}
      <span data-testid="runners-fold-count" className="shrink-0 tabular-nums">{counts.total}</span>
    </button>
    {open ? (
      <div role="group" aria-label="Runners" data-testid="runners" className={NEST_INDENT}>
        <WorkerNestLevel nodes={nodes} foldKey={`${foldKey}:done`} now={now} row={row} folds={folds} onFold={onFold} />
      </div>
    ) : null}
  </>;
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
                  <BotPresence bot={bot} size={24} still={!dot.active && !dot.amber && !bot.activity?.turn && !bot.activity?.workers} />
                  {accents?.[dot.id] ? <span aria-hidden data-testid="space-dot-accent" className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full" style={{ background: accents[dot.id] }} /> : null}
                  {dot.amber ? <span aria-hidden data-testid="space-dot-amber" className="absolute right-0.5 top-0.5 size-2 rounded-full border border-[var(--sidebar,var(--background))] bg-warning" /> : null}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onEdit(dot.id)}>Edit {dot.name}…</ContextMenuItem>
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
  const providers = useProviders().providers;
  const pathname = usePathname();
  const page = spacePageAt(pathname);
  const list = useLive("bot_list", {}, { pollMs: 60_000 });
  // Polled while onboarding runs: before the first Bot, and after it until its first chat starts (its problem shows on the header's line).
  const welcomeSeen = useRef<boolean | null>(null);
  const welcome = useLive("bot_welcome", {}, { enabled: !!spaces.data && (!bots.length || welcomeSeen.current !== false), pollMs: 2_000 });
  if (welcome.data) welcomeSeen.current = welcome.data.pending;
  const [editing, setEditing] = useState<string | null>(null);
  const [pickingModel, setPickingModel] = useState<string | null>(null);
  const now = useNow(60_000);

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
  const nested = useMemo(() => workerNests(conversations, workers), [conversations, workers]);
  const rowTargets = useMemo(() => {
    const all = new Map(targets);
    for (const row of conversations) if (!all.has(row.threadId)) { const target = hiddenThreadTarget(row, row.running ? "running" : "idle"); if (target) all.set(row.threadId, target); }
    for (const row of workers) if (!all.has(row.threadId)) { const target = hiddenThreadTarget(row, row.status === "running" ? "running" : row.status === "failed" ? "failed" : "idle"); if (target) all.set(row.threadId, target); }
    return all;
  }, [targets, conversations, workers]);
  // A conversation's workers open under it: as the user left it (remembered), else while it holds the worker on screen.
  const [openNests, setOpenNests] = useState(openWorkerNests);
  const [nestChoices, setNestChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const nestOpen = (threadId: string, nest: WorkerNest<WorkerLine>) => nestChoices.get(threadId) ?? (openNests.has(threadId) || [...nest.nodes, ...nest.runners].some((node) => subtree(node).some((each) => each.selected)));
  const toggleNest = (threadId: string, open: boolean) => {
    setOpenNests(setWorkerNestOpen(threadId, open));
    setNestChoices((choices) => new Map(choices).set(threadId, open));
  };
  const [folds, setFolds] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const onFold = useCallback((key: string, open: boolean) => setFolds((choices) => new Map(choices).set(key, open)), []);
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
    const main = data.conversations.find((row) => row.isMain)?.threadId ?? landingThread(bot, null, null);
    const target = first ? landingThread(bot, lastConversation(bot.id), listed) : main;
    // Only somewhere that's there: a deleted or archived Main (being replaced) lands nowhere rather than on BB's not-found page.
    if (target) void botLanding(target, main, threadLocator(sdk)).then((found) => { if (found) navigate.toThread(found.threadId); });
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

  const newConversation = (): boolean => {
    if (!bot) return false;
    markLanded();
    void call("bot_focus", { botId: bot.id }).catch(() => {});
    const main = data?.conversations.find((row) => row.isMain);
    navigate.toPluginPanel("studio", { subPath: newConversationPath(bot.id, main?.projectId ?? null) });
    onNavigate();
    return true;
  };
  const toPanel = (subPath?: string) => { navigate.toPluginPanel("studio", subPath ? { subPath } : {}); onNavigate(); };
  const newConversationRef = useRef(newConversation);
  newConversationRef.current = newConversation;
  useEffect(() => { setConversationStarter(() => newConversationRef.current()); return () => setConversationStarter(null); }, []);
  const editingBot = editing ? bots.find((each) => each.id === editing) ?? null : null;
  const stage = useMainViewRect(!!editingBot);
  const editingInSidebar = !!editingBot && !stage;
  const appearanceDraft = useAppearanceDraft();
  const registry = useThemeRegistry();
  const appMode = useAppMode();
  const appearance = shownAppearance(bot, appearanceDraft);
  const theme = resolveTheme(registry, appearance).theme;
  const glass = !!theme?.glass;
  const navRef = useRef<HTMLElement>(null);
  const hasMainNav = !(spaces.data && !bots.length);
  useLayoutEffect(() => {
    const content = glass && hasMainNav ? navRef.current?.closest<HTMLElement>('[data-sidebar="content"]') : null;
    if (!content) return;
    content.setAttribute(OWN_SCROLL_ATTRIBUTE, "");
    return () => content.removeAttribute(OWN_SCROLL_ATTRIBUTE);
  }, [glass, hasMainNav]);
  const slots = useMemo(() => (theme?.kind === "scene" && appearance?.effects.workers ? workerSlots(workers) : null), [theme, appearance?.effects.workers, workers]);
  const accents = useMemo(() => Object.fromEntries(bots.flatMap((each) => {
    const own = shownAppearance(each, appearanceDraft);
    const accent = own ? accentOf(resolveTheme(registry, own).theme, appMode) : null;
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
  const openConversation = useCallback((row: ConversationLine) => openThread(row.threadId), [openThread]);
  const openWorker = useCallback((row: WorkerLine) => openThread(row.threadId), [openThread]);
  const workerRow = useMemo(() => ({ now, onOpen: openWorker, providers, targetOf: (id: string) => rowTargets.get(id) ?? null, slotOf: (id: string) => slots?.get(id) }), [now, openWorker, providers, rowTargets, slots]);
  const botRow = list.data?.bots.find((each) => each.id === bot?.id);
  const running = workers.filter((row) => row.status === "running").length + conversations.filter((row) => row.running).length;
  const openPage = (next: SpacePage) => {
    if (!bot) return;
    if (next === "memory") toPanel(`${MEMORY_SUBPATH}/${encodeURIComponent(bot.id)}`);
    else if (next === "skills") toPanel(skillsPagePath(bot.id));
    else if (next === "library") toPanel();
    else if (next === "automations") { navigate.toPluginPanel("automations"); onNavigate(); }
    else if (next === "conversations") toPanel(olderPath(bot.id));
  };

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
      <SpaceHeader bot={bot} line={welcome.data?.pending && welcome.data.problem ? welcome.data.problem : botRow?.mainProblem ?? spaceLine(botRow, running)} resume={resumeWord(botRow)} chooseModel={!!botRow?.mainNeedsModel} glass={glass} page={page} onPage={openPage}
        menu={{
          resume: () => {
            if (!bot) return;
            void call("bot_resume", { botId: bot.id }).then(() => list.refresh(), (cause: unknown) => { toast.error(errorMessage(cause) || `Couldn't resume ${bot.name}.`); });
          },
          editSpace: () => { if (bot) setEditing(bot.id); },
          botSettings: () => { if (bot) toPanel(`bot/${encodeURIComponent(bot.id)}/controls`); },
          defaultModel: () => { if (bot) setPickingModel(bot.id); },
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
        {conversations.map((row) => {
          const nest = nested.nests.get(row.threadId);
          const open = !!nest && nestOpen(row.threadId, nest);
          return (
            <div key={row.threadId} data-testid="conversation-item">
              <ConversationRowView row={row} now={now} onOpen={openConversation} menuTarget={rowTargets.get(row.threadId) ?? null} providers={providers}
                toggle={nest ? <WorkersToggle nest={nest} open={open} title={row.title} onToggle={() => toggleNest(row.threadId, !open)} /> : null} />
              {nest && open ? (
                <div role="group" aria-label={`${row.title}'s workers`} data-testid="worker-nest" data-conversation={row.threadId} className={NEST_INDENT}>
                  <WorkerNestLevel nodes={nest.nodes} foldKey={row.threadId} now={now} row={workerRow} folds={folds} onFold={onFold} />
                  {nest.runners.length ? <RunnersFold nodes={nest.runners} counts={nest.runnerCounts} foldKey={`${row.threadId}:runners`} now={now} row={workerRow} folds={folds} onFold={onFold} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {data && !conversations.length ? <Note>No conversations yet</Note> : null}
        {!data && view.error ? <Note>{view.error}</Note> : null}
      </section>
      {nested.other ? (
        <section aria-label="Other workers" data-testid="other-workers" className="flex flex-col pb-2">
          <div className={SECTION_HEAD}><h3>Other workers</h3></div>
          <WorkerNestLevel nodes={nested.other.nodes} foldKey="" now={now} row={workerRow} folds={folds} onFold={onFold} />
        </section>
      ) : null}
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

function Note({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}

const NO_BOTS: never[] = [];
const NO_PROVIDERS: readonly ProviderCatalogEntry[] = [];
