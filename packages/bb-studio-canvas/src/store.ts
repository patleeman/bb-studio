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
  type CanvasView,
  type Composition,
  type ItemInput,
  type ItemPatch,
  type SizeHint,
} from "./shared";
import { LOOK_INFO, lookOf, type Look, type OrganicLook } from "./looks";
import { organicFocus } from "./organic";

type CanvasRow = { id: string; thread_id: string | null; title: string; caption: string | null; status: string; rev: number; turn: number; created_at: number; updated_at: number; archived_at: number | null; look: string | null; composition: string | null; title_source: string | null; provider_id: string | null; model: string | null; reasoning_level: string | null; pending_execution: string | null };
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
  /** The board as a whole: its title (the topic) and composition; sameComposition allows repeating the last board's. */
  | { op: "board"; title?: string | null; composition?: Composition | null; sameComposition?: boolean };

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
      for (const table of ["canvas_items", "canvas_changes", "canvas_turns", "canvas_thread_aliases"]) this.db.prepare(`DELETE FROM ${table} WHERE canvas_id = ?`).run(id);
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
    return { id: row.id, threadId: row.thread_id ?? "", title: row.title || "Untitled canvas", createdAt: row.created_at, updatedAt: row.updated_at, itemCount: count, look: lookOf(row.look), composition: (row.composition as Composition | null) ?? null };
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
      let composition = fresh && before.size ? null : row.composition;
      const asked = boardOps.length ? Object.assign({}, ...boardOps) as Extract<CanvasOp, { op: "board" }> : null;
      if (asked?.composition) {
        if (fresh && before.size && asked.composition === row.composition && !asked.sameComposition) {
          throw new Error(`The last board was a "${row.composition}" composition too. Compose this one another way (orbit, giant-number, map, spine, split, quote, close-up, essay: whichever fits this content), or pass sameComposition: true only if the user asked for the same layout.`);
        }
        if (asked.composition !== row.composition) record("compose", null, `Composition: ${asked.composition}`);
        composition = asked.composition;
      }
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
      this.db.prepare("UPDATE canvases SET rev = ?, updated_at = ?, look = ?, composition = ?, title = ?, title_source = ? WHERE id = ?").run(rev, at, look, composition, title, titleSource, canvasId);
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
