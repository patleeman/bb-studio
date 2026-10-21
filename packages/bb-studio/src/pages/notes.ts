// Notes: "Expand to page" on a thread's composer turns the draft into a temp
// page beside the thread, for typing meeting notes with room to work.
//
// - A note is an ordinary page, tagged "Notes" in Studio, plus a row in
//   `page_notes` that links it to its thread. The row is the page's thread
//   metadata: the thread finds its open note through it after a reload.
// - The composer's text moves into the page, and the composer is cleared, so
//   there's one copy. The page is saved to BB as it's made.
// - Done: send it to the thread (the Markdown, or a link and "Summarize these
//   notes" when it's long), keep it as a titled page, or discard it. Sent and
//   kept notes stay in Notes as ordinary pages.
import type Database from "better-sqlite3";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { untitled } from "../kit/format";
import { actorColor } from "./actors";
import { HUMAN_USER_ID, pagePath, PLUGIN_ID } from "./constants";
import { readMarkdown } from "./doc";
import { rpcContract, SEND_INLINE_LIMIT, type NoteSendMode, type NoteState, type NoteView } from "./notes-contract";
import { truncate, type PagesService } from "./service";

/** Appended to Studio's MIGRATIONS (src/migrations.ts). */
export const PAGE_NOTES_TABLE = `CREATE TABLE page_notes (
     page_id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     state TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     resolved_at INTEGER
   );
   CREATE INDEX page_notes_thread ON page_notes (thread_id, state, created_at);`;

/** The Studio tag every note carries. */
export const NOTES_TAG = "Notes";
const NOTE_ICON = "📝";
const THREAD_TITLE_MAX = 60;

interface NoteRow {
  page_id: string;
  thread_id: string;
  state: NoteState;
  created_at: number;
  resolved_at: number | null;
}

/** "Notes · Oct 13, 2:05 PM · Weekly sync" (no thread part when the thread has no title). */
export function noteTitle(at: Date, threadTitle: string | null | undefined, timeZone?: string): string {
  let zone = timeZone;
  try {
    if (zone) new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = undefined;
  }
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) })
    .format(at)
    .replace(/[  ]/g, " ");
  const thread = threadTitle?.replace(/\s+/g, " ").trim();
  return ["Notes", when, thread ? truncate(thread, THREAD_TITLE_MAX) : null].filter(Boolean).join(" · ");
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const BLOCK_START = /^\s*(?:#{1,6}\s|>|```|~~~|\|)/;

/**
 * A composer draft as page Markdown. People type notes a line at a time, and
 * Markdown would run those lines into one paragraph, so each line stays its
 * own paragraph; list items stay one list, and fenced code is kept as typed.
 */
export function draftToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let previous: "list" | "text" | "blank" | "code" = "blank";
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence) {
      out.push(line);
      if (marker === fence) { fence = null; previous = "code"; }
      continue;
    }
    if (marker) {
      if (previous !== "blank") out.push("");
      out.push(line);
      fence = marker;
      continue;
    }
    if (!line.trim()) {
      if (previous !== "blank") out.push("");
      previous = "blank";
      continue;
    }
    const kind = LIST_ITEM.test(line) ? "list" : "text";
    // A list item's continuation and table rows stay on their own line; anything else starts a paragraph.
    const joined = (kind === "list" && previous === "list") || (/^\s*\|/.test(line) && /^\s*\|/.test(out[out.length - 1] ?? ""));
    if (previous !== "blank" && !joined) out.push("");
    out.push(line);
    previous = BLOCK_START.test(line) && kind !== "list" ? "text" : kind;
  }
  if (fence) out.push(fence);
  return `${out.join("\n").trim()}\n`.replace(/^\n$/, "");
}

export interface NotesDeps {
  db: Database.Database;
  service: PagesService;
  tags: {
    ensure(name: string): { id: string };
    apply(items: readonly { pluginId: string; id: string }[], add: readonly string[], remove: readonly string[]): void;
    forget(pluginId: string, ids: readonly string[]): void;
  };
  threads: {
    get(threadId: string): Promise<{ title?: string | null; projectId?: string | null }>;
    send(threadId: string, input: { text: string; agentOnly?: boolean }[]): Promise<void>;
  };
  /** Lists the note with its thread in Studio. Best effort. */
  linkThread?(pageId: string, threadId: string, state: NoteState): void;
  /** Tells open views a note changed. */
  publish?(pageId: string, threadId: string): void;
  now?(): number;
}

export class Notes {
  constructor(private readonly deps: NotesDeps) {}

  private get store() {
    return this.deps.service.store;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private row(pageId: string): NoteRow | null {
    return (this.deps.db.prepare("SELECT * FROM page_notes WHERE page_id = ?").get(pageId) as NoteRow | undefined) ?? null;
  }

  private markdown(pageId: string): string {
    return readMarkdown(this.deps.service.hub.open(pageId).doc);
  }

  private view(row: NoteRow): NoteView | null {
    const meta = this.store.meta(row.page_id);
    if (!meta) return null;
    return {
      pageId: row.page_id,
      threadId: row.thread_id,
      title: meta.title,
      state: row.state,
      href: pagePath(row.page_id),
      length: this.markdown(row.page_id).trim().length,
      createdAt: row.created_at,
      updatedAt: meta.updated_at,
    };
  }

  private changed(row: NoteRow): void {
    this.deps.publish?.(row.page_id, row.thread_id);
  }

  /** The note a page is, or null. A row whose page was deleted is dropped. */
  forPage(pageId: string): NoteView | null {
    const row = this.row(pageId);
    if (!row) return null;
    const view = this.view(row);
    if (!view) this.deps.db.prepare("DELETE FROM page_notes WHERE page_id = ?").run(pageId);
    return view;
  }

  /** The thread's open note: the newest one whose page still exists. */
  forThread(threadId: string): NoteView | null {
    const rows = this.deps.db
      .prepare("SELECT * FROM page_notes WHERE thread_id = ? AND state = 'open' ORDER BY created_at DESC")
      .all(threadId) as NoteRow[];
    for (const row of rows) {
      const view = this.forPage(row.page_id);
      if (view) return view;
    }
    return null;
  }

  /** Makes the thread's note from `text`, or adds `text` to the end of the open one. */
  async create(input: { threadId: string; text: string; timeZone?: string }): Promise<{ note: NoteView; appended: boolean }> {
    const markdown = draftToMarkdown(input.text);
    const open = this.forThread(input.threadId);
    if (open) {
      if (markdown.trim()) {
        const actor = { key: HUMAN_USER_ID, name: "You", color: actorColor(HUMAN_USER_ID) };
        this.deps.service.edit(open.pageId, [{ op: "append", markdown }], actor);
        this.deps.service.hub.flush(this.deps.service.hub.open(open.pageId));
      }
      const row = this.row(open.pageId)!;
      this.changed(row);
      return { note: this.view(row)!, appended: true };
    }
    const thread = await this.deps.threads.get(input.threadId);
    const at = this.now();
    const page = this.deps.service.createPage({
      projectId: thread.projectId ?? null,
      parentId: null,
      title: noteTitle(new Date(at), thread.title, input.timeZone),
      icon: NOTE_ICON,
      markdown,
      actor: HUMAN_USER_ID,
    });
    const row: NoteRow = { page_id: page.id, thread_id: input.threadId, state: "open", created_at: at, resolved_at: null };
    this.deps.db
      .prepare("INSERT INTO page_notes (page_id, thread_id, state, created_at, resolved_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.page_id, row.thread_id, row.state, row.created_at, row.resolved_at);
    try {
      this.deps.tags.apply([{ pluginId: PLUGIN_ID, id: page.id }], [this.deps.tags.ensure(NOTES_TAG).id], []);
    } catch {
      // The note works untagged.
    }
    this.deps.linkThread?.(page.id, input.threadId, "open");
    this.changed(row);
    return { note: this.view(row)!, appended: false };
  }

  private requireOpen(pageId: string): NoteRow {
    const row = this.row(pageId);
    if (!row || !this.store.meta(pageId)) throw new Error("This note no longer exists.");
    if (row.state !== "open") throw new Error(`This note was already ${row.state === "sent" ? "sent" : "kept"}.`);
    return row;
  }

  private resolve(row: NoteRow, state: Exclude<NoteState, "open">): NoteView {
    this.deps.db.prepare("UPDATE page_notes SET state = ?, resolved_at = ? WHERE page_id = ?").run(state, this.now(), row.page_id);
    const next = this.row(row.page_id)!;
    this.deps.linkThread?.(row.page_id, row.thread_id, state);
    this.changed(next);
    return this.view(next)!;
  }

  /** Sends the note to its thread; `auto` sends the Markdown up to SEND_INLINE_LIMIT characters, else a link and a request to summarize. */
  async send(pageId: string, mode: "auto" | NoteSendMode = "auto"): Promise<{ note: NoteView; sent: NoteSendMode }> {
    const row = this.requireOpen(pageId);
    const meta = this.store.meta(pageId)!;
    const markdown = this.markdown(pageId).trim();
    if (!markdown) throw new Error("The note is empty. Write something first, or discard it.");
    const sent: NoteSendMode = mode === "auto" ? (markdown.length <= SEND_INLINE_LIMIT ? "content" : "summarize") : mode;
    const title = untitled(meta.title);
    if (sent === "content") {
      await this.deps.threads.send(row.thread_id, [{ text: markdown }]);
    } else {
      await this.deps.threads.send(row.thread_id, [
        { text: `Summarize these notes: [${title}](${pagePath(pageId)})` },
        {
          agentOnly: true,
          text: [
            `[Pages] The user's notes are the BB Page "${title}" (id ${pageId}, ${pagePath(pageId)}). Current content:`,
            "",
            truncate(markdown, 40_000),
            "",
            "Use pages_read for the full page.",
          ].join("\n"),
        },
      ]);
    }
    return { note: this.resolve(row, "sent"), sent };
  }

  /** Keeps the note as an ordinary page titled `title`; it stays in Notes. */
  keep(pageId: string, title: string): NoteView {
    const row = this.requireOpen(pageId);
    const meta = this.store.update(pageId, { title: title.trim() }, HUMAN_USER_ID);
    this.deps.service.publish({ type: "tree", projectId: meta?.project_id ?? null });
    return this.resolve(row, "kept");
  }

  /** Deletes an open note's page. */
  discard(pageId: string): boolean {
    const row = this.requireOpen(pageId);
    const ids = this.deps.service.deletePage(pageId);
    this.deps.db.prepare("DELETE FROM page_notes WHERE page_id = ?").run(pageId);
    try {
      this.deps.tags.forget(PLUGIN_ID, ids);
    } catch {
      // Studio prunes tags of items its providers stop listing.
    }
    this.changed(row);
    return true;
  }
}

/** Registers `notes.*` on Studio. */
export function registerNotes(bb: BbPluginApi, deps: Omit<NotesDeps, "threads">): Notes {
  const notes = new Notes({
    ...deps,
    threads: {
      get: async (threadId) => {
        const thread = await bb.sdk.threads.get({ threadId });
        return { title: thread.title, projectId: thread.projectId };
      },
      send: async (threadId, input) => {
        await bb.sdk.threads.send({
          threadId,
          mode: "queue-if-active",
          input: input.map((part) => ({ type: "text" as const, text: part.text, mentions: [], ...(part.agentOnly ? { visibility: "agent-only" as const } : {}) })),
        });
      },
    },
  });
  bb.rpc.register(rpcContract, {
    "notes.create": (input) => notes.create(input),
    "notes.forThread": ({ threadId }) => ({ note: notes.forThread(threadId) }),
    "notes.forPage": ({ pageId }) => ({ note: notes.forPage(pageId) }),
    "notes.send": ({ pageId, mode }) => notes.send(pageId, mode),
    "notes.keep": ({ pageId, title }) => ({ note: notes.keep(pageId, title) }),
    "notes.discard": ({ pageId }) => ({ ok: notes.discard(pageId) }),
  });
  return notes;
}
