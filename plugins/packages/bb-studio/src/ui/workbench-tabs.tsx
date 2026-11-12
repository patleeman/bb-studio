// Threads and Bots as workbench tabs, and the picker that opens any thread,
// Bot or item as one. A thread tab is BB's own chat for that thread; a Bot
// tab is the Bot's chat under its card, so a Bot never reads as an ordinary
// thread. Nothing here creates a thread: the picker only opens what exists.
// The workbench's + and its shortcut are BB's own new tab page; Thread and
// Bot are ordinary entries there, and opened from it (no params yet) they
// show the picker.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { experimental_useAppPanel, experimental_useSidebarThreads, ThreadChat, useBbNavigate, useRpc, type ExperimentalPanelController, type ExperimentalTabRegistration, type JsonValue } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { noteOpened } from "./opened-items";
import { searchEscape } from "../kit/ui/search-escape";
import { ItemRow, RowNote } from "./item-row";
import { compactAge } from "./bot/ThreadsSection";
import { OFF_NEW_TAB, openThreadTab, threadTab } from "../kit/app/thread-panel";
import { ITEM_THREAD_TAB, openPageTab, pageTab, THREAD_TAB } from "../kit/app/workbench";
import { ItemThreadTab } from "../chat/ui/ConversationComposer";
import { BotFace } from "../presence/ui/BotFace";
import { botProvider } from "./bot/BotAvatar";
import { useLive } from "./live";
import { workbenchItem } from "./studio-open";
import { itemParams, STUDIO_TAB, tabKind } from "./studio-tab/model";
import { BOT_TAB_ICON } from "./bot/bot-tab-icon";
import { newTabFields, newTabTitle } from "../tab-kinds";

export { ITEM_THREAD_TAB, THREAD_TAB };
export const BOT_TAB = "bot";

interface Hit { ref: { pluginId: string; id: string }; kind: string; title: string; href: string; projectId?: string | null; updatedAt?: number }
interface BotRow { id: string; name: string; avatar: string; shape?: string | null; color?: string | null; threadId?: string | null; state: string; kind?: string | null; providerId?: string | null }

/** What the picker opens: a tab by id with its params and title. */
export interface WorkbenchTarget { tabId: string; params: JsonValue; title: string }

const stringParam = (params: JsonValue | null, key: string): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

/** A Bot as Studio shows one everywhere: its avatar, its name, and what waits on you. */
export function BotCard({ bot, subtitle, size = 32, tone }: { bot: BotRow; subtitle?: string | null; size?: number; tone?: "warning" }) {
  return (
    <span className="flex min-w-0 items-center gap-3" data-testid="bot-card">
      <BotFace botId={bot.id} size={size} still provider={botProvider(bot)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{bot.name}</span>
        <span className={`block truncate text-xs ${subtitle && tone === "warning" ? "text-warning" : "text-muted-foreground"}`}>{subtitle || (bot.state === "active" ? "Bot" : `Bot · ${bot.state}`)}</span>
      </span>
    </span>
  );
}

function useBotSubtitle(botId: string): string | null {
  return useLive("bot_attention", { botId }, { pollMs: 30_000 }).data?.attention?.reason ?? null;
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

/** A thread in the workbench: BB's chat for it. */
export function ThreadTabView({ params }: { params: JsonValue | null }) {
  const threadId = stringParam(params, "threadId");
  if (!threadId) return <Unavailable>This thread can’t be shown.</Unavailable>;
  return <div className="flex h-full min-h-0 flex-col" data-testid="workbench-thread"><ThreadChat threadId={threadId} variant="compact" /></div>;
}

/** A Bot in the workbench: its card, then its chat. */
export function BotTabView({ params }: { params: JsonValue | null }) {
  const botId = stringParam(params, "botId");
  const view = useLive("bot_get", botId ? { botId } : {}, { enabled: !!botId, pollMs: 60_000 });
  const subtitle = useBotSubtitle(botId ?? "");
  const bot = view.data?.bot ?? null;
  if (!botId || (view.data && !bot)) return <Unavailable>This Bot is gone.</Unavailable>;
  if (!bot) return null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workbench-bot">
      <div className="shrink-0 border-b border-border px-4 py-3"><BotCard bot={bot} subtitle={subtitle} size={36} /></div>
      {bot.threadId ? <div className="min-h-0 flex-1"><ThreadChat threadId={bot.threadId} variant="compact" /></div> : <Unavailable>This Bot has no chat yet.</Unavailable>}
    </div>
  );
}

/** The tab a search hit opens, or null for one with no workbench view. */
export function targetForHit(hit: Pick<Hit, "kind" | "title" | "href" | "ref">): WorkbenchTarget | null {
  if (hit.kind === "thread") return { tabId: THREAD_TAB, params: { threadId: hit.ref.id }, title: hit.title || "Thread" };
  const item = workbenchItem(hit.href);
  return item ? { tabId: STUDIO_TAB, params: itemParams(item.kind, item.id) as JsonValue, title: hit.title || "Untitled" } : null;
}

function PickerBot({ bot, onPick }: { bot: BotRow; onPick(target: WorkbenchTarget): void }) {
  const subtitle = useBotSubtitle(bot.id);
  return (
    <button type="button" data-testid="picker-bot" onClick={() => onPick({ tabId: BOT_TAB, params: { botId: bot.id }, title: bot.name })}
      className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left hover:bg-state-hover">
      <BotCard bot={bot} subtitle={subtitle} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className="flex flex-col gap-1"><h3 className="px-1 text-xs font-medium text-muted-foreground">{title}</h3>{children}</section>;
}

/** The picker: Bots in their own section, then threads and items that match. */
export function WorkbenchPicker({ onPick }: { onPick(target: WorkbenchTarget): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const bots = useLive("bot_list", {}, { pollMs: 60_000 }).data?.bots ?? [];
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const text = query.trim().slice(0, 200);
      // Threads are asked for on their own, so items never crowd them out.
      void Promise.all([
        rpc.call("searchAll", { query: text, kinds: ["thread"], limit: 8 }).catch(() => []),
        rpc.call("searchAll", { query: text, limit: 30 }).catch(() => []),
      ]).then(([threads, all]) => { if (live) setHits([...threads, ...all.filter((hit) => hit.kind !== "thread")]); });
    }, query ? 150 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [rpc, query]);
  const needle = query.trim().toLowerCase();
  const shownBots = bots.filter((bot) => !needle || bot.name.toLowerCase().includes(needle));
  const rows = useMemo(() => hits.flatMap((hit) => { const target = targetForHit(hit); return target ? [{ hit, target }] : []; }), [hits]);
  // With nothing typed, search has no threads to offer: the sidebar's recent ones stand in.
  const sidebarData = experimental_useSidebarThreads();
  const sidebar = sidebarData.threads;
  const recent = useMemo(() => (needle ? [] : [...sidebar].filter((thread) => !thread.isArchived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
    .map((thread) => ({ hit: { ref: { pluginId: "bb", id: thread.id }, kind: "thread", title: thread.title ?? "Untitled thread", href: `/threads/${thread.id}`, projectId: thread.projectId, updatedAt: thread.updatedAt }, target: { tabId: THREAD_TAB, params: { threadId: thread.id }, title: thread.title ?? "Untitled thread" } }))), [needle, sidebar]);
  const found = rows.filter((row) => row.hit.kind === "thread");
  const threads = found.length ? found : recent;
  const items = rows.filter((row) => row.hit.kind !== "thread");
  const projectNames = useMemo(() => new Map(sidebarData.projects.map((project) => [project.id, project.name])), [sidebarData.projects]);
  // A thread shows its project and age, so two with the same title can be told apart; an item shows its kind.
  const note = (hit: Hit) => hit.kind === "thread"
    ? [hit.projectId ? projectNames.get(hit.projectId) : null, hit.updatedAt ? compactAge(hit.updatedAt) : null].filter(Boolean).join(" · ")
    : tabKind(hit.kind)?.label ?? hit.kind;
  const row = ({ hit, target }: (typeof rows)[number]) => (
    <ItemRow key={`${hit.ref.pluginId}:${hit.ref.id}`} testId="picker-row" kind={hit.kind} title={target.title} trailing={<RowNote>{note(hit)}</RowNote>}
      onOpen={() => { void noteOpened(hit.href); onPick(target); }} />
  );
  return (
    <div className="studio-root flex h-full min-h-0 flex-col gap-3 p-3" data-testid="workbench-picker">
      <input autoFocus type="text" aria-label="Open a thread, Bot or item" placeholder="Open a thread, Bot or item" value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={searchEscape(query, () => setQuery(""), { whenEmpty: "blur" })}
        className="h-9 w-full shrink-0 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {shownBots.length ? <Section title="Bots"><div className="flex flex-col gap-1.5">{shownBots.map((bot) => <PickerBot key={bot.id} bot={bot} onPick={onPick} />)}</div></Section> : null}
        {threads.length ? <Section title="Threads">{threads.map(row)}</Section> : null}
        {items.length ? <Section title="Items">{items.map(row)}</Section> : null}
        {!shownBots.length && !rows.length ? <p className="px-1 text-sm text-muted-foreground">Nothing matches.</p> : null}
      </div>
    </div>
  );
}

/** Opens `target` in place of the picker's own tab. */
function replacePicker(panel: ExperimentalPanelController, open: () => boolean): void {
  const own = panel.getTabs().selectedKey;
  if (open() && own) panel.closeTab(own);
}

function ThreadPicker() {
  const panel = experimental_useAppPanel();
  return <WorkbenchPicker onPick={(target) => replacePicker(panel, () => openThreadTab(panel, { actionId: target.tabId, params: target.params, title: target.title }))} />;
}

function PagePicker() {
  const panel = experimental_useAppPanel();
  return <WorkbenchPicker onPick={(target) => replacePicker(panel, () => openPageTab(panel, target))} />;
}

/**
 * A new thread about an item (the item header's new-thread button): its
 * composer, then the thread itself in the same place once the first message
 * is sent. If the workbench declines the thread's tab, it opens in the main view.
 */
function itemThreadTab(open: (panel: ExperimentalPanelController, target: WorkbenchTarget) => boolean) {
  return function ItemThreadWorkbenchTab({ params }: { params: JsonValue | null }) {
    const panel = experimental_useAppPanel();
    const navigate = useBbNavigate();
    return <ItemThreadTab params={params} onStarted={(threadId, title) => {
      const own = panel.getTabs().selectedKey;
      if (!open(panel, { tabId: THREAD_TAB, params: { threadId }, title })) { navigate.toThread(threadId); return; }
      if (own) panel.closeTab(own);
    }} />;
  };
}

/**
 * Registers the thread tab, the Bot tab and the picker for a thread's
 * workbench, and for the Studio page's too where the workbench has a Global
 * section (`page`).
 */
export function registerWorkbenchTabs(app: { slots: { experimental_tab(registration: ExperimentalTabRegistration): void } }, options: { page: boolean }): void {
  const tabs = [
    // Opened bare from the New Tab page it is the picker: "Conversation" under "Open" (src/tab-kinds.ts).
    { id: THREAD_TAB, title: newTabTitle(THREAD_TAB) ?? "Conversation", icon: "MessageSquare", view: ThreadTabView },
    { id: BOT_TAB, title: "Bot", icon: "Bot", view: BotTabView },
  ] as const;
  // Opened from BB's new tab page a tab has no params yet: it shows the picker.
  const orPicker = (View: (props: { params: JsonValue | null }) => ReactNode, Picker: () => ReactNode) =>
    function WorkbenchTab({ params }: { params: JsonValue | null }) { return params !== null ? <View params={params} /> : <Picker />; };
  for (const tab of tabs) {
    // A Bot's tab draws its avatar (src/ui/bot/bot-tab-icon.ts), and the
    // Bot opens from its own controls, not BB's New Tab page.
    const asFixed: object = tab.id === BOT_TAB ? { ...BOT_TAB_ICON, ...OFF_NEW_TAB } : newTabFields(tab.id);
    const common = { title: tab.title, icon: tab.icon, layout: "flush" as const, ...asFixed };
    app.slots.experimental_tab({ ...threadTab(tab.id), ...common, component: orPicker(tab.view, ThreadPicker) });
    if (options.page) app.slots.experimental_tab({ ...pageTab(tab.id), ...common, component: orPicker(tab.view, PagePicker) });
  }
  const itemThread = { title: "New thread", icon: "MessageSquarePlus", layout: "flush" as const, ...OFF_NEW_TAB };
  app.slots.experimental_tab({ ...threadTab(ITEM_THREAD_TAB), ...itemThread, component: itemThreadTab((panel, target) => openThreadTab(panel, { actionId: target.tabId, params: target.params, title: target.title })) });
  if (options.page) app.slots.experimental_tab({ ...pageTab(ITEM_THREAD_TAB), ...itemThread, component: itemThreadTab(openPageTab) });
}
