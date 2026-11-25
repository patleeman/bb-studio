// Keeps a desktop window's workbench and the server's Workspace the same,
// both ways, through BB's public workbench API (no fork seam): BB has no
// change event for the panel, so the bridge calls `sync` on a timer and when
// the server announces a change. Each round is a three-way merge against the
// last state both sides agreed on (the snapshot, kept in localStorage so a
// reload doesn't lose it), item by item:
//   in snapshot and desktop, not server  → closed elsewhere: close here
//   in snapshot and server, not desktop  → closed here: close on the server
//   in desktop only                      → opened here: open on the server
//   in server only                       → opened elsewhere: open here
// Guards against echo and flapping: this window's own writes carry its
// origin and their events are skipped; the snapshot is saved only after a
// whole round succeeds, from what both sides then hold; a version conflict
// stops the round, and the next one re-reads and re-diffs instead of
// overwriting; a tab this window can't open (a kind BB here can't show) is
// remembered and never read as "closed here".
import type { WorkspaceTabRef } from "../workspace";
import { openSpecOf, refKey, refOfPanelTab, sameKey } from "../workspace";
import type { WorkbenchLike } from "../exec";
import type { WorkspaceChanged, WorkspaceMutateInput, WorkspaceMutateOutput, WorkspaceStateView } from "../workspace-contract";

export interface SyncSnapshot {
  version: number;
  /** The server's tabs (refKey), in its order. */
  items: string[];
  /** The server's active tab (refKey). */
  active: string | null;
  /** This window's synced tabs and selected one, as last seen. */
  deskOrder: string[];
  deskActive: string | null;
  /** This window's tab keys and what each showed, as last seen: a key that now shows something else navigated (an update, not a close and an open). */
  deskKeys?: Record<string, string>;
}

export interface WorkspaceClient {
  get(threadId: string): Promise<WorkspaceStateView>;
  mutate(input: WorkspaceMutateInput): Promise<WorkspaceMutateOutput>;
  importOnce(input: { threadId: string; tabs: { ref: WorkspaceTabRef; title: string }[]; activeIndex: number | null; panelOpen: boolean | null; origin: string }): Promise<{ imported: boolean; state: WorkspaceStateView }>;
}

export interface SnapshotStore {
  load(threadId: string): SyncSnapshot | null;
  save(threadId: string, snapshot: SyncSnapshot): void;
}

interface DeskTab { item: string; ref: WorkspaceTabRef; title: string; key: string }

/** The window's tabs the Workspace keeps (Info, New Tab and plugin details stay local), and the selected one. */
export function deskTabs(wb: Pick<WorkbenchLike, "list">): { tabs: DeskTab[]; active: string | null; open: boolean; selectedKey: string | null } {
  const list = wb.list();
  const tabs: DeskTab[] = [];
  for (const tab of list.tabs) {
    const ref = refOfPanelTab(tab);
    if (!ref) continue;
    const item = refKey(ref);
    if (tabs.some((each) => sameKey(each.item, item))) continue;
    tabs.push({ item, ref, title: tab.title, key: tab.key });
  }
  const selected = tabs.find((tab) => tab.key === list.selectedKey) ?? null;
  return { tabs, active: selected?.item ?? null, open: list.open, selectedKey: list.selectedKey };
}

const has = (items: readonly string[], item: string) => items.some((each) => sameKey(each, item));
const serverItem = (state: WorkspaceStateView, tabId: string | null) => (tabId ? state.tabs.find((tab) => tab.tabId === tabId) : undefined);
const itemOf = (tab: WorkspaceStateView["tabs"][number]) => refKey(tab.ref as WorkspaceTabRef);
const activeOf = (state: WorkspaceStateView) => { const tab = serverItem(state, state.activeTabId); return tab ? itemOf(tab) : null; };

export function snapshotOf(state: WorkspaceStateView, desk: { tabs: readonly DeskTab[]; active: string | null }): SyncSnapshot {
  return { version: state.version, items: state.tabs.map(itemOf), active: activeOf(state), deskOrder: desk.tabs.map((tab) => tab.item), deskActive: desk.active, deskKeys: Object.fromEntries(desk.tabs.map((tab) => [tab.key, tab.item])) };
}

/** What one round did, for tests and logs. */
export interface RoundReport { pushed: string[]; applied: string[]; conflict: boolean; imported: boolean }

export class WorkspaceSync {
  private readonly dirty = new Set<string>();
  private readonly running = new Map<string, Promise<RoundReport | null>>();
  /** Per conversation, what this window failed to open: not read as closed here. */
  private readonly unopenable = new Map<string, Set<string>>();

  constructor(
    /** "desktop:<window id>": this window's writes, and the events they cause. */
    readonly origin: string,
    private readonly client: WorkspaceClient,
    private readonly snapshots: SnapshotStore,
  ) {}

  /** A change event: read the server again on the next round, unless this window wrote it. */
  changed(event: WorkspaceChanged): boolean {
    if (event.origin === this.origin) return false;
    if (this.snapshots.load(event.threadId)?.version === event.version) return false;
    this.dirty.add(event.threadId);
    return true;
  }

  isDirty(threadId: string): boolean {
    return this.dirty.has(threadId);
  }

  /** One round for one conversation on screen here; rounds for the same conversation never overlap. */
  sync(threadId: string, wb: WorkbenchLike): Promise<RoundReport | null> {
    const busy = this.running.get(threadId);
    if (busy) return busy.then(() => null);
    const round = this.round(threadId, wb).finally(() => this.running.delete(threadId));
    this.running.set(threadId, round);
    return round;
  }

  private async round(threadId: string, wb: WorkbenchLike): Promise<RoundReport> {
    const report: RoundReport = { pushed: [], applied: [], conflict: false, imported: false };
    let desk = deskTabs(wb);
    const saved = this.snapshots.load(threadId);
    const failed = this.unopenable.get(threadId) ?? new Set<string>();
    this.unopenable.set(threadId, failed);
    for (const item of [...failed]) if (has(desk.tabs.map((tab) => tab.item), item)) failed.delete(item);
    const wasDirty = this.dirty.delete(threadId);
    // Nothing new on either side since the last round: no call at all.
    const deskSame = !!saved && saved.deskOrder.join("\n") === desk.tabs.map((tab) => tab.item).join("\n") && saved.deskActive === desk.active;
    if (saved && deskSame && !wasDirty) return report;
    let server = await this.client.get(threadId);
    // First sight of a conversation the server has nothing for: bring this window's tabs over, once.
    if (!saved && server.version === 0) {
      if (desk.tabs.length) {
        const activeIndex = desk.tabs.findIndex((tab) => tab.item === desk.active);
        const result = await this.client.importOnce({ threadId, tabs: desk.tabs.map((tab) => ({ ref: tab.ref, title: tab.title })), activeIndex: activeIndex < 0 ? null : activeIndex, panelOpen: desk.open, origin: this.origin });
        report.imported = result.imported;
        server = result.state;
      }
      if (server.version === 0 || report.imported) {
        this.snapshots.save(threadId, snapshotOf(server, desk));
        return report;
      }
    }
    // A conversation seen first here, the server already holding it: start from nothing, so each side gets what the other has.
    const base: SyncSnapshot = saved ?? { version: -1, items: [], active: null, deskOrder: [], deskActive: null };
    let state: WorkspaceStateView = server;
    const serverItems = state.tabs.map(itemOf);
    const deskItems = desk.tabs.map((tab) => tab.item);
    const typingIn = wb.isTyping() ? desk.selectedKey : null;
    // A tab of this window that showed one thing at the last agreement and shows another now navigated: the server's tab follows it.
    const navigated = desk.tabs.flatMap((tab) => {
      const was = base.deskKeys?.[tab.key];
      if (!was || sameKey(was, tab.item) || has(base.items, tab.item) || has(serverItems, tab.item) || has(deskItems.filter((item) => item !== tab.item), was)) return [];
      const server = state.tabs.find((each) => sameKey(itemOf(each), was));
      return server ? [{ tab, was, tabId: server.tabId }] : [];
    });
    const movedFrom = new Set(navigated.map((each) => each.was));
    const movedTo = new Set(navigated.map((each) => each.tab.item));

    // Apply the other side's changes here.
    const keptHere = new Set<string>();
    {
      for (const tab of desk.tabs) {
        if (has(base.items, tab.item) && !has(serverItems, tab.item)) {
          // Never close what the user is typing in: it goes back up as this window's.
          if (tab.key === typingIn) { keptHere.add(tab.item); continue; }
          if (wb.close(tab.key)) report.applied.push(`close ${tab.item}`);
        }
      }
      for (const tab of state.tabs) {
        const item = itemOf(tab);
        if (has(base.items, item) || has(deskItems, item) || failed.has(item)) continue;
        const spec = openSpecOf(tab.ref as WorkspaceTabRef, tab.title);
        const key = spec ? await wb.open(spec, { focus: false }).catch(() => null) : null;
        if (key) report.applied.push(`open ${item}`);
        else failed.add(item);
      }
    }

    // Send this window's changes, one op at a time against the version just read.
    const current = (): WorkspaceStateView => state;
    let version = state.version;
    const push = async (input: Omit<WorkspaceMutateInput, "threadId" | "baseVersion" | "origin">, label: string): Promise<boolean> => {
      const result = await this.client.mutate({ ...input, threadId, baseVersion: version, origin: this.origin });
      if (result.result === "conflict") { report.conflict = true; this.dirty.add(threadId); return false; }
      const { result: _result, tabId: _tabId, message: _message, ...next } = result;
      state = next;
      version = next.version;
      if (result.result === "ok") report.pushed.push(label);
      return true;
    };
    for (const each of navigated) {
      if (!(await push({ op: "update", tabId: each.tabId, tab: each.tab.ref, title: each.tab.title }, `update ${each.was} -> ${each.tab.item}`))) return report;
    }
    // Closed here: only what this window had at the last agreement. A tab it never showed (one it couldn't open, a diff BB shows as its git tab) isn't the user's close.
    for (const item of base.items) {
      if (has(deskItems, item) || failed.has(item) || !has(serverItems, item) || !has(base.deskOrder, item) || movedFrom.has(item)) continue;
      const tab = current().tabs.find((each) => sameKey(itemOf(each), item));
      if (tab && !(await push({ op: "close", tabId: tab.tabId }, `close ${item}`))) return report;
    }
    for (const tab of desk.tabs) {
      if (movedTo.has(tab.item)) continue;
      if (!keptHere.has(tab.item) && (has(base.items, tab.item) || has(serverItems, tab.item))) continue;
      if (!(await push({ op: "open", tab: tab.ref, title: tab.title, focus: false }, `open ${tab.item}`))) return report;
    }
    // Order: when this window's order changed since the last round, the server takes it.
    const commonBase = base.deskOrder.filter((item) => has(deskItems, item));
    const commonNow = deskItems.filter((item) => has(base.deskOrder, item));
    if (saved && commonBase.join("\n") !== commonNow.join("\n")) {
      const order = deskItems.filter((item) => current().tabs.some((tab) => sameKey(itemOf(tab), item)));
      for (let at = 0; at < order.length; at++) {
        const tabs = current().tabs;
        const tab = tabs.find((each) => sameKey(itemOf(each), order[at]!));
        const wanted = tabs.findIndex((each) => each === tab);
        if (!tab || wanted === at) continue;
        if (!(await push({ op: "reorder", tabId: tab.tabId, position: at }, `reorder ${order[at]}`))) return report;
      }
    }
    // Selection: the user's pick here wins; otherwise the server's follows here, without opening a closed panel or moving the user while they type.
    const deskPicked = desk.active !== null && desk.active !== base.deskActive;
    const serverActive = activeOf(current());
    if (deskPicked && desk.active !== serverActive) {
      const tab = current().tabs.find((each) => sameKey(itemOf(each), desk.active!));
      if (tab && !(await push({ op: "focus", tabId: tab.tabId }, `focus ${desk.active}`))) return report;
    } else if (!deskPicked && serverActive && serverActive !== base.active && serverActive !== desk.active && desk.open && typingIn === null) {
      const target = deskTabs(wb).tabs.find((tab) => sameKey(tab.item, serverActive));
      if (target && wb.focus(target.key)) report.applied.push(`focus ${serverActive}`);
    }
    desk = deskTabs(wb);
    this.snapshots.save(threadId, snapshotOf(current(), desk));
    return report;
  }
}

/** A snapshot store in localStorage, so a reload keeps the last agreed state. */
export function localSnapshots(storage: Pick<Storage, "getItem" | "setItem"> | null): SnapshotStore {
  const memory = new Map<string, SyncSnapshot>();
  const key = (threadId: string) => `studio.workspaceSync.${threadId}`;
  return {
    load: (threadId) => {
      if (memory.has(threadId)) return memory.get(threadId)!;
      try {
        const text = storage?.getItem(key(threadId));
        const parsed = text ? JSON.parse(text) as SyncSnapshot : null;
        if (parsed && typeof parsed.version === "number" && Array.isArray(parsed.items) && Array.isArray(parsed.deskOrder)) { memory.set(threadId, parsed); return parsed; }
      } catch { /* unreadable: start over */ }
      return null;
    },
    save: (threadId, snapshot) => {
      memory.set(threadId, snapshot);
      try { storage?.setItem(key(threadId), JSON.stringify(snapshot)); } catch { /* full or blocked: memory still has it */ }
    },
  };
}
