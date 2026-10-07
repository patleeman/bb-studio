// Designs in the plugin's SQLite database. A design holds rounds; a round
// holds a few options; each option is one self-contained HTML screen.
import type { Actor } from "@bb-studio/kit/server";
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { parseScreenId, parseSteps, parseViewport, screenUrl, type DesignView, type RoundView, type ScreenView, type Viewport } from "../shared";

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace).
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS designs (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       project_id TEXT,
       updated_by TEXT,
       archived_at INTEGER,
       template INTEGER NOT NULL DEFAULT 0
     );
   CREATE TABLE IF NOT EXISTS design_rounds (
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       round INTEGER NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       intro TEXT NOT NULL DEFAULT '',
       PRIMARY KEY (design_id, round)
     );
   CREATE TABLE IF NOT EXISTS design_screens (
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       id TEXT NOT NULL,
       round INTEGER NOT NULL,
       title TEXT NOT NULL DEFAULT '',
       caption TEXT NOT NULL DEFAULT '',
       viewport TEXT NOT NULL DEFAULT 'desktop',
       html TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (design_id, id)
     );`,
  `ALTER TABLE designs ADD COLUMN thread_id TEXT;`,
  `CREATE TABLE IF NOT EXISTS design_comments (
       id TEXT PRIMARY KEY,
       design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
       screen_id TEXT NOT NULL,
       selector TEXT NOT NULL,
       element_html TEXT NOT NULL DEFAULT '',
       element_text TEXT NOT NULL DEFAULT '',
       body TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       sent_at INTEGER,
       resolved_at INTEGER
     );
   CREATE INDEX IF NOT EXISTS design_comments_design ON design_comments(design_id, created_at);`,
  `ALTER TABLE design_comments ADD COLUMN step TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS design_styles (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       notes TEXT NOT NULL DEFAULT '',
       css TEXT NOT NULL,
       source_design_id TEXT,
       source_screen_id TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );`,
];

/** A look the user picked, saved so later designs and decks can start from it. */
export type StyleRow = {
  id: string;
  name: string;
  /** Fonts, colors, layout rhythm and rules, in words. */
  notes: string;
  /** The CSS that carries it: font links as @import, custom properties, base rules. */
  css: string;
  source_design_id: string | null;
  source_screen_id: string | null;
  created_at: number;
  updated_at: number;
};

export type DesignRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  project_id: string | null;
  /** "user" (canvas, app, Studio) or "agent" (agent, CLI); see writerKind. */
  updated_by: string | null;
  archived_at: number | null;
  template: number;
  /** The design's conversation: the thread its chat pane shows. */
  thread_id: string | null;
};

export type ScreenRow = {
  design_id: string;
  id: string;
  round: number;
  title: string;
  caption: string;
  viewport: string;
  html: string;
  created_at: number;
  updated_at: number;
};

export type CommentRow = {
  id: string;
  design_id: string;
  screen_id: string;
  /** The prototype step it was pinned on; "" when the screen has none. */
  step: string;
  /** Finds the element in the screen; ids where they exist, else a path of tags. */
  selector: string;
  /** The element's markup when it was picked, trimmed: what the agent edits. */
  element_html: string;
  element_text: string;
  body: string;
  created_at: number;
  /** When it went to the design's conversation. */
  sent_at: number | null;
  resolved_at: number | null;
};

type RoundRow = { design_id: string; round: number; title: string; intro: string };

/** Who wrote a change. The CLI counts as an agent: agents are its main users. */
export type Writer = Extract<Actor["kind"], "editor" | "agent" | "cli" | "app">;

export function writerKind(by: Writer): "user" | "agent" {
  return by === "agent" || by === "cli" ? "agent" : "user";
}

/** The name to show for a design; Studio creates them untitled. */
export function displayName(row: Pick<DesignRow, "name">): string {
  return row.name.trim() || "Untitled design";
}

function toScreenView(row: ScreenRow): ScreenView {
  return {
    id: row.id,
    round: row.round,
    option: row.id.slice(-1),
    title: row.title,
    caption: row.caption,
    viewport: parseViewport(row.viewport) ?? "desktop",
    updatedAt: row.updated_at,
    steps: parseSteps(row.html),
    url: screenUrl(row.design_id, row.id, row.updated_at),
  };
}

export class DesignStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    db.pragma("foreign_keys = ON");
  }

  get(id: string): DesignRow | null {
    return (this.db.prepare("SELECT * FROM designs WHERE id = ?").get(id) as DesignRow | undefined) ?? null;
  }

  list(options: { includeArchived?: boolean; limit?: number } = {}): DesignRow[] {
    return this.db
      .prepare(`SELECT * FROM designs ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC LIMIT ?`)
      .all(options.limit ?? -1) as DesignRow[];
  }

  create(input: { name: string; projectId?: string | null; by: Writer }): DesignRow {
    const id = newId("dsn");
    const at = this.now();
    this.db
      .prepare("INSERT INTO designs (id, name, created_at, updated_at, project_id, updated_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.name, at, at, input.projectId ?? null, writerKind(input.by));
    return this.get(id)!;
  }

  rename(id: string, name: string, by: Writer): number {
    return this.touch(id, by, name);
  }

  setProject(id: string, projectId: string | null): void {
    this.db.prepare("UPDATE designs SET project_id = ? WHERE id = ?").run(projectId, id);
  }

  setArchived(id: string, archived: boolean): void {
    this.db.prepare("UPDATE designs SET archived_at = ? WHERE id = ?").run(archived ? this.now() : null, id);
  }

  setThread(id: string, threadId: string | null): void {
    this.db.prepare("UPDATE designs SET thread_id = ? WHERE id = ?").run(threadId, id);
  }

  setTemplate(id: string, template: boolean): void {
    this.db.prepare("UPDATE designs SET template = ? WHERE id = ?").run(template ? 1 : 0, id);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM designs WHERE id = ?").run(id).changes > 0;
  }

  /** A new design with the source's rounds and screens. */
  copy(sourceId: string, input: { name: string; projectId: string | null; by: Writer }): DesignRow {
    return this.db.transaction(() => {
      const row = this.create(input);
      this.db.prepare(`INSERT INTO design_rounds (design_id, round, title, intro)
        SELECT ?, round, title, intro FROM design_rounds WHERE design_id = ?`).run(row.id, sourceId);
      this.db.prepare(`INSERT INTO design_screens (design_id, id, round, title, caption, viewport, html, created_at, updated_at)
        SELECT ?, id, round, title, caption, viewport, html, ?, ? FROM design_screens WHERE design_id = ?`).run(row.id, row.created_at, row.created_at, sourceId);
      return row;
    })();
  }

  screens(designId: string): ScreenRow[] {
    return this.db.prepare("SELECT * FROM design_screens WHERE design_id = ? ORDER BY round DESC, id ASC").all(designId) as ScreenRow[];
  }

  screen(designId: string, screenId: string): ScreenRow | null {
    return (this.db.prepare("SELECT * FROM design_screens WHERE design_id = ? AND id = ?").get(designId, screenId) as ScreenRow | undefined) ?? null;
  }

  /** Creates or replaces a screen. Returns the design's new revision. */
  writeScreen(designId: string, input: { id: string; html: string; title?: string; caption?: string; viewport?: Viewport }, by: Writer): number {
    const parsed = parseScreenId(input.id);
    if (!parsed) throw new Error(`Screen ids look like "1a": a round number and an option letter. Got "${input.id}".`);
    return this.db.transaction(() => {
      const at = this.touch(designId, by);
      const existing = this.screen(designId, input.id);
      this.db
        .prepare(`INSERT INTO design_screens (design_id, id, round, title, caption, viewport, html, created_at, updated_at)
          VALUES (@designId, @id, @round, @title, @caption, @viewport, @html, @at, @at)
          ON CONFLICT(design_id, id) DO UPDATE SET title = excluded.title, caption = excluded.caption,
            viewport = excluded.viewport, html = excluded.html, updated_at = excluded.updated_at`)
        .run({
          designId,
          id: input.id,
          round: parsed.round,
          title: input.title ?? existing?.title ?? "",
          caption: input.caption ?? existing?.caption ?? "",
          viewport: input.viewport ?? existing?.viewport ?? "desktop",
          html: input.html,
          at,
        });
      return at;
    })();
  }

  deleteScreen(designId: string, screenId: string, by: Writer): boolean {
    return this.db.transaction(() => {
      const removed = this.db.prepare("DELETE FROM design_screens WHERE design_id = ? AND id = ?").run(designId, screenId).changes > 0;
      if (removed) this.touch(designId, by);
      return removed;
    })();
  }

  setRound(designId: string, round: number, input: { title?: string; intro?: string }, by: Writer): number {
    return this.db.transaction(() => {
      const at = this.touch(designId, by);
      this.db
        .prepare(`INSERT INTO design_rounds (design_id, round, title, intro) VALUES (?, ?, ?, ?)
          ON CONFLICT(design_id, round) DO UPDATE SET title = COALESCE(?, title), intro = COALESCE(?, intro)`)
        .run(designId, round, input.title ?? "", input.intro ?? "", input.title ?? null, input.intro ?? null);
      return at;
    })();
  }

  comments(designId: string, options: { includeResolved?: boolean } = {}): CommentRow[] {
    return this.db
      .prepare(`SELECT * FROM design_comments WHERE design_id = ? ${options.includeResolved ? "" : "AND resolved_at IS NULL"} ORDER BY created_at ASC`)
      .all(designId) as CommentRow[];
  }

  comment(id: string): CommentRow | null {
    return (this.db.prepare("SELECT * FROM design_comments WHERE id = ?").get(id) as CommentRow | undefined) ?? null;
  }

  addComment(designId: string, input: { screenId: string; step?: string; selector: string; elementHtml: string; elementText: string; body: string }): CommentRow {
    const id = newId("dcm");
    this.db
      .prepare(`INSERT INTO design_comments (id, design_id, screen_id, step, selector, element_html, element_text, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, designId, input.screenId, input.step ?? "", input.selector, input.elementHtml, input.elementText, input.body, this.now());
    return this.comment(id)!;
  }

  markSent(id: string): void {
    this.db.prepare("UPDATE design_comments SET sent_at = ? WHERE id = ?").run(this.now(), id);
  }

  setResolved(id: string, resolved: boolean): void {
    this.db.prepare("UPDATE design_comments SET resolved_at = ? WHERE id = ?").run(resolved ? this.now() : null, id);
  }

  deleteComment(id: string): boolean {
    return this.db.prepare("DELETE FROM design_comments WHERE id = ?").run(id).changes > 0;
  }

  styles(): StyleRow[] {
    return this.db.prepare("SELECT * FROM design_styles ORDER BY updated_at DESC").all() as StyleRow[];
  }

  style(id: string): StyleRow | null {
    return (this.db.prepare("SELECT * FROM design_styles WHERE id = ?").get(id) as StyleRow | undefined) ?? null;
  }

  /** Saves a style; a name already in use is replaced, so saving again updates it. */
  saveStyle(input: { name: string; notes: string; css: string; designId?: string | null; screenId?: string | null }): StyleRow {
    const at = this.now();
    const existing = this.db.prepare("SELECT id FROM design_styles WHERE lower(name) = lower(?)").get(input.name) as { id: string } | undefined;
    const id = existing?.id ?? newId("dst");
    this.db
      .prepare(`INSERT INTO design_styles (id, name, notes, css, source_design_id, source_screen_id, created_at, updated_at)
        VALUES (@id, @name, @notes, @css, @designId, @screenId, @at, @at)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes, css = excluded.css,
          source_design_id = excluded.source_design_id, source_screen_id = excluded.source_screen_id, updated_at = excluded.updated_at`)
      .run({ id, name: input.name, notes: input.notes, css: input.css, designId: input.designId ?? null, screenId: input.screenId ?? null, at });
    return this.style(id)!;
  }

  deleteStyle(id: string): boolean {
    return this.db.prepare("DELETE FROM design_styles WHERE id = ?").run(id).changes > 0;
  }

  /** The design as the canvas shows it: rounds newest first, options in letter order. */
  view(id: string): DesignView | null {
    const row = this.get(id);
    if (!row) return null;
    const rounds = new Map<number, RoundView>();
    for (const meta of this.db.prepare("SELECT * FROM design_rounds WHERE design_id = ?").all(id) as RoundRow[])
      rounds.set(meta.round, { round: meta.round, title: meta.title, intro: meta.intro, screens: [] });
    for (const screen of this.screens(id)) {
      const round = rounds.get(screen.round) ?? { round: screen.round, title: "", intro: "", screens: [] };
      round.screens.push(toScreenView(screen));
      rounds.set(screen.round, round);
    }
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      threadId: row.thread_id,
      updatedAt: row.updated_at,
      rounds: [...rounds.values()].sort((a, b) => b.round - a.round),
      comments: this.comments(id).map((comment) => ({
        id: comment.id,
        screenId: comment.screen_id,
        step: comment.step,
        selector: comment.selector,
        elementText: comment.element_text,
        body: comment.body,
        createdAt: comment.created_at,
        sent: comment.sent_at !== null,
      })),
      review: null,
    };
  }

  /** Bumps the design's revision without other changes, e.g. when its comments change. */
  bump(id: string, by: Writer): number {
    return this.touch(id, by);
  }

  /**
   * Bumps the design's revision. Open canvases ignore revisions they've
   * already seen, so two writes in the same millisecond still differ.
   */
  private touch(id: string, by: Writer, name?: string): number {
    const current = this.get(id);
    if (!current) throw new Error(`Design ${id} not found`);
    const at = Math.max(this.now(), current.updated_at + 1);
    this.db.prepare("UPDATE designs SET name = COALESCE(?, name), updated_at = ?, updated_by = ? WHERE id = ?").run(name ?? null, at, writerKind(by), id);
    return at;
  }
}
