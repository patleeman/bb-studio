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
  slugId,
  type CanvasChange,
  type CanvasItem,
  type CanvasKind,
  type CanvasMeta,
  type CanvasTurn,
  type CanvasView,
  type ItemInput,
  type ItemPatch,
  type SizeHint,
} from "./shared";

type CanvasRow = { id: string; thread_id: string | null; title: string; caption: string | null; status: string; rev: number; turn: number; created_at: number; updated_at: number; archived_at: number | null };
type ItemRow = { canvas_id: string; id: string; kind: string; title: string | null; data: string | null; options: string; html: string | null; size: string; importance: number; created_at: number; updated_at: number; rev: number };

/** Who made an edit: the canvas thread's agent, the hands-free voice, or the user. */
export type CanvasActor = "agent" | "voice" | "user";

/** One edit. All ops in a call apply, or none do. */
export type CanvasOp =
  | { op: "add"; item: ItemInput }
  | { op: "update"; patch: ItemPatch }
  | { op: "remove"; id: string }
  | { op: "clear" }
  /** Replace the whole board: ids already there are updated in place, the rest added, the others removed. */
  | { op: "set"; items: ItemInput[] };

export interface EditResult { rev: number; changes: CanvasChange[]; items: CanvasItem[] }

const parse = (text: string | null): unknown => (text === null ? null : JSON.parse(text));
const DEFAULT_IMPORTANCE = 3;

function toItem(row: ItemRow): CanvasItem {
  return {
    id: row.id, kind: row.kind as CanvasKind, title: row.title, data: parse(row.data), options: (parse(row.options) as Record<string, unknown>) ?? {},
    html: row.html, size: row.size as SizeHint, importance: row.importance, createdAt: row.created_at, updatedAt: row.updated_at, rev: row.rev,
  };
}

const label = (item: Pick<CanvasItem, "id" | "kind" | "title">) => `${item.kind} "${item.title ?? item.id}"`;

export class CanvasStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  create(input: { threadId?: string | null; title?: string }): CanvasRow {
    const id = `cnv_${randomBytes(8).toString("hex")}`;
    const at = this.now();
    this.db.prepare("INSERT INTO canvases (id, thread_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, input.threadId ?? null, input.title?.trim() ?? "", at, at);
    return this.get(id)!;
  }

  /** Links a canvas made before its thread to the thread. */
  attach(id: string, threadId: string): void {
    this.db.prepare("UPDATE canvases SET thread_id = ? WHERE id = ?").run(threadId, id);
  }

  delete(id: string): void {
    this.db.transaction(() => {
      for (const table of ["canvas_items", "canvas_changes", "canvas_turns"]) this.db.prepare(`DELETE FROM ${table} WHERE canvas_id = ?`).run(id);
      this.db.prepare("DELETE FROM canvases WHERE id = ?").run(id);
    })();
  }

  get(id: string): CanvasRow | null {
    return (this.db.prepare("SELECT * FROM canvases WHERE id = ?").get(id) as CanvasRow | undefined) ?? null;
  }

  byThread(threadId: string): CanvasRow | null {
    return (this.db.prepare("SELECT * FROM canvases WHERE thread_id = ?").get(threadId) as CanvasRow | undefined) ?? null;
  }

  list(): CanvasMeta[] {
    const rows = this.db.prepare("SELECT * FROM canvases WHERE archived_at IS NULL AND thread_id IS NOT NULL ORDER BY updated_at DESC").all() as CanvasRow[];
    return rows.map((row) => this.meta(row));
  }

  private meta(row: CanvasRow): CanvasMeta {
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM canvas_items WHERE canvas_id = ?").get(row.id) as { n: number }).n;
    return { id: row.id, threadId: row.thread_id ?? "", title: row.title || "Untitled canvas", createdAt: row.created_at, updatedAt: row.updated_at, itemCount: count };
  }

  items(canvasId: string): CanvasItem[] {
    return (this.db.prepare("SELECT * FROM canvas_items WHERE canvas_id = ? ORDER BY importance DESC, created_at, id").all(canvasId) as ItemRow[]).map(toItem);
  }

  /** The latest changes, oldest first. */
  changes(canvasId: string, limit = 40): CanvasChange[] {
    const rows = this.db.prepare("SELECT * FROM canvas_changes WHERE canvas_id = ? ORDER BY seq DESC LIMIT ?").all(canvasId, limit) as { seq: number; rev: number; turn: number; op: string; item_id: string | null; summary: string; by: string; at: number }[];
    return rows.reverse().map((row) => ({ seq: row.seq, rev: row.rev, turn: row.turn, op: row.op as CanvasChange["op"], itemId: row.item_id, summary: row.summary, by: row.by, at: row.at }));
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
      items: this.items(id), changes: this.changes(id), history: this.history(id),
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
          updatedAt: at, rev,
        };
        checkItem(next);
        board.set(next.id, next);
        const fields = (["kind", "title", "data", "options", "html", "size", "importance"] as const).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]));
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
            break;
          case "set": {
            const ids = new Set<string>();
            for (const input of op.items) {
              if (input.id && ids.has(input.id)) throw new Error(`"${input.id}" is in the list twice.`);
              if (input.id) ids.add(input.id);
            }
            for (const id of [...board.keys()]) if (!ids.has(id)) remove(id);
            for (const input of op.items) {
              if (input.id && board.has(input.id)) update({ ...input, id: input.id, replaceOptions: true, options: input.options ?? {}, data: input.data ?? null, title: input.title ?? null, html: input.html ?? undefined });
              else add(input);
            }
            break;
          }
        }
      }
      if (board.size > CANVAS_LIMITS.items) throw new Error(`A board holds at most ${CANVAS_LIMITS.items} items; it would have ${board.size}. Remove what no longer matters.`);

      this.db.prepare("DELETE FROM canvas_items WHERE canvas_id = ?").run(canvasId);
      const insert = this.db.prepare("INSERT INTO canvas_items (canvas_id, id, kind, title, data, options, html, size, importance, created_at, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const item of board.values()) {
        insert.run(canvasId, item.id, item.kind, item.title, item.data === null || item.data === undefined ? null : JSON.stringify(item.data), JSON.stringify(item.options), item.html, item.size, item.importance, item.createdAt, item.updatedAt, item.rev);
      }
      this.db.prepare("UPDATE canvases SET rev = ?, updated_at = ? WHERE id = ?").run(rev, at, canvasId);
      const write = this.db.prepare("INSERT INTO canvas_changes (canvas_id, rev, turn, op, item_id, summary, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const changes: CanvasChange[] = log.map((change) => ({ ...change, seq: Number(write.run(canvasId, change.rev, change.turn, change.op, change.itemId, change.summary, change.by, change.at).lastInsertRowid) }));
      this.db.prepare("DELETE FROM canvas_changes WHERE canvas_id = ? AND seq <= (SELECT seq FROM canvas_changes WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)").run(canvasId, canvasId, CANVAS_LIMITS.changesKept);
      return { rev, changes, items: this.items(canvasId) };
    }).immediate();
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
export function clipCaption(text: string): string {
  const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/::\w+\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return flat.length > CANVAS_LIMITS.captionChars ? `${flat.slice(0, CANVAS_LIMITS.captionChars - 1).trimEnd()}…` : flat;
}
