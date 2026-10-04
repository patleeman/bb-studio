// Page checklists as work items. A checklist item can be handed to an agent:
// Pages starts a thread with the item as its prompt, puts a mention of the
// thread at the end of the item, and keeps the mention's label on the
// thread's state (working, needs input, replied, failed…). The user checks
// the item off after reviewing.
import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { untitled } from "@bb-studio/kit/format";
import { pageCheckboxes } from "@bb-studio/kit/page-checkbox";
import { primaryHostId, studioServices } from "@bb-studio/kit/server";
import { PLUGIN_ID } from "./constants";
import { readMarkdown, tagChecklistThread } from "./doc";
import type { PagesService } from "./service";
import type { PageStore } from "./store";

export const CHECKLIST_STATES = ["starting", "working", "needs-input", "replied", "failed", "archived", "deleted"] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];
const STATE_LABELS: Record<ChecklistState, string> = {
  starting: "starting",
  working: "working",
  "needs-input": "needs input",
  replied: "replied",
  failed: "failed",
  archived: "archived",
  deleted: "deleted",
};
export const checklistLabel = (state: ChecklistState) => `Agent · ${STATE_LABELS[state]}`;

export type ChecklistSignal = "active" | "idle" | "failed" | "needs-input" | "archived" | "unarchived" | "deleted";

/** The handoff's next state for a thread event, or null when it stays. */
export function nextChecklistState(state: ChecklistState, signal: ChecklistSignal): ChecklistState | null {
  const next: ChecklistState | null =
    signal === "active" ? "working" :
    signal === "idle" ? "replied" :
    signal === "failed" ? "failed" :
    signal === "needs-input" ? "needs-input" :
    signal === "archived" ? "archived" :
    signal === "deleted" ? "deleted" :
    state === "archived" ? "replied" : null;
  return next === state ? null : next;
}

export interface ChecklistHandoffRow {
  thread_id: string;
  page_id: string;
  block_id: string;
  title: string;
  state: ChecklistState;
  note: string | null;
  created_at: number;
  updated_at: number;
}

/** A checklist item's text, without agent mentions. */
export function checklistTitle(title: string): string {
  return title
    .replace(/\s*@\[[^\]]*\]\(thread:[^)]+\)/g, "")
    .replace(/\s*@$/, "")
    .replace(/^↳\s*/, "")
    .trim();
}

/** The first message of a handed-off thread: the item, and a mention of its page. */
export function checklistPrompt(page: { id: string; title: string }, item: string, note: string | null) {
  let text = "Work on this checklist item from the page ";
  const label = untitled(page.title);
  const shown = `@${label}`;
  const mentions = [{ start: text.length, end: text.length + shown.length, resource: { kind: "plugin" as const, pluginId: PLUGIN_ID, itemId: `page:${page.id}`, label } }];
  text += `${shown}: "${item}"\n`;
  if (note?.trim()) text += `\n${note.trim()}\n`;
  text += "\nThe page has the item's context. When you're done, end with a one-line summary of what you did. Don't check the item off: the user does that after reviewing.";
  return { type: "text" as const, text, mentions };
}

export class Checklists {
  private readonly services;

  constructor(
    private readonly bb: BbPluginApi,
    private readonly db: Database.Database,
    private readonly service: PagesService,
    private readonly store: PageStore,
  ) {
    this.services = studioServices(bb.sdk);
  }

  handoffs(pageId: string): ChecklistHandoffRow[] {
    return this.db.prepare("SELECT * FROM checklist_handoffs WHERE page_id = ? ORDER BY created_at DESC").all(pageId) as ChecklistHandoffRow[];
  }

  private row(threadId: string): ChecklistHandoffRow | null {
    return (this.db.prepare("SELECT * FROM checklist_handoffs WHERE thread_id = ?").get(threadId) as ChecklistHandoffRow | undefined) ?? null;
  }

  /** Starts an agent on a checklist item and links its thread on the item. */
  async handOff(input: { pageId: string; blockId: string; note?: string | null }): Promise<{ threadId: string }> {
    const meta = this.store.meta(input.pageId);
    if (!meta) throw new Error("Page not found.");
    if (!meta.project_id) throw new Error("Move this page into a project so the agent has somewhere to work.");
    const page = this.service.hub.open(meta.id);
    const short = input.blockId.replace(/-/g, "").slice(0, 8);
    const checkbox = pageCheckboxes(readMarkdown(page.doc, { ids: true })).find((row) => row.blockId === short);
    if (!checkbox) throw new Error("Select a checklist item first.");
    const title = checklistTitle(checkbox.title);
    if (!title) throw new Error("Write the checklist item first.");
    const hostId = await primaryHostId(this.bb);
    const spawn = (workspace: { type: "managed-worktree"; baseBranch: { kind: "default" } } | { type: "unmanaged"; path: null }) =>
      this.bb.sdk.threads.spawn({
        projectId: meta.project_id!,
        input: [checklistPrompt({ id: meta.id, title: meta.title }, title, input.note ?? null)],
        title,
        environment: { type: "host", hostId, workspace },
        pluginMetadata: { pageId: meta.id, blockId: checkbox.blockId },
      } as never);
    // A worktree keeps the agent's changes apart; a folder that isn't a Git repository can't have one.
    const thread = await spawn({ type: "managed-worktree", baseBranch: { kind: "default" } }).catch(() => spawn({ type: "unmanaged", path: null }));
    const now = Date.now();
    this.db.prepare("INSERT OR IGNORE INTO checklist_handoffs (thread_id, page_id, block_id, title, state, note, created_at, updated_at) VALUES (?, ?, ?, ?, 'starting', NULL, ?, ?)")
      .run(thread.id, meta.id, checkbox.blockId, title, now, now);
    this.tag(this.row(thread.id)!);
    void this.services.linkThread({ threadId: thread.id, ref: { pluginId: PLUGIN_ID, id: meta.id }, role: "checklist", state: "starting", createdAt: now, updatedAt: now, metadata: { blockId: checkbox.blockId } })
      .catch(() => { /* Studio is optional. */ });
    return { threadId: thread.id };
  }

  /** Moves a handoff on a thread event, and relabels its mention on the page. */
  signal(threadId: string, signal: ChecklistSignal, note?: string | null): void {
    const row = this.row(threadId);
    if (!row) return;
    const next = nextChecklistState(row.state, signal);
    if (!next) return;
    const updated = { ...row, state: next, note: note === undefined ? row.note : firstLine(note), updated_at: Date.now() };
    this.db.prepare("UPDATE checklist_handoffs SET state = ?, note = ?, updated_at = ? WHERE thread_id = ?").run(updated.state, updated.note, updated.updated_at, threadId);
    this.tag(updated);
  }

  private tag(row: ChecklistHandoffRow): void {
    if (!this.store.meta(row.page_id)) return;
    try {
      const page = this.service.hub.open(row.page_id);
      if (tagChecklistThread(page.doc, row.block_id, row.thread_id, checklistLabel(row.state), "checklist")) this.service.hub.flush(page);
    } catch (error) {
      // The item may have been deleted or turned into something else.
      this.bb.log.info(`checklist ${row.page_id}/${row.block_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text.split("\n").map((each) => each.replace(/^[#>*\-\s`]+/, "").trim()).find(Boolean);
  return line ? line.slice(0, 160) : null;
}
