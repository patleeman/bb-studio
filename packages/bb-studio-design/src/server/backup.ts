// Designs in a BB Studio backup (`bb studio backup` / `bb studio restore`).
//
// Section layout (version 1):
//   items/<fileSafeId(designId)>.json            the design row, its rounds, screen metadata and comments
//   files/<fileSafeId(designId)>/screens/<id>.html  each screen's HTML, kept out of the JSON
//
// Restore is keyed by the original ids: a design is created, replaced when the
// backup is newer, or left alone when the copy here is the same age or newer.
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, type BackupHandlers, type BackupReader, type BackupWriter } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import { z } from "zod";
import { SCREEN_ID, VIEWPORT_NAMES, type Viewport } from "../shared";
import type { CommentRow, DesignRow, DesignStore, ScreenRow } from "./store";

export const DESIGN_BACKUP_VERSION = 1;
/** Matches the cap on agent-written screens, with room for older, larger ones. */
const MAX_SCREEN_CHARS = 1_000_000;

export const BACKUP_NOTES = [
  "Each design's conversation (its BB thread) isn't saved: threads don't move between BBs. A restored design starts without one.",
  "Review status isn't saved: it only lives in memory while a reviewer runs.",
];

const time = z.number().int().min(0);
const text = (max: number) => z.string().max(max);

const itemSchema = z.object({
  id: z.string().min(1).max(200),
  name: text(500),
  projectId: z.string().min(1).max(200).nullable(),
  createdAt: time,
  updatedAt: time,
  updatedBy: z.enum(["user", "agent"]).nullable(),
  archivedAt: time.nullable(),
  template: z.boolean(),
  rounds: z.array(z.object({ round: z.number().int().min(1).max(999), title: text(2000), intro: text(20_000) })).max(1000),
  screens: z.array(z.object({
    id: z.string().regex(SCREEN_ID),
    title: text(2000),
    caption: text(20_000),
    viewport: z.enum(VIEWPORT_NAMES),
    createdAt: time,
    updatedAt: time,
  })).max(26_000),
  comments: z.array(z.object({
    id: z.string().min(1).max(200),
    screenId: z.string().regex(SCREEN_ID),
    step: text(100),
    selector: text(4000),
    elementHtml: text(10_000),
    elementText: text(1000),
    body: text(10_000),
    createdAt: time,
    sentAt: time.nullable(),
    resolvedAt: time.nullable(),
  })).max(10_000),
});

export type DesignBackupItem = z.infer<typeof itemSchema>;

type RoundRow = { design_id: string; round: number; title: string; intro: string };

export type DesignBackupDeps = {
  db: Database.Database;
  store: DesignStore;
  /** Tells Studio and open canvases a design changed; called after a real restore. */
  changed?(id: string, updatedAt: number): void;
};

const screenFile = (designId: string, screenId: string) => `files/${fileSafeId(designId)}/screens/${screenId}.html`;

export function designBackupHandlers(deps: DesignBackupDeps): BackupHandlers {
  const { db, store } = deps;
  const rounds = (designId: string) => db.prepare("SELECT * FROM design_rounds WHERE design_id = ? ORDER BY round ASC").all(designId) as RoundRow[];

  return {
    version: DESIGN_BACKUP_VERSION,

    async backup(writer: BackupWriter) {
      const counts = { designs: 0, rounds: 0, screens: 0, comments: 0 };
      for (const row of store.list({ includeArchived: true })) {
        // One design's screens in memory at a time.
        const screens = store.screens(row.id);
        const comments = store.comments(row.id, { includeResolved: true });
        const roundRows = rounds(row.id);
        const item: DesignBackupItem = {
          id: row.id,
          name: row.name,
          projectId: row.project_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by === "user" || row.updated_by === "agent" ? row.updated_by : null,
          archivedAt: row.archived_at,
          template: Boolean(row.template),
          rounds: roundRows.map(({ round, title, intro }) => ({ round, title, intro })),
          screens: screens.map((screen) => ({
            id: screen.id,
            title: screen.title,
            caption: screen.caption,
            viewport: (VIEWPORT_NAMES as string[]).includes(screen.viewport) ? (screen.viewport as Viewport) : "desktop",
            createdAt: screen.created_at,
            updatedAt: screen.updated_at,
          })),
          comments: comments.map((comment) => ({
            id: comment.id,
            screenId: comment.screen_id,
            step: comment.step,
            selector: comment.selector,
            elementHtml: comment.element_html,
            elementText: comment.element_text,
            body: comment.body,
            createdAt: comment.created_at,
            sentAt: comment.sent_at,
            resolvedAt: comment.resolved_at,
          })),
        };
        for (const screen of screens) await writer.bytesAt(screenFile(row.id, screen.id), Buffer.from(screen.html, "utf8"));
        await writer.json(`items/${fileSafeId(row.id)}.json`, item);
        counts.designs += 1;
        counts.rounds += roundRows.length;
        counts.screens += screens.length;
        counts.comments += comments.length;
      }
      return { counts, notes: BACKUP_NOTES };
    },

    async restore(reader: BackupReader, { dryRun, projects, tally }) {
      for (const note of BACKUP_NOTES) tally.note(note);
      type Planned = { item: DesignBackupItem; projectId: string | null; html: Map<string, string> };
      const planned: Planned[] = [];

      // Read and check everything first; only designs that will be written keep their HTML.
      for (const name of await reader.list("items")) {
        if (!name.endsWith(".json")) continue;
        const fallback = { id: name.slice(0, -5), title: null };
        let item: DesignBackupItem;
        try {
          const parsed = itemSchema.safeParse(await reader.json(`items/${name}`));
          if (!parsed.success) throw new Error(`Not a valid design: ${parsed.error.issues[0]?.path.join(".") || "item"}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          item = parsed.data;
          if (`${fileSafeId(item.id)}.json` !== name) throw new Error("Its id doesn't match its file name.");
          checkUnique(item);
        } catch (error) {
          tally.record("failed", fallback, reason(error));
          continue;
        }
        const label = { id: item.id, title: item.name };
        const decision = restoreDecision(store.get(item.id)?.updated_at ?? null, item.updatedAt);
        if (decision === "unchanged" || decision === "keep") {
          tally.decided(decision, label);
          continue;
        }
        let html: Map<string, string>;
        try {
          html = await readScreens(reader, item);
        } catch (error) {
          tally.record("failed", label, reason(error));
          continue;
        }
        const mapped = mapProject(projects, item.projectId);
        if (mapped.unmapped) tally.unmapped(label);
        tally.decided(decision, label);
        if (!dryRun) planned.push({ item, projectId: mapped.projectId, html });
      }

      if (dryRun || !planned.length) return;
      const written: Array<{ id: string; updatedAt: number }> = [];
      db.transaction(() => {
        for (const { item, projectId, html } of planned) {
          // Re-checked here: the design may have changed while files were read.
          const local = store.get(item.id);
          if (local && local.updated_at >= item.updatedAt) continue;
          writeDesign(db, item, projectId, html, local);
          written.push({ id: item.id, updatedAt: item.updatedAt });
        }
      })();
      for (const { id, updatedAt } of written) deps.changed?.(id, updatedAt);
    },
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkUnique(item: DesignBackupItem): void {
  const dup = (values: Array<string | number>, what: string) => {
    if (new Set(values).size !== values.length) throw new Error(`It lists the same ${what} twice.`);
  };
  dup(item.rounds.map((round) => round.round), "round");
  dup(item.screens.map((screen) => screen.id), "screen");
  dup(item.comments.map((comment) => comment.id), "comment");
}

async function readScreens(reader: BackupReader, item: DesignBackupItem): Promise<Map<string, string>> {
  const html = new Map<string, string>();
  for (const screen of item.screens) {
    const rel = screenFile(item.id, screen.id);
    if (!(await reader.exists(rel))) throw new Error(`Screen ${screen.id}'s HTML is missing from the backup.`);
    if ((await reader.size(rel)) > MAX_SCREEN_CHARS * 4) throw new Error(`Screen ${screen.id} is too large to restore.`);
    const body = (await reader.bytes(rel)).toString("utf8");
    if (body.length > MAX_SCREEN_CHARS) throw new Error(`Screen ${screen.id} is too large to restore.`);
    html.set(screen.id, body);
  }
  return html;
}

/** Creates the design or replaces it and its rounds, screens and comments with the backup's. */
function writeDesign(db: Database.Database, item: DesignBackupItem, projectId: string | null, html: Map<string, string>, local: DesignRow | null): void {
  const row = {
    id: item.id,
    name: item.name,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    project_id: projectId,
    updated_by: item.updatedBy,
    archived_at: item.archivedAt,
    template: item.template ? 1 : 0,
  };
  if (local) {
    // The local conversation stays: the backup's thread isn't on this BB.
    db.prepare(`UPDATE designs SET name = @name, created_at = @created_at, updated_at = @updated_at, project_id = @project_id,
      updated_by = @updated_by, archived_at = @archived_at, template = @template WHERE id = @id`).run(row);
  } else {
    db.prepare(`INSERT INTO designs (id, name, created_at, updated_at, project_id, updated_by, archived_at, template, thread_id)
      VALUES (@id, @name, @created_at, @updated_at, @project_id, @updated_by, @archived_at, @template, NULL)`).run(row);
  }

  db.prepare("DELETE FROM design_rounds WHERE design_id = ?").run(item.id);
  const round = db.prepare("INSERT INTO design_rounds (design_id, round, title, intro) VALUES (?, ?, ?, ?)");
  for (const meta of item.rounds) round.run(item.id, meta.round, meta.title, meta.intro);

  db.prepare("DELETE FROM design_screens WHERE design_id = ?").run(item.id);
  const screen = db.prepare(`INSERT INTO design_screens (design_id, id, round, title, caption, viewport, html, created_at, updated_at)
    VALUES (@design_id, @id, @round, @title, @caption, @viewport, @html, @created_at, @updated_at)`);
  for (const meta of item.screens) {
    const values: ScreenRow = {
      design_id: item.id,
      id: meta.id,
      round: Number(SCREEN_ID.exec(meta.id)![1]),
      title: meta.title,
      caption: meta.caption,
      viewport: meta.viewport,
      html: html.get(meta.id) ?? "",
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
    };
    screen.run(values);
  }

  // Comments are keyed by their own ids; one that belongs to another design here is left alone.
  const keep = new Set(item.comments.map((comment) => comment.id));
  const existing = db.prepare("SELECT id FROM design_comments WHERE design_id = ?").all(item.id) as Array<{ id: string }>;
  const remove = db.prepare("DELETE FROM design_comments WHERE id = ?");
  for (const { id } of existing) if (!keep.has(id)) remove.run(id);
  const comment = db.prepare(`INSERT INTO design_comments (id, design_id, screen_id, step, selector, element_html, element_text, body, created_at, sent_at, resolved_at)
    VALUES (@id, @design_id, @screen_id, @step, @selector, @element_html, @element_text, @body, @created_at, @sent_at, @resolved_at)
    ON CONFLICT(id) DO UPDATE SET screen_id = excluded.screen_id, step = excluded.step, selector = excluded.selector,
      element_html = excluded.element_html, element_text = excluded.element_text, body = excluded.body,
      created_at = excluded.created_at, sent_at = excluded.sent_at, resolved_at = excluded.resolved_at
    WHERE design_comments.design_id = excluded.design_id`);
  for (const meta of item.comments) {
    const values: CommentRow = {
      id: meta.id,
      design_id: item.id,
      screen_id: meta.screenId,
      step: meta.step,
      selector: meta.selector,
      element_html: meta.elementHtml,
      element_text: meta.elementText,
      body: meta.body,
      created_at: meta.createdAt,
      sent_at: meta.sentAt,
      resolved_at: meta.resolvedAt,
    };
    comment.run(values);
  }
}
