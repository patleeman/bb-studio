// Runs one agent workbench call against a conversation's workbench, in the
// app window that shows it (src/workbench-agent/ui/bridge.tsx), and says what
// happened in a line or two for the agent. Pure over the workbench it is
// handed, so tests drive it with a fake. The rules:
// - Never take focus while the user is typing in the panel: an open goes
//   behind the selected tab (a Studio tab is marked new until seen), and a
//   focus, a close of the selected tab or closing the panel is refused.
// - What the user closed or moved out of the panel after the agent opened it
//   is not reopened, and a layout setting the user changed after the agent
//   set it is not changed back, unless the call passes force (only when the
//   user asked).
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { STUDIO_PLUGIN_ID } from "../kit/contract";
import { newTabTitle, refOfTab, tabKindEntry } from "../tab-kinds";
import {
  adaptLayout, MAX_WIDTH_PERCENT, MIN_PANE_PERCENT, MIN_WIDTH_PERCENT, NEW_MARK, paneOfKeys, sameItem, SIBLING_TAB_PLUGINS, tabItem,
  type HostLayout, type LayoutField, type OpenSpec, type WorkbenchLayout, type WorkbenchOp, type WorkbenchRecord,
} from "./shared";

/** One open tab, as `ExperimentalWorkbench.list()` reports it. */
export interface PanelTab {
  key: string;
  title: string;
  closable: boolean;
  detail:
    | { kind: "plugin"; pluginId: string; tab: { id: string }; params: JsonValue | null }
    | { kind: "file"; path: string }
    | { kind: "browser"; url: string }
    | { kind: "terminal"; terminalId: string }
    | { kind: string };
}

export interface PanelTabs { open: boolean; selectedKey: string | null; tabs: readonly PanelTab[] }

/** Where an open goes: a pane (2, or "new" to make the second) and a place in its tab strip. */
export interface OpenOptions { focus: boolean; pane?: 1 | 2 | "new"; index?: number }

type OpenOp = Extract<WorkbenchOp, { type: "open" }>;

/** A workbench as these tools see it: BB's (adaptWorkbench), or a fake in tests. */
export interface WorkbenchLike {
  list(): PanelTabs;
  open(spec: OpenSpec, options: OpenOptions): Promise<string | null>;
  close(key: string): boolean;
  focus(key: string): boolean;
  layout(): WorkbenchLayout;
  /** The pane (1 or 2) a tab is in; null on a BB with one pane. */
  paneOf?(key: string): 1 | 2 | null;
  arrange(layout: Partial<WorkbenchLayout>): boolean;
  isTyping(): boolean;
  popOut?(key: string): Promise<boolean>;
}

/** The fork's `ExperimentalWorkbench` (useBbNavigate().experimental_workbench), as far as Studio uses it. */
export interface HostWorkbenchLike {
  list(): PanelTabs;
  open(spec: OpenSpec, options: OpenOptions): Promise<string | null>;
  close(key: string): boolean;
  focus(key: string): boolean;
  layout(): HostLayout;
  arrange(layout: { panel?: "open" | "closed"; widthPercent?: number; conversation?: "shown" | "collapsed"; panes?: 1 | 2; paneWidths?: [number, number] }): boolean;
  isTyping(): boolean;
  popOut?(key: string): Promise<boolean>;
}

/**
 * BB's workbench in the tools' terms: its layout as a pane count and widths
 * (adaptLayout). Another plugin's tab (a Visual Chat board, a workflow run)
 * opens through BB's `tab.pluginId`; where BB declines it (a BB from before
 * `experimental_openableByPlugins`), `openSibling` asks that plugin itself
 * (src/ui/tab-open.ts). BB drops options it doesn't know.
 */
export function adaptWorkbench(host: HostWorkbenchLike, openSibling?: (spec: Extract<OpenSpec, { kind: "tab" }>, options: OpenOptions) => Promise<string | null>): WorkbenchLike {
  return {
    list: () => host.list(),
    open: (spec, options) => {
      if (spec.kind === "tab" && spec.tab.pluginId && spec.tab.pluginId !== STUDIO_PLUGIN_ID) {
        const tab = spec;
        return host.open(tab, options).then((key) => key ?? (openSibling ? openSibling(tab, options) : null));
      }
      return host.open(spec, options);
    },
    close: (key) => host.close(key),
    focus: (key) => host.focus(key),
    layout: () => adaptLayout(host.layout()),
    paneOf: (key) => paneOfKeys(host.layout()).get(key) ?? null,
    arrange: (layout) => host.arrange(layout),
    isTyping: () => host.isTyping(),
    ...(typeof host.popOut === "function" ? { popOut: (key: string) => host.popOut!(key) } : {}),
  };
}

export interface ExecResult { message: string; record: WorkbenchRecord }

const FORCE_NOTE = "Pass force: true only when the user asks for it.";
const FIELD_NAMES: Record<LayoutField, string> = { panel: "the panel open or closed", widthPercent: "the panel width", conversation: "the conversation shown or collapsed", panes: "the number of panes", paneWidths: "the pane widths" };
/** The workbench's limits, for every refusal about panes. */
export const PANE_LIMITS = "The workbench has at most two panes, side by side, and the conversation stays on the left; panes don't stack.";
const ONE_PANE = "This BB's workbench has one pane.";
export const WINDOW_KINDS = "Pages, whiteboards, designs, apps, conversations and other plugin tabs, and files, open in a window of their own; terminals, browser tabs, Info, Diff, New Tab and fixed tabs stay in the workbench.";
export const NO_WINDOWS = "This BB can't open workbench tabs in windows of their own.";

function windowRefusal(tab: PanelTab): string | null {
  const kind = tab.detail.kind;
  if ((kind === "plugin" || kind === "file") && tab.closable) return null;
  return `${JSON.stringify(tab.title)} can't open in a window of its own. ${WINDOW_KINDS}`;
}

/** The item a tab shows, in itemOfSpec's terms; null for tabs the tools can't open (Info, terminals, other plugins'). */
export function itemOfTab(tab: PanelTab): string | null {
  const detail = tab.detail;
  if (detail.kind === "plugin" && "pluginId" in detail) return detail.pluginId === STUDIO_PLUGIN_ID || SIBLING_TAB_PLUGINS.has(detail.pluginId) ? tabItem(detail.pluginId, detail.tab.id, detail.params ?? null) : null;
  if (detail.kind === "file" && "path" in detail) return `file:${detail.path}`;
  if (detail.kind === "browser" && "url" in detail) return `url:${detail.url}`;
  return null;
}

/** What a tab is, by the tab kinds registry's name ("Whiteboard", "Memory"), else whose tab it is. */
function tabKind(tab: PanelTab): string {
  const detail = tab.detail;
  if (detail.kind === "plugin" && "pluginId" in detail) {
    const ref = refOfTab({ pluginId: detail.pluginId, tabId: detail.tab.id, params: detail.params });
    if (ref) return tabKindEntry(ref.kind).name;
    const action = detail.pluginId === STUDIO_PLUGIN_ID ? newTabTitle(detail.tab.id) : null;
    return action ?? (detail.pluginId === STUDIO_PLUGIN_ID ? `Studio ${detail.tab.id} tab` : `${detail.pluginId} tab`);
  }
  if (detail.kind === "browser") return "browser";
  return detail.kind;
}

const near = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1;
const sameValue = (field: LayoutField, a: WorkbenchLayout[LayoutField] | undefined, b: WorkbenchLayout[LayoutField] | undefined) =>
  field === "widthPercent" ? near(a, b)
    : field === "paneWidths" ? Array.isArray(a) && Array.isArray(b) && near(a[0], b[0]) && near(a[1], b[1])
      : a === b;

/**
 * Brings the record up to what the panel shows now. An agent tab that is
 * gone, with no tab of the same item in its place, was closed or moved out
 * by the user (until the user opens it again). A layout field that no longer
 * has the value the agent set was changed by the user; the panel stops
 * counting as the user's once they open it again themselves.
 */
export function reconcile(record: WorkbenchRecord, list: PanelTabs, layout: WorkbenchLayout): WorkbenchRecord {
  const claimed = new Set<string>();
  const opened: WorkbenchRecord["opened"] = [];
  const dismissed = [...record.dismissed];
  for (const entry of record.opened) {
    const same = list.tabs.find((tab) => tab.key === entry.key) ?? list.tabs.find((tab) => !claimed.has(tab.key) && sameItem(itemOfTab(tab) ?? "", entry.item));
    if (same && !claimed.has(same.key)) {
      claimed.add(same.key);
      opened.push({ ...entry, key: same.key });
    } else if (!dismissed.some((each) => sameItem(each.item, entry.item))) {
      dismissed.push({ item: entry.item, title: entry.title });
    }
  }
  // The user opened it again themselves: it is theirs to keep, and no longer closed.
  const shown = list.tabs.map((tab) => itemOfTab(tab)).filter((item): item is string => item !== null);
  const stillClosed = dismissed.filter((each) => !shown.some((item) => sameItem(item, each.item)));
  const layoutSet: WorkbenchRecord["layoutSet"] = {};
  const userLayout = new Set(record.userLayout);
  for (const field of Object.keys(record.layoutSet) as LayoutField[]) {
    if (sameValue(field, record.layoutSet[field], layout[field])) (layoutSet as Record<LayoutField, unknown>)[field] = record.layoutSet[field];
    else userLayout.add(field);
  }
  if (layout.panel === "open") userLayout.delete("panel");
  return { opened, dismissed: stillClosed.slice(-200), layoutSet, userLayout: [...userLayout] };
}

function describeLayout(layout: WorkbenchLayout): string {
  const panes = layout.panes === 2 && layout.paneWidths ? `, 2 panes (${Math.round(layout.paneWidths[0])}% and ${Math.round(layout.paneWidths[1])}%)` : layout.panes === 1 ? ", 1 pane" : "";
  return `Panel ${layout.panel}, ${Math.round(layout.widthPercent)}% wide${panes}, conversation ${layout.conversation}.`;
}

function listMessage(wb: WorkbenchLike, list: PanelTabs, layout: WorkbenchLayout, record: WorkbenchRecord): string {
  const lines = [describeLayout(layout)];
  if (!list.tabs.length) lines.push("No tabs open.");
  const twoPanes = layout.panes === 2;
  for (const tab of list.tabs) {
    const pane = twoPanes ? wb.paneOf?.(tab.key) ?? null : null;
    const notes = [tabKind(tab), pane ? `pane ${pane}` : null, tab.key === list.selectedKey ? "selected" : null, record.opened.some((each) => each.key === tab.key) ? "opened by you" : null, tab.closable ? null : "can't be closed"].filter(Boolean);
    lines.push(`- key ${JSON.stringify(tab.key)}: ${JSON.stringify(tab.title)} (${notes.join(", ")})`);
  }
  if (record.dismissed.length) lines.push(`Closed or moved by the user after you opened them (not reopened without force): ${record.dismissed.map((each) => JSON.stringify(each.title)).join(", ")}.`);
  if (record.userLayout.length) lines.push(`Changed by the user after you set it (left as is without force): ${record.userLayout.map((field) => FIELD_NAMES[field]).join(", ")}.`);
  return lines.join("\n");
}

async function openInWindow(wb: WorkbenchLike, op: OpenOp, record: WorkbenchRecord): Promise<ExecResult> {
  const name = JSON.stringify(op.title);
  const reason = !wb.popOut ? NO_WINDOWS : wb.isTyping() && !op.force ? `Not in a window: the user is typing in the workbench. ${FORCE_NOTE}` : null;
  if (reason) {
    const { pane: _pane, ...inPanel } = op;
    const opened = await open(wb, inPanel, record);
    return { ...opened, message: `${opened.message} ${reason}` };
  }
  const already = wb.list().tabs.find((tab) => sameItem(itemOfTab(tab) ?? "", op.item));
  const next: WorkbenchRecord = { ...record, dismissed: record.dismissed.filter((each) => !sameItem(each.item, op.item)) };
  const key = await wb.open(op.spec, { focus: false });
  if (!key) return { message: `${name} didn't open.`, record: next };
  if (await wb.popOut!(key)) return { message: `Opened ${name} in a window of its own. Its Return to workbench button puts it back.`, record: { ...next, opened: next.opened.filter((each) => each.key !== key) } };
  const opened = already ? next.opened : [...next.opened.filter((each) => each.key !== key), { item: op.item, key, title: op.title }];
  return { message: `${name} is in the workbench (key ${JSON.stringify(key)}): BB didn't open it in a window of its own. ${WINDOW_KINDS}`, record: { ...next, opened } };
}

async function open(wb: WorkbenchLike, op: OpenOp, record: WorkbenchRecord): Promise<ExecResult> {
  const name = JSON.stringify(op.title);
  const dismissed = record.dismissed.find((each) => sameItem(each.item, op.item));
  if (dismissed && !op.force) return { message: `Not reopened: the user closed or moved ${name} after you opened it. ${FORCE_NOTE}`, record };
  if (op.pane === "window") return openInWindow(wb, op, record);
  const before = wb.list();
  const already = before.tabs.find((tab) => sameItem(itemOfTab(tab) ?? "", op.item));
  const typing = wb.isTyping();
  const panelTheirs = record.userLayout.includes("panel") && !before.open && !op.force;
  const focus = op.focus && !typing && !panelTheirs;
  const behind = !focus && op.spec.kind === "tab" && !already;
  const spec: OpenSpec = behind && op.spec.kind === "tab" ? { ...op.spec, title: `${NEW_MARK}${op.title}` } : op.spec;
  // A second pane changes the layout under the user: not while they type, and not one they took away, unless forced.
  const layout = wb.layout();
  const hasPanes = layout.panes !== undefined;
  const wantsSecond = op.pane === 2 || op.pane === "new";
  const paneNotes: string[] = [];
  // BB opens in pane 2 only when there are two, and makes one ("new") only when there is one.
  let pane = op.pane === 2 && layout.panes === 1 ? "new" as const : op.pane === "new" && layout.panes === 2 ? 2 as const : op.pane;
  if (wantsSecond && !hasPanes) { pane = undefined; paneNotes.push(`${ONE_PANE} Opened it there.`); }
  else if (op.pane === "new" && layout.panes !== 2 && !op.force && (typing || record.userLayout.includes("panes"))) {
    pane = undefined;
    paneNotes.push(typing ? "No second pane: the user is typing in the workbench." : `No second pane: the user closed it. ${FORCE_NOTE}`);
  }
  const placed = pane !== undefined || op.index !== undefined;
  const where = { ...(pane !== undefined ? { pane } : {}), ...(op.index !== undefined && (pane !== undefined || op.pane === undefined) ? { index: op.index } : {}) };
  let key = await wb.open(spec, { focus, ...where });
  // BB declines a place it can't make (a narrow window's drawer has one pane): open it where tabs open.
  if (!key && placed && Object.keys(where).length) {
    key = await wb.open(spec, { focus });
    if (key) paneNotes.push("BB couldn't place it there; opened it in the pane in use.");
  }
  const next: WorkbenchRecord = { ...record, dismissed: record.dismissed.filter((each) => !sameItem(each.item, op.item)) };
  if (!key) {
    const why = op.spec.kind === "url" ? " The in-app browser is only in BB's desktop app." : "";
    return { message: `${name} didn't open.${why}`, record: next };
  }
  if (!already) next.opened = [...record.opened.filter((each) => each.key !== key), { item: op.item, key, title: op.title }];
  if (focus && !before.open && !record.userLayout.includes("panel")) next.layoutSet = { ...record.layoutSet, panel: "open" };
  const marked = behind ? ", marked new" : "";
  const reason = !op.focus ? "" : typing ? ": the user is typing in the panel" : panelTheirs ? ": the user closed the panel, so it stays closed" : "";
  const keyText = `key ${JSON.stringify(key)}`;
  const placeNote = paneNotes.length ? ` ${paneNotes.join(" ")}` : "";
  const after = hasPanes ? wb.paneOf?.(key) ?? null : null;
  const inPane = after && wb.layout().panes === 2 ? ` in pane ${after}` : "";
  if (already) return { message: (focus ? `${name} was already open (${keyText}${inPane}); selected it.` : `${name} was already open (${keyText}${inPane}); left it where it is${reason}.`) + placeNote, record: next };
  return { message: `Opened ${name} (${keyText})${inPane} ${focus ? "and selected it" : "behind the selected tab"}${marked}${reason}.${placeNote}`, record: next };
}

function tabOf(wb: WorkbenchLike, key: string): { list: PanelTabs; tab: PanelTab | null } {
  const list = wb.list();
  return { list, tab: list.tabs.find((each) => each.key === key) ?? null };
}

const unknownKey = (key: string) => `No tab has key ${JSON.stringify(key)}. Call workbench_list for the current keys.`;

function close(wb: WorkbenchLike, op: Extract<WorkbenchOp, { type: "close" }>, record: WorkbenchRecord): ExecResult {
  const { list, tab } = tabOf(wb, op.key);
  if (!tab) return { message: unknownKey(op.key), record };
  if (!op.force && wb.isTyping() && list.open && list.selectedKey === tab.key) return { message: `Not closed: the user is typing in ${JSON.stringify(tab.title)}. ${FORCE_NOTE}`, record };
  if (!wb.close(tab.key)) return { message: `${JSON.stringify(tab.title)} can't be closed.`, record };
  return { message: `Closed ${JSON.stringify(tab.title)}.`, record: { ...record, opened: record.opened.filter((each) => each.key !== tab.key) } };
}

async function popOutTab(wb: WorkbenchLike, op: Extract<WorkbenchOp, { type: "popOut" }>, record: WorkbenchRecord): Promise<ExecResult> {
  const { tab } = tabOf(wb, op.key);
  if (!tab) return { message: unknownKey(op.key), record };
  if (!wb.popOut) return { message: NO_WINDOWS, record };
  const refusal = windowRefusal(tab);
  if (refusal) return { message: refusal, record };
  if (!op.force && wb.isTyping()) return { message: `Not opened in a window: the user is typing in the workbench. ${FORCE_NOTE}`, record };
  if (!(await wb.popOut(tab.key))) return { message: `BB didn't open ${JSON.stringify(tab.title)} in a window of its own. ${WINDOW_KINDS}`, record };
  return { message: `Opened ${JSON.stringify(tab.title)} in a window of its own. Its Return to workbench button puts it back.`, record: { ...record, opened: record.opened.filter((each) => each.key !== tab.key) } };
}

function focusTab(wb: WorkbenchLike, op: Extract<WorkbenchOp, { type: "focus" }>, record: WorkbenchRecord): ExecResult {
  const { list, tab } = tabOf(wb, op.key);
  if (!tab) return { message: unknownKey(op.key), record };
  if (!op.force && wb.isTyping() && list.selectedKey !== tab.key) return { message: `Not switched: the user is typing in the panel. ${FORCE_NOTE}`, record };
  if (!op.force && !list.open && record.userLayout.includes("panel")) return { message: `Not switched: the user closed the panel. ${FORCE_NOTE}`, record };
  if (!wb.focus(tab.key)) return { message: unknownKey(op.key), record };
  const layoutSet = list.open ? record.layoutSet : { ...record.layoutSet, panel: "open" as const };
  return { message: `Selected ${JSON.stringify(tab.title)}.`, record: { ...record, layoutSet, userLayout: record.userLayout.filter((field) => field !== "panel") } };
}

function arrange(wb: WorkbenchLike, op: Extract<WorkbenchOp, { type: "arrange" }>, record: WorkbenchRecord): ExecResult {
  const wanted = { ...op.layout };
  if (wanted.widthPercent !== undefined && (wanted.widthPercent < MIN_WIDTH_PERCENT || wanted.widthPercent > MAX_WIDTH_PERCENT)) {
    return { message: `The panel width must be ${MIN_WIDTH_PERCENT} to ${MAX_WIDTH_PERCENT} percent. Nothing changed.`, record };
  }
  const current = wb.layout();
  if ((wanted.panes !== undefined || wanted.paneWidths !== undefined) && current.panes === undefined) {
    if (wanted.panes === 1 && wanted.paneWidths === undefined) delete wanted.panes;
    else return { message: `${ONE_PANE} ${PANE_LIMITS} Nothing changed.`, record };
  }
  if (wanted.paneWidths) {
    const [left, right] = wanted.paneWidths;
    const share = left > 0 && right > 0 ? (left / (left + right)) * 100 : 0;
    if (share < MIN_PANE_PERCENT || share > 100 - MIN_PANE_PERCENT) return { message: `Pane widths are a ratio of two positive numbers, such as [2, 1]; each pane keeps at least ${MIN_PANE_PERCENT}% of the workbench. Nothing changed.`, record };
    if ((wanted.panes ?? current.panes) !== 2) return { message: "Pane widths need two panes: pass panes: 2 as well. Nothing changed.", record };
  }
  const fields = (Object.keys(wanted) as LayoutField[]).filter((field) => wanted[field] !== undefined && !sameValue(field, wanted[field], current[field]));
  const theirs = op.force ? [] : fields.filter((field) => record.userLayout.includes(field));
  const typingBlocks = !op.force && wb.isTyping() && ((wanted.panel === "closed" && current.panel === "open") || (wanted.panes === 1 && current.panes === 2));
  const apply = fields.filter((field) => !theirs.includes(field) && !((field === "panel" || field === "panes") && typingBlocks));
  const notes: string[] = [];
  if (theirs.length) notes.push(`Left as the user set it: ${theirs.map((field) => FIELD_NAMES[field]).join(", ")}. ${FORCE_NOTE}`);
  if (typingBlocks) notes.push(`${wanted.panel === "closed" ? "The panel stays open" : "Both panes stay"}: the user is typing in it. ${FORCE_NOTE}`);
  if (!apply.length) return { message: [describeLayout(current), ...notes].join(" "), record };
  const change: Partial<WorkbenchLayout> = {};
  for (const field of apply) (change as Record<LayoutField, unknown>)[field] = wanted[field];
  if (!wb.arrange(change)) {
    const why = change.panes === 2 && current.panes !== 2 ? " Two panes need two tabs: the selected one moves to the new pane." : "";
    return { message: [`BB didn't change the layout.${why}`, describeLayout(current), ...notes].join(" "), record };
  }
  const after = wb.layout();
  const layoutSet = { ...record.layoutSet };
  for (const field of apply) (layoutSet as Record<LayoutField, unknown>)[field] = after[field];
  return { message: [describeLayout(after), ...notes].join(" "), record: { ...record, layoutSet, userLayout: record.userLayout.filter((field) => !apply.includes(field)) } };
}

/** Runs `op` on `wb` with what Studio remembers about it, and answers the agent's text and the updated record. */
export async function runOp(wb: WorkbenchLike, op: WorkbenchOp, saved: WorkbenchRecord): Promise<ExecResult> {
  const record = reconcile(saved, wb.list(), wb.layout());
  switch (op.type) {
    case "list": return { message: listMessage(wb, wb.list(), wb.layout(), record), record };
    case "open": return open(wb, op, record);
    case "close": return close(wb, op, record);
    case "focus": return focusTab(wb, op, record);
    case "popOut": return popOutTab(wb, op, record);
    case "arrange": return arrange(wb, op, record);
  }
}

/**
 * Takes the new mark off the selected tab once the user is looking at it: a
 * Studio tab whose title starts with NEW_MARK, selected in an open panel.
 * Read off the panel itself, so a mark left before a reload still goes.
 * Answers whether it renamed one.
 */
export function clearSeenMark(wb: Pick<WorkbenchLike, "list">, rename: (tab: { tabId: string; params: JsonValue | null; title: string }) => void): boolean {
  const list = wb.list();
  const tab = list.open ? list.tabs.find((each) => each.key === list.selectedKey) : undefined;
  const detail = tab?.detail;
  if (!tab || !tab.title.startsWith(NEW_MARK) || detail?.kind !== "plugin" || !("pluginId" in detail) || detail.pluginId !== STUDIO_PLUGIN_ID) return false;
  rename({ tabId: detail.tab.id, params: detail.params ?? null, title: tab.title.slice(NEW_MARK.length) });
  return true;
}
