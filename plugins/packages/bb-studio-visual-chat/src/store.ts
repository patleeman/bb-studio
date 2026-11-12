// The canvas board store: one board per canvas thread, in Studio's database
// (tables in src/migrations.ts). Every edit bumps the board's revision and
// writes a line per item to a short change log, tagged with the turn it
// happened in, so the app can tell what changed and the agent can read it back.
import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import {
  CANVAS_KIND_INFO,
  CANVAS_LIMITS,
  checkItem,
  isCanvasKind,
  slugId,
  type CanvasChange,
  type CanvasExecution,
  type CanvasItem,
  type CanvasKind,
  type CanvasMeta,
  type CanvasTurn,
  type CanvasVersion,
  type CanvasVersionMeta,
  type CanvasView,
  type ItemInput,
  type ItemPatch,
  type SizeHint,
} from "./shared";
import { LOOK_INFO, lookOf, type Look, type OrganicLook } from "./looks";
import { organicFocus } from "./organic";
import { outline, pageTitle, replacePart } from "./page";

type CanvasRow = { id: string; thread_id: string | null; title: string; caption: string | null; status: string; rev: number; turn: number; created_at: number; updated_at: number; archived_at: number | null; look: string | null; page: string | null; title_source: string | null; provider_id: string | null; model: string | null; reasoning_level: string | null; pending_execution: string | null; viewing?: number | null };
type ItemRow = { canvas_id: string; id: string; kind: string; title: string | null; data: string | null; options: string; html: string | null; size: string; importance: number; created_at: number; updated_at: number; rev: number; rel: string | null };

/** Who made an edit: the canvas thread's agent, the hands-free voice, or the user. */
export type CanvasActor = "agent" | "voice" | "user";

/** One edit. All ops in a call apply, or none do. */
export type CanvasOp =
  | { op: "add"; item: ItemInput }
  | { op: "update"; patch: ItemPatch }
  | { op: "remove"; id: string }
  | { op: "clear" }
  /** Replace the whole board: ids already there are updated in place, the rest added, the others removed. */
  | { op: "set"; items: ItemInput[] }
  /** The board's style (the agent picks it), with why. */
  | { op: "style"; look: OrganicLook; reason?: string | null }
  /** The board as a whole: its title (the topic). */
  | { op: "board"; title?: string | null };

export interface EditResult { rev: number; changes: CanvasChange[]; items: CanvasItem[] }

const parse = (text: string | null): unknown => (text === null ? null : JSON.parse(text));
const DEFAULT_IMPORTANCE = 3;

// Retired: note items (and any other kind Canvas no longer has) are left out
// wherever the board is read, and the next edit drops their rows.
const shownKinds = (rows: ItemRow[]) => rows.filter((row) => isCanvasKind(row.kind));
/** A change line about a note item, from before notes were retired. */
const NOTE_CHANGE = /^(Added|Updated|Removed) note "/;

/**
 * An item's placement, kept as JSON in its rel column (which once held
 * connectors: relatedTo and anchor are ignored when read, and dropped on
 * the next write).
 */
type Rel = Pick<CanvasItem, "scale" | "region" | "pinnedTo" | "point" | "side" | "bleed">;
const PLACEMENT = ["scale", "region", "pinnedTo", "point", "side", "bleed"] as const;
function relOf(text: string | null): Rel {
  const rel = (text ? parse(text) : null) as Partial<Rel> | null;
  const pinnedTo = typeof rel?.pinnedTo === "string" ? rel.pinnedTo : null;
  return { scale: rel?.scale ?? null, region: rel?.region ?? null, pinnedTo, point: pinnedTo ? rel?.point ?? null : null, side: pinnedTo ? rel?.side ?? null : null, bleed: rel?.bleed === true ? true : null };
}
const relText = (item: Rel) => {
  const placement = Object.fromEntries(PLACEMENT.filter((key) => item[key] !== null && item[key] !== undefined).map((key) => [key, item[key]]));
  return Object.keys(placement).length ? JSON.stringify(placement) : null;
};

/** The topic a board shows, for the canvas's title: its headline, else its hero's title. */
export function boardTitle(items: readonly CanvasItem[]): string | null {
  const text = (value: unknown) => (typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? (value as { text: string }).text : "").replace(/\s+/g, " ").trim();
  const headline = [...items].filter((item) => item.kind === "headline").sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)[0];
  const hero = organicFocus(items.map((item) => ({ ...item, accent: null })));
  const heroItem = hero ? items.find((item) => item.id === hero.id) : undefined;
  const found = (headline && text(headline.data)) || heroItem?.title?.trim() || (heroItem && (heroItem.kind === "quote" || heroItem.kind === "headline") ? text(heroItem.data) : "") || "";
  return found ? found.slice(0, CANVAS_LIMITS.title) : null;
}

function toItem(row: ItemRow): CanvasItem {
  return {
    ...relOf(row.rel),
    id: row.id, kind: row.kind as CanvasKind, title: row.title, data: parse(row.data), options: (parse(row.options) as Record<string, unknown>) ?? {},
    html: row.html, size: row.size as SizeHint, importance: row.importance, createdAt: row.created_at, updatedAt: row.updated_at, rev: row.rev,
  };
}

const label = (item: Pick<CanvasItem, "id" | "kind" | "title">) => `${item.kind} "${item.title ?? item.id}"`;

export class CanvasStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  create(input: { threadId?: string | null; title?: string; look?: Look | null; execution?: CanvasExecution | null }): CanvasRow {
    const id = `cnv_${randomBytes(8).toString("hex")}`;
    const at = this.now();
    const run = input.execution ?? null;
    this.db.prepare("INSERT INTO canvases (id, thread_id, title, created_at, updated_at, look, provider_id, model, reasoning_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.threadId ?? null, input.title?.trim() ?? "", at, at, input.look ?? null, run?.providerId ?? null, run?.model ?? null, run?.reasoningLevel ?? null);
    return this.get(id)!;
  }

  /** Links a canvas made before its thread to the thread. A thread it had before stays an alias, so its links still find the canvas. */
  attach(id: string, threadId: string): void {
    this.db.transaction(() => {
      const before = this.get(id)?.thread_id;
      if (before && before !== threadId) this.db.prepare("INSERT OR REPLACE INTO canvas_thread_aliases (thread_id, canvas_id) VALUES (?, ?)").run(before, id);
      this.db.prepare("UPDATE canvases SET thread_id = ? WHERE id = ?").run(threadId, id);
    })();
  }

  /** What the canvas's thread runs on, as last set. */
  execution(id: string): CanvasExecution | null {
    const row = this.get(id);
    return row?.provider_id && row.model ? { providerId: row.provider_id, model: row.model, reasoningLevel: row.reasoning_level } : null;
  }

  setExecution(id: string, execution: CanvasExecution): void {
    this.db.prepare("UPDATE canvases SET provider_id = ?, model = ?, reasoning_level = ?, pending_execution = NULL WHERE id = ?").run(execution.providerId, execution.model, execution.reasoningLevel, id);
  }

  /** A provider switch for the next turn (null clears it). */
  pendingExecution(id: string): CanvasExecution | null {
    const text = this.get(id)?.pending_execution;
    return text ? (JSON.parse(text) as CanvasExecution) : null;
  }

  setPendingExecution(id: string, execution: CanvasExecution | null): void {
    this.db.prepare("UPDATE canvases SET pending_execution = ? WHERE id = ?").run(execution ? JSON.stringify(execution) : null, id);
  }

  delete(id: string): void {
    this.db.transaction(() => {
      for (const table of ["canvas_items", "canvas_changes", "canvas_turns", "canvas_thread_aliases", "canvas_versions"]) this.db.prepare(`DELETE FROM ${table} WHERE canvas_id = ?`).run(id);
      this.db.prepare("DELETE FROM canvases WHERE id = ?").run(id);
    })();
  }

  get(id: string): CanvasRow | null {
    return (this.db.prepare("SELECT * FROM canvases WHERE id = ?").get(id) as CanvasRow | undefined) ?? null;
  }

  /** The canvas a thread backs now, or backed before a provider switch. */
  byThread(threadId: string): CanvasRow | null {
    const row = this.db.prepare("SELECT * FROM canvases WHERE thread_id = ?").get(threadId) as CanvasRow | undefined;
    if (row) return row;
    const alias = this.db.prepare("SELECT canvas_id FROM canvas_thread_aliases WHERE thread_id = ?").get(threadId) as { canvas_id: string } | undefined;
    return alias ? this.get(alias.canvas_id) : null;
  }

  list(): CanvasMeta[] {
    const rows = this.db.prepare("SELECT * FROM canvases WHERE archived_at IS NULL AND thread_id IS NOT NULL ORDER BY updated_at DESC").all() as CanvasRow[];
    return rows.map((row) => this.meta(row));
  }

  private meta(row: CanvasRow): CanvasMeta {
    const count = shownKinds(this.db.prepare("SELECT kind FROM canvas_items WHERE canvas_id = ?").all(row.id) as ItemRow[]).length;
    return { id: row.id, threadId: row.thread_id ?? "", title: row.title || "Untitled canvas", createdAt: row.created_at, updatedAt: row.updated_at, itemCount: count, look: lookOf(row.look) };
  }

  items(canvasId: string): CanvasItem[] {
    return shownKinds(this.db.prepare("SELECT * FROM canvas_items WHERE canvas_id = ? ORDER BY importance DESC, created_at, id").all(canvasId) as ItemRow[]).map(toItem);
  }

  /** The latest changes, oldest first. */
  changes(canvasId: string, limit = 40): CanvasChange[] {
    const rows = this.db.prepare("SELECT * FROM canvas_changes WHERE canvas_id = ? ORDER BY seq DESC LIMIT ?").all(canvasId, limit) as { seq: number; rev: number; turn: number; op: string; item_id: string | null; summary: string; by: string; at: number }[];
    return rows.reverse().filter((row) => !NOTE_CHANGE.test(row.summary)).map((row) => ({ seq: row.seq, rev: row.rev, turn: row.turn, op: row.op as CanvasChange["op"], itemId: row.item_id, summary: row.summary, by: row.by, at: row.at }));
  }

  history(canvasId: string, limit = 12): CanvasTurn[] {
    const rows = this.db.prepare("SELECT seq, role, text, at FROM canvas_turns WHERE canvas_id = ? ORDER BY seq DESC LIMIT ?").all(canvasId, limit) as CanvasTurn[];
    return rows.reverse();
  }

  view(id: string): CanvasView | null {
    const row = this.get(id);
    if (!row?.thread_id) return null;
    return {
      ...this.meta(row), rev: row.rev, turn: row.turn, status: (row.status as CanvasView["status"]) ?? "idle", caption: row.caption,
      execution: this.execution(id), pendingExecution: this.pendingExecution(id),
      page: row.page ?? null,
      items: this.items(id), changes: this.changes(id), history: this.history(id),
      versions: this.versions(id), viewing: this.viewing(id),
    };
  }

  /** A user (or voice) turn starts: the turn counter moves on, and the line goes in the history. */
  beginTurn(canvasId: string, role: "user" | "voice", text: string): number {
    return this.db.transaction(() => {
      const at = this.now();
      this.db.prepare("UPDATE canvases SET turn = turn + 1, updated_at = ? WHERE id = ?").run(at, canvasId);
      this.note(canvasId, role, text);
      return this.get(canvasId)!.turn;
    })();
  }

  /** A line in the history (the hidden transcript's summary), pruned to the last few hundred. */
  note(canvasId: string, role: string, text: string): void {
    const at = this.now();
    this.db.prepare("INSERT INTO canvas_turns (canvas_id, role, text, at) VALUES (?, ?, ?, ?)").run(canvasId, role, text.slice(0, CANVAS_LIMITS.messageChars), at);
    this.db.prepare("DELETE FROM canvas_turns WHERE canvas_id = ? AND seq <= (SELECT seq FROM canvas_turns WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)").run(canvasId, canvasId, CANVAS_LIMITS.turnsKept);
  }

  setStatus(canvasId: string, status: CanvasView["status"]): void {
    this.db.prepare("UPDATE canvases SET status = ? WHERE id = ?").run(status, canvasId);
  }

  /** The agent's reply, clipped to the line the page shows. */
  setCaption(canvasId: string, text: string | null): void {
    const caption = text?.trim() ? clipCaption(text) : null;
    this.db.prepare("UPDATE canvases SET caption = ?, updated_at = ? WHERE id = ?").run(caption, this.now(), canvasId);
  }

  setTitle(canvasId: string, title: string): void {
    this.db.prepare("UPDATE canvases SET title = ? WHERE id = ?").run(title.trim().slice(0, CANVAS_LIMITS.title), canvasId);
  }

  /**
   * Applies edits as one step: checks every item, bumps the revision once
   * and logs each change. Throws (and changes nothing) when any op fails.
   */
  edit(canvasId: string, ops: readonly CanvasOp[], by: CanvasActor): EditResult {
    return this.db.transaction(() => {
      const row = this.get(canvasId);
      if (!row) throw new Error("That canvas is gone.");
      const rev = row.rev + 1;
      const at = this.now();
      const board = new Map(this.items(canvasId).map((item) => [item.id, item]));
      const before = new Set(board.keys());
      let look = row.look;
      let cleared = false;
      const boardOps: Extract<CanvasOp, { op: "board" }>[] = [];
      const log: Omit<CanvasChange, "seq">[] = [];
      const record = (op: CanvasChange["op"], itemId: string | null, summary: string) => log.push({ rev, turn: row.turn, op, itemId, summary, by, at });

      const add = (input: ItemInput) => {
        const id = input.id ?? slugId(input.kind, input.title, new Set(board.keys()));
        if (board.has(id)) throw new Error(`There's already an item "${id}". Update it with canvas_update, or pick another id.`);
        if (input.html && input.kind !== "custom") throw new Error(`Only a custom item takes html; ${input.kind} reads data and options.`);
        const item: CanvasItem = {
          id, kind: input.kind, title: input.title?.trim() || null, data: input.data ?? null, options: input.options ?? {},
          html: input.kind === "custom" ? input.html ?? null : null, size: input.size ?? CANVAS_KIND_INFO[input.kind].size,
          importance: input.importance ?? DEFAULT_IMPORTANCE, createdAt: at, updatedAt: at, rev,
          scale: input.scale ?? null, region: input.region ?? null, pinnedTo: input.pinnedTo && input.pinnedTo !== id ? input.pinnedTo : null, point: input.pinnedTo ? input.point ?? null : null, side: input.pinnedTo ? input.side ?? null : null, bleed: input.bleed === true ? true : null,
        };
        checkItem(item);
        board.set(id, item);
        record("add", id, `Added ${label(item)}`);
      };
      const update = (patch: ItemPatch) => {
        const before = board.get(patch.id);
        if (!before) throw new Error(`No item "${patch.id}" on the board. canvas_read lists them.`);
        const options = patch.options === undefined ? before.options : patch.replaceOptions ? patch.options : mergeOptions(before.options, patch.options);
        const kind = patch.kind ?? before.kind;
        if (patch.html && kind !== "custom") throw new Error(`Only a custom item takes html; ${kind} reads data and options.`);
        const next: CanvasItem = {
          ...before, kind,
          title: patch.title === undefined ? before.title : patch.title?.trim() || null,
          data: patch.data === undefined ? before.data : patch.data,
          options,
          html: kind !== "custom" ? null : patch.html === undefined ? before.html : patch.html,
          size: patch.size ?? before.size,
          importance: patch.importance ?? before.importance,
          scale: patch.scale === undefined ? before.scale ?? null : patch.scale,
          region: patch.region === undefined ? before.region ?? null : patch.region,
          pinnedTo: patch.pinnedTo === undefined ? before.pinnedTo ?? null : patch.pinnedTo && patch.pinnedTo !== before.id ? patch.pinnedTo : null,
          point: patch.point === undefined ? before.point ?? null : patch.point,
          side: patch.side === undefined ? before.side ?? null : patch.side,
          bleed: patch.bleed === undefined ? before.bleed ?? null : patch.bleed === true ? true : null,
          updatedAt: at, rev,
        };
        checkItem(next);
        board.set(next.id, next);
        const fields = (["kind", "title", "data", "options", "html", "size", "importance", "scale", "region", "pinnedTo", "point", "side", "bleed"] as const).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]));
        record("update", next.id, `Updated ${label(next)}${fields.length ? ` (${fields.join(", ")})` : " (no change)"}`);
      };
      const remove = (id: string) => {
        const before = board.get(id);
        if (!before) throw new Error(`No item "${id}" on the board.`);
        board.delete(id);
        record("remove", id, `Removed ${label(before)}`);
      };

      for (const op of ops) {
        switch (op.op) {
          case "add": add(op.item); break;
          case "update": update(op.patch); break;
          case "remove": remove(op.id); break;
          case "clear":
            if (board.size) record("clear", null, `Cleared ${board.size} item(s)`);
            board.clear();
            cleared = true;
            break;
          case "board":
            boardOps.push(op);
            break;
          case "style":
            // Logged when it changes, and the agent's first pick (even of the style the canvas started in), with its reason.
            if (op.look !== lookOf(look) || !(log.some((change) => change.op === "style") || this.db.prepare("SELECT 1 FROM canvas_changes WHERE canvas_id = ? AND op = 'style' LIMIT 1").get(canvasId))) record("style", null, `Style: ${LOOK_INFO[op.look].name}${op.reason?.trim() ? ` (${op.reason.trim().slice(0, 160)})` : ""}`);
            look = op.look;
            break;
          case "set": {
            const ids = new Set<string>();
            for (const input of op.items) {
              if (input.id && ids.has(input.id)) throw new Error(`"${input.id}" is in the list twice.`);
              if (input.id) ids.add(input.id);
            }
            for (const id of [...board.keys()]) if (!ids.has(id)) remove(id);
            for (const input of op.items) {
              if (input.id && board.has(input.id)) update({ ...input, id: input.id, replaceOptions: true, options: input.options ?? {}, data: input.data ?? null, title: input.title ?? null, html: input.html ?? undefined, scale: input.scale ?? null, region: input.region ?? null, pinnedTo: input.pinnedTo ?? null, point: input.point ?? null, side: input.side ?? null, bleed: input.bleed ?? null });
              else add(input);
            }
            break;
          }
        }
      }
      if (board.size > CANVAS_LIMITS.items) throw new Error(`A board holds at most ${CANVAS_LIMITS.items} items; it would have ${board.size}. Remove what no longer matters.`);

      // A new board: cleared, or none of what was there stays (a topic change).
      const fresh = cleared || !before.size || (board.size > 0 && ![...board.keys()].some((id) => before.has(id)));
      const asked = boardOps.length ? Object.assign({}, ...boardOps) as Extract<CanvasOp, { op: "board" }> : null;
      // The title follows the topic: the agent's, else the board's headline or hero (on a new board, or until the agent names one).
      let title = row.title;
      let titleSource = row.title_source;
      if (asked?.title?.trim()) { title = asked.title.trim().slice(0, CANVAS_LIMITS.title); titleSource = "agent"; }
      else if (fresh || titleSource !== "agent") {
        const derived = boardTitle([...board.values()]);
        if (derived) { title = derived; titleSource = "hero"; }
      }

      this.db.prepare("DELETE FROM canvas_items WHERE canvas_id = ?").run(canvasId);
      const insert = this.db.prepare("INSERT INTO canvas_items (canvas_id, id, kind, title, data, options, html, size, importance, created_at, updated_at, rev, rel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const item of board.values()) {
        insert.run(canvasId, item.id, item.kind, item.title, item.data === null || item.data === undefined ? null : JSON.stringify(item.data), JSON.stringify(item.options), item.html, item.size, item.importance, item.createdAt, item.updatedAt, item.rev, relText(item));
      }
      this.db.prepare("UPDATE canvases SET rev = ?, updated_at = ?, look = ?, title = ?, title_source = ? WHERE id = ?").run(rev, at, look, title, titleSource, canvasId);
      const write = this.db.prepare("INSERT INTO canvas_changes (canvas_id, rev, turn, op, item_id, summary, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const changes: CanvasChange[] = log.map((change) => ({ ...change, seq: Number(write.run(canvasId, change.rev, change.turn, change.op, change.itemId, change.summary, change.by, change.at).lastInsertRowid) }));
      this.db.prepare("DELETE FROM canvas_changes WHERE canvas_id = ? AND seq <= (SELECT seq FROM canvas_changes WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)").run(canvasId, canvasId, CANVAS_LIMITS.changesKept);
      return { rev, changes, items: this.items(canvasId) };
    }).immediate();
  }

  /**
   * Replaces the board with a page (src/page.ts): one revision, logged. The
   * title is the agent's when given, else the page's first heading. A page
   * replaces any items left from before pages.
   */
  // Versions: the board at the end of each turn, to page back and forward through. ---------------------------

  /** The canvas's versions, oldest first (without their boards). A board from before versions becomes version 1. */
  versions(canvasId: string): CanvasVersionMeta[] {
    this.ensureFirstVersion(canvasId);
    const rows = this.db.prepare("SELECT n, look, title, prompt, caption, rev, from_n, at, page IS NULL AS old FROM canvas_versions WHERE canvas_id = ? ORDER BY n").all(canvasId) as { n: number; look: string | null; title: string; prompt: string | null; caption: string | null; rev: number; from_n: number | null; at: number; old: number }[];
    return rows.map((row) => ({ n: row.n, look: lookOf(row.look), title: row.title, prompt: row.prompt, caption: row.caption, rev: row.rev, from: row.from_n, at: row.at, items: row.old === 1 }));
  }

  /** One version with its board: the page, or a board of items from before pages. */
  version(canvasId: string, n: number): CanvasVersion | null {
    const row = this.db.prepare("SELECT * FROM canvas_versions WHERE canvas_id = ? AND n = ?").get(canvasId, n) as { n: number; page: string | null; items: string | null; look: string | null; title: string; prompt: string | null; caption: string | null; rev: number; from_n: number | null; at: number } | undefined;
    if (!row) return null;
    const items = row.page === null ? ((parse(row.items) as CanvasItem[] | null) ?? []) : [];
    return { n: row.n, look: lookOf(row.look), title: row.title, prompt: row.prompt, caption: row.caption, rev: row.rev, from: row.from_n, at: row.at, items: row.page === null, page: row.page, board: items };
  }

  /** The version the user is looking at, or null for the latest. */
  viewing(canvasId: string): number | null {
    const row = this.get(canvasId);
    return typeof row?.viewing === "number" ? row.viewing : null;
  }

  setViewing(canvasId: string, n: number | null): void {
    const latest = this.latestVersion(canvasId);
    const next = n !== null && n !== latest?.n && this.version(canvasId, n) ? n : null;
    this.db.prepare("UPDATE canvases SET viewing = ? WHERE id = ?").run(next, canvasId);
  }

  private latestVersion(canvasId: string): { n: number; page: string | null; items: string | null; look: string | null; caption: string | null } | null {
    return (this.db.prepare("SELECT n, page, items, look, caption FROM canvas_versions WHERE canvas_id = ? ORDER BY n DESC LIMIT 1").get(canvasId) as { n: number; page: string | null; items: string | null; look: string | null; caption: string | null } | undefined) ?? null;
  }

  /** A canvas from before versions: its board as it is, as version 1 (never mid-turn, when the board is a draft). */
  ensureFirstVersion(canvasId: string): void {
    if (this.db.prepare("SELECT 1 FROM canvas_versions WHERE canvas_id = ? LIMIT 1").get(canvasId)) return;
    const row = this.get(canvasId);
    // Mid-turn, the board is a draft: the turn's end saves it.
    if (!row || row.status === "working" || (!row.page && !this.items(canvasId).length)) return;
    this.insertVersion(row, null);
  }

  /**
   * The turn ended: its finished board becomes the next version, with the prompt that led to it and the caption.
   * Nothing is saved for an empty board or one exactly like the latest version. Past VERSIONS_KEPT the oldest go.
   */
  saveVersion(canvasId: string, from: number | null = null): number | null {
    return this.db.transaction(() => {
      const row = this.get(canvasId);
      if (!row || (!row.page && !this.items(canvasId).length)) return null;
      const last = this.latestVersion(canvasId);
      const items = row.page ? null : JSON.stringify(this.items(canvasId));
      if (last && last.page === (row.page ?? null) && last.items === items && last.look === row.look && last.caption === row.caption) return null;
      const n = this.insertVersion(row, from);
      this.db.prepare("UPDATE canvases SET viewing = NULL WHERE id = ?").run(canvasId);
      this.db.prepare("DELETE FROM canvas_versions WHERE canvas_id = ? AND n <= (SELECT n FROM canvas_versions WHERE canvas_id = ? ORDER BY n DESC LIMIT 1 OFFSET ?)").run(canvasId, canvasId, CANVAS_LIMITS.versionsKept);
      return n;
    }).immediate();
  }

  /**
   * Version n takes the board as it is now (its page or items, style, title, caption): a turn whose page was
   * saved as its version early (a streamed page, when its block closed) fills in what came after at its end.
   */
  refreshVersion(canvasId: string, n: number): void {
    const row = this.get(canvasId);
    if (!row) return;
    const items = row.page ? null : JSON.stringify(this.items(canvasId));
    this.db.prepare("UPDATE canvas_versions SET page = ?, items = ?, look = ?, title = ?, caption = ?, rev = ? WHERE canvas_id = ? AND n = ?")
      .run(row.page ?? null, items, row.look, row.title, row.caption, row.rev, canvasId, n);
  }

  private insertVersion(row: CanvasRow, from: number | null): number {
    const n = ((this.db.prepare("SELECT MAX(n) AS n FROM canvas_versions WHERE canvas_id = ?").get(row.id) as { n: number | null }).n ?? 0) + 1;
    const prompt = [...this.history(row.id, 40)].reverse().find((line) => line.role === "user" || line.role === "voice")?.text ?? null;
    const items = row.page ? null : JSON.stringify(this.items(row.id));
    this.db.prepare("INSERT INTO canvas_versions (canvas_id, n, page, items, look, title, prompt, caption, rev, from_n, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, n, row.page ?? null, items, row.look, row.title, prompt?.slice(0, 2000) ?? null, row.caption, row.rev, from, this.now());
    return n;
  }

  /**
   * The board goes back to a version, to continue from it: its page (or its items), style, title and caption, as
   * a new revision, so it glides. Later versions stay; the next one saved is appended after them.
   */
  restoreVersion(canvasId: string, n: number, by: CanvasActor): void {
    const version = this.version(canvasId, n);
    if (!version) throw new Error(`There's no version ${n}.`);
    this.db.transaction(() => {
      this.db.prepare("UPDATE canvases SET look = ?, caption = ?, viewing = NULL WHERE id = ?").run(version.look, version.caption, canvasId);
      if (version.page !== null) this.setPage(canvasId, version.page, by, version.title || null);
      else {
        this.db.prepare("UPDATE canvases SET page = NULL WHERE id = ?").run(canvasId);
        this.edit(canvasId, [{ op: "set", items: version.board.map(({ createdAt: _c, updatedAt: _u, rev: _r, ...item }) => item as ItemInput) }, ...(version.title ? [{ op: "board" as const, title: version.title }] : [])], by);
      }
    }).immediate();
  }

  /** Pictures canvas_images found for a canvas, by key (a card's data-cv-id): kept in memory for its cards. */
  private readonly found = new Map<string, Map<string, { url: string; alt?: string }>>();
  pictures(canvasId: string): ReadonlyMap<string, { url: string; alt?: string }> {
    return this.found.get(canvasId) ?? new Map();
  }
  rememberPictures(canvasId: string, pictures: Record<string, { url: string; alt?: string }>): void {
    const map = this.found.get(canvasId) ?? new Map<string, { url: string; alt?: string }>();
    for (const [key, picture] of Object.entries(pictures)) map.set(key, { url: picture.url, alt: picture.alt });
    if (map.size > 200) for (const key of [...map.keys()].slice(0, map.size - 200)) map.delete(key);
    this.found.set(canvasId, map);
  }

  /** What the user wrote in this chat (their messages, oldest first): where a webpage part's URL may come from. */
  userTexts(canvasId: string, limit = 200): string[] {
    return (this.db.prepare("SELECT text FROM canvas_turns WHERE canvas_id = ? AND role = 'user' ORDER BY seq DESC LIMIT ?").all(canvasId, limit) as { text: string }[]).map((row) => row.text).reverse();
  }
  /** Webpage URLs (normalised, src/webpage.ts) this canvas may show, and where each came from. */
  webpageSource(canvasId: string, key: string): string | null {
    return (this.db.prepare("SELECT source FROM canvas_webpage_urls WHERE canvas_id = ? AND url = ?").get(canvasId, key) as { source: string } | undefined)?.source ?? null;
  }
  verifyWebpage(canvasId: string, key: string, source: string): void {
    this.db.prepare("INSERT INTO canvas_webpage_urls (canvas_id, url, source, at) VALUES (?, ?, ?, ?) ON CONFLICT(canvas_id, url) DO NOTHING").run(canvasId, key, source, this.now());
  }

  setPage(canvasId: string, html: string, by: CanvasActor, title: string | null = null): { rev: number; parts: number } {
    if (new TextEncoder().encode(html).length > CANVAS_LIMITS.pageBytes) throw new Error(`The page is over ${CANVAS_LIMITS.pageBytes / 1024} KB; make it leaner.`);
    if (!html.trim()) throw new Error("The page is empty.");
    return this.db.transaction(() => {
      const row = this.get(canvasId);
      if (!row) throw new Error("That canvas is gone.");
      const rev = row.rev + 1;
      const named = title?.trim();
      const derived = pageTitle(html);
      const nextTitle = named ? named.slice(0, CANVAS_LIMITS.title) : derived ? derived.slice(0, CANVAS_LIMITS.title) : row.title;
      const source = named ? "agent" : derived ? "page" : row.title_source;
      this.db.prepare("DELETE FROM canvas_items WHERE canvas_id = ?").run(canvasId);
      this.db.prepare("UPDATE canvases SET page = ?, rev = ?, updated_at = ?, title = ?, title_source = ? WHERE id = ?").run(html, rev, this.now(), nextTitle, source, canvasId);
      const parts = outline(html).length;
      this.logChange(canvasId, rev, row.turn, "page", null, `New page (${parts} part${parts === 1 ? "" : "s"})`, by);
      return { rev, parts };
    }).immediate();
  }

  /** Replaces one part of the page (by its data-cv-id); "" removes it. */
  patchPage(canvasId: string, id: string, html: string, by: CanvasActor): { rev: number } {
    return this.db.transaction(() => {
      const row = this.get(canvasId);
      if (!row) throw new Error("That canvas is gone.");
      if (!row.page) throw new Error("There's no page yet: write one with canvas_page.");
      const next = replacePart(row.page, id, html);
      if (next === null) throw new Error(`The page has no part with data-cv-id="${id}". Its parts: ${outline(row.page).map((part) => part.id).join(", ") || "none"}.`);
      if (new TextEncoder().encode(next).length > CANVAS_LIMITS.pageBytes) throw new Error(`The page would be over ${CANVAS_LIMITS.pageBytes / 1024} KB.`);
      const rev = row.rev + 1;
      this.db.prepare("UPDATE canvases SET page = ?, rev = ?, updated_at = ? WHERE id = ?").run(next, rev, this.now(), canvasId);
      this.logChange(canvasId, rev, row.turn, "patch", id, html.trim() ? `Changed part "${id}"` : `Removed part "${id}"`, by);
      return { rev };
    }).immediate();
  }

  private logChange(canvasId: string, rev: number, turn: number, op: CanvasChange["op"], itemId: string | null, summary: string, by: CanvasActor): void {
    this.db.prepare("INSERT INTO canvas_changes (canvas_id, rev, turn, op, item_id, summary, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(canvasId, rev, turn, op, itemId, summary, by, this.now());
    this.db.prepare("DELETE FROM canvas_changes WHERE canvas_id = ? AND seq <= (SELECT seq FROM canvas_changes WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)").run(canvasId, canvasId, CANVAS_LIMITS.changesKept);
  }
}

/** Options merged; a null value removes a key. */
export function mergeOptions(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** One line for the page: the reply's first paragraph, clipped. */
/**
 * Sentences that describe the board ("The board shows…", "I've laid it out on the board…"): the user is
 * looking at it, so the caption drops them. A caption that's nothing but board talk stays as it is.
 */
const BOARD_TALK = [
  /^(the|this|that|your) (board|page|canvas)\b/i,
  /\b(on|onto|in|to|across) (the|this|your) (board|page|canvas)\b/i,
  /^(here'?s|here is|below is|above is)\b/i,
];
export function dropBoardTalk(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+(?=["“'(]?[A-Z0-9])/);
  const kept = sentences.filter((sentence) => !BOARD_TALK.some((pattern) => pattern.test(sentence.trim())));
  return kept.length ? kept.join(" ") : text;
}

export function clipCaption(text: string): string {
  const flat = dropBoardTalk(text.replace(/```[\s\S]*?```/g, " ").replace(/::\w+\{[^}]*\}/g, "").replace(/\s+/g, " ").trim());
  return flat.length > CANVAS_LIMITS.captionChars ? `${flat.slice(0, CANVAS_LIMITS.captionChars - 1).trimEnd()}…` : flat;
}
