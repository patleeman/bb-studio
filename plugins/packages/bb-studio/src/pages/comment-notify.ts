import * as Y from "yjs";
import { untitled } from "../kit/format";
import { listThreads } from "./comments";
import { HUMAN_USER_ID, pagePath } from "./constants";
import { THREADS_MAP } from "./schema-config";

export interface UserComment {
  threadId: string;
  commentId: string;
  reply: boolean;
  quote: string;
  blockId: string | null;
  text: string;
}

function commentIds(doc: Y.Doc): string[] {
  return listThreads(doc, { includeResolved: true }).flatMap((thread) => thread.comments.map((comment) => comment.id));
}

export function watchUserComments(doc: Y.Doc, onComments: (comments: UserComment[]) => void, delayMs = 1000): () => void {
  const seen = new Set(commentIds(doc));
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const comments: UserComment[] = [];
    for (const thread of listThreads(doc, { includeResolved: true })) {
      thread.comments.forEach((comment, index) => {
        if (!pending.has(comment.id) || comment.author !== HUMAN_USER_ID || !comment.text.trim()) return;
        comments.push({ threadId: thread.id, commentId: comment.id, reply: index > 0, quote: thread.quote, blockId: thread.blockId, text: comment.text });
      });
    }
    pending.clear();
    if (comments.length) onComments(comments);
  };

  const observer = (_events: unknown, transaction: Y.Transaction) => {
    const fromUser = typeof transaction.origin !== "string";
    for (const id of commentIds(doc)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (fromUser) pending.add(id);
    }
    if (!pending.size) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };

  const threads = doc.getMap(THREADS_MAP);
  threads.observeDeep(observer);
  return () => {
    threads.unobserveDeep(observer);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`);

export function userCommentMessage(page: { id: string; title: string }, comments: UserComment[]): string {
  const lines = [
    `The user ${comments.length === 1 ? "left a comment" : `left ${comments.length} comments`} on the page "${untitled(page.title)}" (id ${page.id}, ${pagePath(page.id)}):`,
  ];
  for (const comment of comments) {
    lines.push("", `${comment.reply ? "Reply in" : "New"} thread ${comment.threadId}${comment.quote ? ` on "${comment.quote.length > 200 ? `${comment.quote.slice(0, 199)}…` : comment.quote}"` : ""}:`, ...quoted(comment.text));
  }
  lines.push("", "Answer in the same thread with pages_comment_reply. If it asks for a change, make it with pages_edit (pages_read shows the block ids), then resolve the thread with pages_comment_resolve.");
  return lines.join("\n");
}
