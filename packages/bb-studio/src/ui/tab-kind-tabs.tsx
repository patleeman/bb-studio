// The tabs the tab kinds registry (src/tab-kinds.ts) adds beside a
// conversation, named as it names them:
// - the Bot's pages as workbench tabs: Memory, Library, Automations and the
//   Archive (Todos is the Todos pane, src/loops); each shows the Bot the
//   sidebar shows, or the one in its params (`{ botId }`);
// - the New Tab page's "New …" actions (New conversation, New page, New
//   whiteboard, …): action tabs whose `run` makes the thing and opens it as a
//   tab beside the conversation (a conversation starts in the main view, on
//   the Bot's + New page, as the sidebar's + New does).
import { experimental_useAppPanel, type ExperimentalPanelController, type JsonValue } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { hasGlobalWorkbench } from "../kit/app/host-sdk";
import { OFF_NEW_TAB, threadTab } from "../kit/app/thread-panel";
import { pageTab } from "../kit/app/workbench";
import { NotFoundTab } from "../links/NotFoundTab";
import { NOT_FOUND_TAB, NOT_FOUND_TITLE } from "../links/router";
import { TodoTab } from "../loops/ui/TodoTab";
import { RecordTab } from "../memory/ui/RecordTab";
import { AutomationTab } from "./automations/AutomationTab";
import { ITEM_KINDS, NEW_TAB_ACTIONS, newTabFields, newTabTitle, STUDIO_PLUGIN, tabKindEntry, type TabKindId } from "../tab-kinds";
import { AUTOMATIONS_PANEL, AutomationsPanel } from "./automations/AutomationsPanel";
import { currentBot } from "./conversations/state";
import { newConversationPath } from "./conversations/new-conversation";
import { LibraryPage } from "./library/LibraryPage";
import { createKind } from "./new-menu";
import { openFrom, workbenchItem } from "./studio-open";
import { ENTRY_TITLE, PageBar, type EntryKind } from "./page-bar";
import { STUDIO_TAB } from "./studio-tab/model";

/** Shows a path in the main view by Studio's open rule, from outside React. */
const showInMain = (href: string) => openFrom(null, { href }, { target: "main" }, { toThread: () => {}, openUrl: () => false });

const MemoryView = lazy(() => import("../memory/ui/MemoryView"));
const OlderPage = lazy(() => import("./conversations/OlderPage"));
const SkillsPage = lazy(() => import("./skills/SkillsPage"));

const botOf = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.botId === "string" && params.botId ? params.botId : null;
};

function Frame({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="bot-page-tab"><Suspense fallback={null}>{children}</Suspense></div>;
}

/** The Bot-page tabs, by registry kind: the component each shows. */
export const BOT_PAGE_TABS: readonly { kind: TabKindId; component: ComponentType<{ params: JsonValue | null }> }[] = [
  { kind: "memory", component: ({ params }) => <Frame><MemoryView botId={botOf(params) ?? currentBot()} /></Frame> },
  { kind: "skills", component: ({ params }) => <Frame><SkillsPage botId={botOf(params) ?? currentBot()} /></Frame> },
  { kind: "library", component: () => <Frame><LibraryPage /></Frame> },
  { kind: "automations", component: () => <Frame><AutomationsPanel /></Frame> },
  { kind: "archive", component: ({ params }) => <Frame><OlderPage botId={botOf(params) ?? currentBot()} /></Frame> },
];

export const ENTRY_TABS: readonly { kind: "automation" | "todo" | "record"; component: ComponentType<{ params: JsonValue | null }> }[] = [
  { kind: "automation", component: AutomationTab },
  { kind: "todo", component: TodoTab },
  { kind: "record", component: RecordTab },
];

export const PAGE_PANELS: readonly (string | undefined)[] = [undefined, AUTOMATIONS_PANEL];

export function EntryView({ kind, id }: { kind: EntryKind; id: string }) {
  const View = ENTRY_TABS.find((each) => each.kind === kind)!.component;
  return <><PageBar title={ENTRY_TITLE[kind]} /><View params={{ id }} /></>;
}

/** The Studio kind id ("drawing", "mini") the New menu makes for a registry kind. */
const makes = (kind: TabKindId): string | null => ITEM_KINDS.find((each) => each.id === kind)?.tabKind ?? null;

/** Opens a made item as a tab beside the conversation; the main view where the panel declines. */
export function openMade(panel: Pick<ExperimentalPanelController, "openTab"> | null, href: string, title: string): void {
  const item = workbenchItem(href);
  const opened = !!panel && !!item && (() => {
    try { return panel.openTab({ tab: threadTab(STUDIO_TAB), params: { kind: item.kind, id: item.id }, title }); } catch { return false; }
  })();
  if (!opened) showInMain(href);
}

/** What a "New …" action does: make the kind and open it beside the conversation, or start a conversation. */
export async function runNewAction(kind: TabKindId, panel: Pick<ExperimentalPanelController, "openTab"> | null): Promise<void> {
  if (kind === "conversation") {
    const botId = currentBot();
    showInMain(botId ? `/plugins/${STUDIO_PLUGIN}/studio/${newConversationPath(botId, null)}` : `/plugins/${STUDIO_PLUGIN}/studio/bot`);
    return;
  }
  const studioKind = makes(kind);
  if (!studioKind) return;
  const name = tabKindEntry(kind).name;
  await createKind(studioKind, name, (href) => openMade(panel, href, `Untitled ${name.toLowerCase()}`));
}

/** A "New …" tab, should BB ever show one (it runs instead): its button does the same. */
function newActionTab(kind: TabKindId, title: string) {
  return function NewActionTab() {
    const panel = experimental_useAppPanel();
    return (
      <div className="flex h-full items-center justify-center p-6">
        <button type="button" onClick={() => void runNewAction(kind, panel)} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{title}</button>
      </div>
    );
  };
}

type TabSlots = { slots: { experimental_tab(registration: never): void } };

/** Registers the Bot-page tabs and the "New …" actions beside a conversation. */
export function registerTabKindTabs(app: TabSlots): void {
  for (const tab of BOT_PAGE_TABS) {
    const entry = tabKindEntry(tab.kind);
    const id = entry.open.via === "studio" ? entry.open.tabId : null;
    if (!id) continue;
    app.slots.experimental_tab({ ...threadTab(id), title: newTabTitle(id) ?? entry.name, ...(entry.actions.length ? newTabFields(id) : OFF_NEW_TAB), icon: entry.icon, layout: "flush", component: tab.component } as never);
  }
  const pages = hasGlobalWorkbench ? PAGE_PANELS : [];
  for (const tab of ENTRY_TABS) {
    const entry = tabKindEntry(tab.kind);
    const id = entry.open.via === "studio" ? entry.open.tabId : null;
    if (!id) continue;
    const common = { title: entry.name, icon: entry.icon, layout: "flush", component: tab.component, ...OFF_NEW_TAB };
    app.slots.experimental_tab({ ...threadTab(id), ...common } as never);
    for (const panelId of pages) app.slots.experimental_tab({ ...pageTab(id, panelId), ...common } as never);
  }
  for (const panelId of pages) app.slots.experimental_tab({ ...pageTab(NOT_FOUND_TAB, panelId), title: NOT_FOUND_TITLE, icon: "Unavailable", layout: "flush", component: NotFoundTab, ...OFF_NEW_TAB } as never);
  for (const action of NEW_TAB_ACTIONS.filter((each) => each.create)) {
    app.slots.experimental_tab({
      ...threadTab(action.tabId), title: action.title, ...newTabFields(action.tabId), icon: tabKindEntry(action.kind).icon, layout: "flush",
      component: newActionTab(action.kind, action.tooltip),
      run: (context: { experimental_panel: ExperimentalPanelController }) => runNewAction(action.kind, context.experimental_panel),
    } as never);
  }
}

