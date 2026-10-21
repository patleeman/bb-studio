// Review comments: the user comments on lines in VS Code (the bridge's
// comment controller), the comments wait as a draft review, and Submit sends
// them to the agent in one message, like a code review. The agent answers in
// the comment threads (code_comment_reply) and can resolve them; the bridge
// shows replies as they come.
//
// A thread is its first comment (parent_id null) and the replies under it.
// Each comment is pending until submitted, then sent; a thread is open until
// resolved. Comments keep the text of the lines they're on, so the editor can
// find the lines again after edits above them move them.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { z } from "zod";

export { COMMENT_MIGRATIONS } from "@bb-studio/kit/code-migrations";

/** The longest comment, and the most of its lines a comment keeps. */
const MAX_BODY = 20_000;
const MAX_LINE_TEXT = 4_000;

export type CommentAuthor = "user" | "agent";

export interface ReviewComment {
  id: string;
  author: CommentAuthor;
  body: string;
  pending: boolean;
  createdAt: number;
}

/** A comment thread on lines of a file. Lines are 1-based. */
export interface ReviewThread {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  lineText: string;
  resolved: boolean;
  comments: ReviewComment[];
}

type Row = {
  id: string; workspace_id: string; parent_id: string | null; path: string; start_line: number; end_line: number;
  line_text: string; author: CommentAuthor; body: string; sent_to: string | null; sent_at: number | null;
  resolved_at: number | null; created_at: number;
};

/** What the bridge extension may ask for. */
export const commentCallSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("list") }),
  z.object({
    method: z.literal("add"),
    path: z.string().min(1).max(4096),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    lineText: z.string().max(200_000),
    body: z.string().trim().min(1).max(MAX_BODY),
  }),
  z.object({ method: z.literal("reply"), threadId: z.string().min(1).max(100), body: z.string().trim().min(1).max(MAX_BODY) }),
  z.object({ method: z.literal("edit"), commentId: z.string().min(1).max(100), body: z.string().trim().min(1).max(MAX_BODY) }),
  z.object({ method: z.literal("delete"), commentId: z.string().min(1).max(100) }),
  z.object({ method: z.literal("resolve"), threadId: z.string().min(1).max(100), resolved: z.boolean() }),
  z.object({ method: z.literal("submit") }),
]);
export type CommentCall = z.infer<typeof commentCallSchema>;

export class CommentStore {
  constructor(private readonly db: Database.Database) {}

  /** A workspace's comment threads, oldest first. */
  threads(workspaceId: string): ReviewThread[] {
    const rows = this.db.prepare("SELECT * FROM code_comments WHERE workspace_id = ? ORDER BY created_at, rowid").all(workspaceId) as Row[];
    const threads = new Map<string, ReviewThread>();
    for (const row of rows.filter((each) => !each.parent_id)) {
      threads.set(row.id, { id: row.id, path: row.path, startLine: row.start_line, endLine: row.end_line, lineText: row.line_text, resolved: row.resolved_at !== null, comments: [comment(row)] });
    }
    for (const row of rows.filter((each) => each.parent_id)) threads.get(row.parent_id!)?.comments.push(comment(row));
    return [...threads.values()];
  }

  thread(threadId: string): (ReviewThread & { workspaceId: string; sentTo: string | null }) | null {
    const row = this.db.prepare("SELECT * FROM code_comments WHERE id = ? AND parent_id IS NULL").get(threadId) as Row | undefined;
    if (!row) return null;
    const found = this.threads(row.workspace_id).find((each) => each.id === threadId);
    return found ? { ...found, workspaceId: row.workspace_id, sentTo: row.sent_to } : null;
  }

  /** Starts a thread with the user's comment, pending. */
  add(workspaceId: string, input: { path: string; startLine: number; endLine: number; lineText: string; body: string }): string {
    const id = newId("ccm");
    const end = Math.max(input.endLine, input.startLine);
    this.db.prepare("INSERT INTO code_comments (id, workspace_id, parent_id, path, start_line, end_line, line_text, author, body, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, 'user', ?, ?)")
      .run(id, workspaceId, input.path, input.startLine, end, input.lineText.slice(0, MAX_LINE_TEXT), input.body, Date.now());
    return id;
  }

  /** A reply in a thread: the user's waits for Submit, the agent's is sent as it's written. Reopens a resolved thread. */
  reply(threadId: string, author: CommentAuthor, body: string, sentTo: string | null = null): string {
    const root = this.root(threadId);
    const id = newId("ccm");
    const now = Date.now();
    this.db.prepare("INSERT INTO code_comments (id, workspace_id, parent_id, path, start_line, end_line, line_text, author, body, sent_to, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)")
      .run(id, root.workspace_id, root.id, root.path, root.start_line, root.end_line, author, body.slice(0, MAX_BODY), author === "agent" ? sentTo : null, author === "agent" ? now : null, now);
    this.db.prepare("UPDATE code_comments SET resolved_at = NULL WHERE id = ?").run(root.id);
    return id;
  }

  /** The user changes their own comment while it's pending. */
  edit(workspaceId: string, commentId: string, body: string): void {
    const row = this.mine(workspaceId, commentId);
    this.db.prepare("UPDATE code_comments SET body = ? WHERE id = ?").run(body, row.id);
  }

  /** The user deletes their pending comment; a thread's first comment takes the thread with it. */
  delete(workspaceId: string, commentId: string): void {
    const row = this.mine(workspaceId, commentId);
    if (row.parent_id) this.db.prepare("DELETE FROM code_comments WHERE id = ?").run(row.id);
    else this.db.prepare("DELETE FROM code_comments WHERE id = ? OR parent_id = ?").run(row.id, row.id);
  }

  resolve(threadId: string, resolved: boolean): void {
    this.root(threadId);
    this.db.prepare("UPDATE code_comments SET resolved_at = ? WHERE id = ?").run(resolved ? Date.now() : null, threadId);
  }

  /** The user's comments waiting for Submit, with the thread each is in. */
  pending(workspaceId: string): { thread: ReviewThread; comment: ReviewComment }[] {
    return this.threads(workspaceId).flatMap((thread) => thread.comments.filter((each) => each.pending).map((each) => ({ thread, comment: each })));
  }

  /** Marks a workspace's pending comments sent to a thread. */
  markSent(workspaceId: string, threadId: string): void {
    this.db.prepare("UPDATE code_comments SET sent_to = ?, sent_at = ? WHERE workspace_id = ? AND author = 'user' AND sent_at IS NULL").run(threadId, Date.now(), workspaceId);
  }

  /** Open threads that were sent to an agent's thread: what code_comments lists. */
  openFor(agentThreadId: string): (ReviewThread & { workspaceId: string })[] {
    const roots = this.db.prepare("SELECT DISTINCT workspace_id FROM code_comments WHERE sent_to = ?").all(agentThreadId) as { workspace_id: string }[];
    return roots.flatMap(({ workspace_id }) => this.threads(workspace_id)
      .filter((thread) => !thread.resolved && this.sentTo(thread.id) === agentThreadId)
      .map((thread) => ({ ...thread, workspaceId: workspace_id })));
  }

  private sentTo(threadId: string): string | null {
    const rows = this.db.prepare("SELECT sent_to FROM code_comments WHERE (id = ? OR parent_id = ?) AND sent_to IS NOT NULL ORDER BY sent_at DESC LIMIT 1").get(threadId, threadId) as { sent_to: string } | undefined;
    return rows?.sent_to ?? null;
  }

  private root(threadId: string): Row {
    const row = this.db.prepare("SELECT * FROM code_comments WHERE id = ? AND parent_id IS NULL").get(threadId) as Row | undefined;
    if (!row) throw new Error("That comment thread is gone.");
    return row;
  }

  private mine(workspaceId: string, commentId: string): Row {
    const row = this.db.prepare("SELECT * FROM code_comments WHERE id = ? AND workspace_id = ?").get(commentId, workspaceId) as Row | undefined;
    if (!row) throw new Error("That comment is gone.");
    if (row.author !== "user" || row.sent_at !== null) throw new Error("Only your comments that haven't been submitted can change.");
    return row;
  }
}

function comment(row: Row): ReviewComment {
  return { id: row.id, author: row.author, body: row.body, pending: row.author === "user" && row.sent_at === null, createdAt: row.created_at };
}

const lines = (start: number, end: number) => (start === end ? `${start}` : `${start}–${end}`);

function fenced(text: string, language: string): string {
  const fence = text.includes("```") ? "````" : "```";
  return `${fence}${language}\n${text}\n${fence}`;
}

/** The language fence for a path: its extension, which most highlighters know. */
function languageOf(path: string): string {
  const ext = path.split("/").pop()?.split(".").slice(1).pop() ?? "";
  return /^[a-z0-9+#-]{1,10}$/i.test(ext) ? ext.toLowerCase() : "";
}

/**
 * The message a review sends: each new comment with its file, lines and code,
 * replies with the thread they're in. `shown` turns a path into the one the
 * user knows (relative to its workspace folder).
 */
export function reviewMessage(input: {
  workspace: string;
  items: { thread: ReviewThread; comment: ReviewComment }[];
  shown: (path: string) => string;
}): string {
  const byThread = new Map<string, { thread: ReviewThread; comments: ReviewComment[] }>();
  for (const { thread, comment } of input.items) {
    const entry = byThread.get(thread.id) ?? { thread, comments: [] };
    entry.comments.push(comment);
    byThread.set(thread.id, entry);
  }
  const count = input.items.length;
  const parts = [...byThread.values()].map(({ thread, comments }, index) => {
    const where = `${input.shown(thread.path)}:${lines(thread.startLine, thread.endLine)}`;
    const first = comments[0]!.id === thread.comments[0]!.id;
    const earlier = first ? [] : thread.comments.filter((each) => !each.pending).map((each) => `> ${each.author === "agent" ? "You" : "User"}: ${each.body.replace(/\n/g, "\n> ")}`);
    return [
      `### ${index + 1}. ${where} (comment thread ${thread.id})${first ? "" : ", a reply"}`,
      thread.lineText.trim() ? fenced(thread.lineText, languageOf(thread.path)) : "",
      ...earlier,
      ...comments.map((each) => each.body),
    ].filter(Boolean).join("\n\n");
  });
  return [
    `Code review from VS Code ("${input.workspace}"): ${count} ${count === 1 ? "comment" : "comments"}.`,
    ...parts,
    "Work through each one. Answer in its thread with code_comment_reply (the comment thread id above), saying what you changed or why not, and resolve it there when it's done. code_comments lists the open ones.",
  ].join("\n\n");
}

/** One open thread, for code_comments. */
export function describeThread(thread: ReviewThread, shown: (path: string) => string): string {
  const head = `${thread.id}\t${shown(thread.path)}:${lines(thread.startLine, thread.endLine)}`;
  // The user's draft replies stay theirs until they submit them.
  const talk = thread.comments.filter((each) => !each.pending).map((each) => `  ${each.author === "agent" ? "You" : "User"}: ${each.body.replace(/\n/g, "\n    ")}`);
  return [head, ...talk].join("\n");
}
