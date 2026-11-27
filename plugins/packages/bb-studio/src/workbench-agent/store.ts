// Each conversation's Workspace (its workbench tabs), kept on the server as
// the source of truth: the phone, every desktop window and the agent tools
// read and change the same tabs. Tables: thread_workbench_tabs (one row per
// tab, open or closed; a closed tab keeps its row with dismissed_at, so "the
// user closed what the agent opened" survives a restart) and
// thread_workbench_state (the active tab, the panel, the agent's layout
// record and a version). Every change bumps the version; a change made
// against an older version is refused as a conflict, and the caller reads
// again (src/workbench-agent/workspace-contract.ts).
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { cleanRef, refKey, refProblem, sameRef, type WorkspaceTabRef } from "./workspace";
import type { WorkbenchRecord } from "./shared";

export type Actor = "user" | "agent";

export interface WorkspaceTab {
  tabId: string;
  ref: WorkspaceTabRef;
  /** refKey(ref): what the tab shows, for matching. */
  item: string;
  title: string;
  position: number;
  openedBy: Actor;
  openedAt: number;
}

export interface ClosedTab { tabId: string; ref: WorkspaceTabRef; item: string; title: string; openedBy: Actor; closedBy: Actor; closedAt: number }

export interface WorkspaceState {
  threadId: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  panelOpen: boolean | null;
  /** 0 until anything was stored for the conversation. */
  version: number;
}

/** What the agent set of the desktop layout, and what the user changed after (workbench_arrange's record). */
export type LayoutRecord = Pick<WorkbenchRecord, "layoutSet" | "userLayout">;
const EMPTY_LAYOUT: LayoutRecord = { layoutSet: {}, userLayout: [] };

export type MutateOp =
  | { op: "open"; tab: WorkspaceTabRef; title: string; focus?: boolean; position?: number; force?: boolean }
  | { op: "close"; tabId: string }
  | { op: "focus"; tabId: string }
  | { op: "reorder"; tabId: string; position: number }
  /** The same tab now shows something else (a browser tab that navigated): its ref and title change in place. */
  | { op: "update"; tabId: string; tab: WorkspaceTabRef; title?: string };

export type MutateResult = "ok" | "unchanged" | "conflict" | "notFound" | "refused";

export interface MutateOutcome {
  result: MutateResult;
  /** The tab the op opened or acted on; null when there is none. */
  tabId: string | null;
  /** Why it was refused or not found; null otherwise. */
  message: string | null;
  /** True when an open added the tab (new, or one closed before); false when it was already open. */
  created: boolean;
  state: WorkspaceState;
}

/** A desktop tab brought over once, before the server had anything for its conversation. */
export interface ImportedTab { ref: WorkspaceTabRef; title: string }

/** How many closed tabs a conversation keeps (oldest dropped). */
export const CLOSED_CAP = 200;
/** How many open tabs a conversation keeps; an open past it is refused. */
export const OPEN_CAP = 100;

interface TabRow { thread_id: string; tab_id: string; position: number | null; ref: string; item: string; title: string; opened_by: string; opened_at: number; dismissed_at: number | null; closed_by: string | null }
interface StateRow { thread_id: string; active_tab_id: string | null; panel_open: number | null; layout: string | null; version: number; updated_at: number }

const actor = (value: string | null): Actor => (value === "agent" ? "agent" : "user");
const parseRef = (text: string): WorkspaceTabRef => { try { return JSON.parse(text) as WorkspaceTabRef; } catch { return { kind: "plugin", pluginId: null, tabId: null }; } };

export class WorkspaceStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now, private readonly newId: () => string = () => `wt_${randomUUID().replace(/-/g, "").slice(0, 16)}`) {}

  private rows(threadId: string): TabRow[] {
    return this.db.prepare("SELECT * FROM thread_workbench_tabs WHERE thread_id = ? AND dismissed_at IS NULL ORDER BY position, opened_at, tab_id").all(threadId) as TabRow[];
  }

  private stateRow(threadId: string): StateRow | null {
    return (this.db.prepare("SELECT * FROM thread_workbench_state WHERE thread_id = ?").get(threadId) as StateRow | undefined) ?? null;
  }

  private tabOf(row: TabRow, position: number): WorkspaceTab {
    return { tabId: row.tab_id, ref: parseRef(row.ref), item: row.item, title: row.title, position, openedBy: actor(row.opened_by), openedAt: row.opened_at };
  }

  get(threadId: string): WorkspaceState {
    const state = this.stateRow(threadId);
    const tabs = this.rows(threadId).map((row, index) => this.tabOf(row, index));
    const active = state?.active_tab_id && tabs.some((tab) => tab.tabId === state.active_tab_id) ? state.active_tab_id : null;
    return { threadId, tabs, activeTabId: active, panelOpen: state?.panel_open == null ? null : state.panel_open === 1, version: state?.version ?? 0 };
  }

  /** The tabs the user closed after the agent opened them, newest first: the agent doesn't reopen them without force. */
  closedByUser(threadId: string): ClosedTab[] {
    const rows = this.db.prepare("SELECT * FROM thread_workbench_tabs WHERE thread_id = ? AND dismissed_at IS NOT NULL AND closed_by = 'user' AND opened_by = 'agent' ORDER BY dismissed_at DESC").all(threadId) as TabRow[];
    return rows.map((row) => ({ tabId: row.tab_id, ref: parseRef(row.ref), item: row.item, title: row.title, openedBy: "agent", closedBy: "user", closedAt: row.dismissed_at! }));
  }

  layout(threadId: string): LayoutRecord {
    const text = this.stateRow(threadId)?.layout;
    if (!text) return EMPTY_LAYOUT;
    try {
      const parsed = JSON.parse(text) as Partial<LayoutRecord>;
      return { layoutSet: parsed.layoutSet ?? {}, userLayout: Array.isArray(parsed.userLayout) ? parsed.userLayout : [] };
    } catch { return EMPTY_LAYOUT; }
  }

  /** Saves the agent's layout record; not a Workspace change (no version bump). */
  setLayout(threadId: string, layout: LayoutRecord): void {
    const at = this.now();
    this.db.prepare(`INSERT INTO thread_workbench_state (thread_id, active_tab_id, panel_open, layout, version, updated_at) VALUES (?, NULL, NULL, ?, 0, ?)
      ON CONFLICT(thread_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`).run(threadId, JSON.stringify(layout), at);
  }

  /** Open tabs per conversation, for the conversation rows' "· 4 tabs". */
  tabCounts(threadIds: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (let at = 0; at < threadIds.length; at += 500) {
      const batch = threadIds.slice(at, at + 500);
      if (!batch.length) continue;
      const rows = this.db.prepare(`SELECT thread_id, COUNT(*) AS n FROM thread_workbench_tabs WHERE dismissed_at IS NULL AND thread_id IN (${batch.map(() => "?").join(",")}) GROUP BY thread_id`).all(...batch) as { thread_id: string; n: number }[];
      for (const row of rows) counts.set(row.thread_id, row.n);
    }
    return counts;
  }

  /**
   * Applies one change as `by`, when `baseVersion` is the current version
   * (or left out: the agent tools, which run on the server, always act on
   * the latest). Answers the state after it.
   */
  mutate(threadId: string, change: MutateOp, by: Actor, baseVersion?: number): MutateOutcome {
    return this.db.transaction((): MutateOutcome => {
      const before = this.get(threadId);
      let created = false;
      const done = (result: MutateResult, tabId: string | null, message: string | null = null): MutateOutcome => ({ result, tabId, message, created, state: result === "ok" ? this.get(threadId) : before });
      if (baseVersion !== undefined && baseVersion !== before.version) return done("conflict", null, `The Workspace changed (version ${before.version}, not ${baseVersion}). Read it again.`);
      const tabs = before.tabs;
      let active = before.activeTabId;
      let panelOpen = before.panelOpen;
      let order = tabs.map((tab) => tab.tabId);
      let target: string;
      switch (change.op) {
        case "open": {
          const ref = cleanRef(change.tab);
          const problem = refProblem(ref);
          if (problem) return done("refused", null, problem);
          const item = refKey(ref);
          const open = tabs.find((tab) => sameRef(tab.ref, ref));
          const focus = change.focus !== false;
          if (open) {
            target = open.tabId;
            const moved = change.position !== undefined ? this.moveTo(order, target, change.position) : order;
            if ((!focus || active === target) && moved.join() === order.join()) return done("unchanged", target);
            order = moved;
            if (focus) { active = target; panelOpen = true; }
            break;
          }
          if (tabs.length >= OPEN_CAP) return done("refused", null, `The Workspace holds at most ${OPEN_CAP} tabs. Close one first.`);
          const closed = (this.db.prepare("SELECT * FROM thread_workbench_tabs WHERE thread_id = ? AND dismissed_at IS NOT NULL ORDER BY dismissed_at DESC").all(threadId) as TabRow[]).find((row) => sameRef(parseRef(row.ref), ref));
          if (closed && by === "agent" && closed.opened_by === "agent" && closed.closed_by === "user" && !change.force) {
            return done("refused", closed.tab_id, `Not reopened: the user closed ${JSON.stringify(closed.title)} after you opened it. Pass force: true only when the user asks for it.`);
          }
          target = closed?.tab_id ?? this.newId();
          created = true;
          const at = this.now();
          this.db.prepare(`INSERT INTO thread_workbench_tabs (thread_id, tab_id, position, ref, item, title, opened_by, opened_at, dismissed_at, closed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            ON CONFLICT(thread_id, tab_id) DO UPDATE SET position = excluded.position, ref = excluded.ref, item = excluded.item, title = excluded.title, opened_by = excluded.opened_by, opened_at = excluded.opened_at, dismissed_at = NULL, closed_by = NULL`)
            .run(threadId, target, order.length, JSON.stringify(ref), item, change.title.trim() || "Untitled", by, at);
          order = this.moveTo([...order, target], target, change.position ?? order.length);
          if (focus || active === null) { active = target; if (focus) panelOpen = true; }
          break;
        }
        case "close": {
          const at = order.indexOf(change.tabId);
          if (at < 0) return done("notFound", null, `No open tab has id ${JSON.stringify(change.tabId)}.`);
          target = change.tabId;
          this.db.prepare("UPDATE thread_workbench_tabs SET dismissed_at = ?, closed_by = ?, position = NULL WHERE thread_id = ? AND tab_id = ?").run(this.now(), by, threadId, target);
          order = order.filter((id) => id !== target);
          if (active === target) active = order[at] ?? order[at - 1] ?? null;
          this.pruneClosed(threadId);
          break;
        }
        case "focus": {
          if (!order.includes(change.tabId)) return done("notFound", null, `No open tab has id ${JSON.stringify(change.tabId)}.`);
          target = change.tabId;
          if (active === target && panelOpen === true) return done("unchanged", target);
          active = target;
          panelOpen = true;
          break;
        }
        case "update": {
          const tab = tabs.find((each) => each.tabId === change.tabId);
          if (!tab) return done("notFound", null, `No open tab has id ${JSON.stringify(change.tabId)}.`);
          target = change.tabId;
          const ref = cleanRef(change.tab);
          const problem = refProblem(ref);
          if (problem) return done("refused", target, problem);
          const other = tabs.find((each) => each.tabId !== target && sameRef(each.ref, ref));
          if (other) return done("refused", other.tabId, `That is already open as tab ${JSON.stringify(other.tabId)}.`);
          const title = change.title?.trim() || tab.title;
          if (refKey(ref) === tab.item && JSON.stringify(ref) === JSON.stringify(cleanRef(tab.ref)) && title === tab.title) return done("unchanged", target);
          this.db.prepare("UPDATE thread_workbench_tabs SET ref = ?, item = ?, title = ? WHERE thread_id = ? AND tab_id = ?").run(JSON.stringify(ref), refKey(ref), title, threadId, target);
          break;
        }
        case "reorder": {
          if (!order.includes(change.tabId)) return done("notFound", null, `No open tab has id ${JSON.stringify(change.tabId)}.`);
          target = change.tabId;
          const moved = this.moveTo(order, target, change.position);
          if (moved.join() === order.join()) return done("unchanged", target);
          order = moved;
          break;
        }
      }
      this.write(threadId, order, active, panelOpen, before.version + 1);
      return done("ok", target);
    })();
  }

  /**
   * Brings a conversation's desktop tabs over, once: only while the server
   * has nothing for it (version 0). Answers whether it did, and the state.
   */
  importOnce(threadId: string, tabs: readonly ImportedTab[], activeIndex: number | null, panelOpen: boolean | null): { imported: boolean; state: WorkspaceState } {
    return this.db.transaction(() => {
      const before = this.get(threadId);
      if (before.version !== 0 || before.tabs.length) return { imported: false, state: before };
      const ids: string[] = [];
      let active: string | null = null;
      const at = this.now();
      const seen: WorkspaceTabRef[] = [];
      tabs.slice(0, OPEN_CAP).forEach((tab, index) => {
        const ref = cleanRef(tab.ref);
        if (refProblem(ref) || seen.some((each) => sameRef(each, ref))) return;
        seen.push(ref);
        const item = refKey(ref);
        const id = this.newId();
        this.db.prepare("INSERT INTO thread_workbench_tabs (thread_id, tab_id, position, ref, item, title, opened_by, opened_at, dismissed_at, closed_by) VALUES (?, ?, ?, ?, ?, ?, 'user', ?, NULL, NULL)")
          .run(threadId, id, ids.length, JSON.stringify(ref), item, tab.title.trim() || "Untitled", at);
        ids.push(id);
        if (index === activeIndex) active = id;
      });
      this.write(threadId, ids, active ?? ids[0] ?? null, panelOpen, 1);
      return { imported: true, state: this.get(threadId) };
    })();
  }

  /** Forgets a deleted conversation's Workspace. */
  deleteThread(threadId: string): void {
    this.db.prepare("DELETE FROM thread_workbench_tabs WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM thread_workbench_state WHERE thread_id = ?").run(threadId);
  }

  private moveTo(order: readonly string[], id: string, position: number): string[] {
    const rest = order.filter((each) => each !== id);
    const at = Math.max(0, Math.min(rest.length, Math.floor(position)));
    return [...rest.slice(0, at), id, ...rest.slice(at)];
  }

  private write(threadId: string, order: readonly string[], active: string | null, panelOpen: boolean | null, version: number): void {
    const update = this.db.prepare("UPDATE thread_workbench_tabs SET position = ? WHERE thread_id = ? AND tab_id = ?");
    order.forEach((id, index) => update.run(index, threadId, id));
    this.db.prepare(`INSERT INTO thread_workbench_state (thread_id, active_tab_id, panel_open, layout, version, updated_at) VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET active_tab_id = excluded.active_tab_id, panel_open = excluded.panel_open, version = excluded.version, updated_at = excluded.updated_at`)
      .run(threadId, active, panelOpen === null ? null : panelOpen ? 1 : 0, version, this.now());
  }

  private pruneClosed(threadId: string): void {
    this.db.prepare(`DELETE FROM thread_workbench_tabs WHERE thread_id = ? AND dismissed_at IS NOT NULL AND tab_id NOT IN (
      SELECT tab_id FROM thread_workbench_tabs WHERE thread_id = ? AND dismissed_at IS NOT NULL ORDER BY dismissed_at DESC LIMIT ?)`).run(threadId, threadId, CLOSED_CAP);
  }
}
