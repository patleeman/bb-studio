import { DefaultThreadStoreAuth, type ThreadData } from "@blocknote/core/comments";
import { YjsThreadStore } from "@blocknote/core/yjs";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { addCommentMark, commentAnchors } from "./doc";
import { markdownToBlocks, plainText, type InlineContent, type PageBlock } from "./markdown";
import { THREADS_MAP } from "./schema-config";

// Comment threads live in the page's Y.Doc (BlockNote's YjsThreadStore format),
// so they sync to open editors like any other edit. Comment bodies are
// BlockNote blocks from the comment editor; agents read and write them as
// plain text.

export interface CommentView {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface ThreadView {
  id: string;
  resolved: boolean;
  blockId: string | null;
  quote: string;
  comments: CommentView[];
  updatedAt: number;
}

function store(doc: Y.Doc, userId: string): YjsThreadStore {
  return new YjsThreadStore(userId, doc.getMap(THREADS_MAP), new DefaultThreadStoreAuth(userId, "editor"));
}

export function bodyText(body: unknown): string {
  if (!Array.isArray(body)) return typeof body === "string" ? body : "";
  const lines: string[] = [];
  const walk = (blocks: PageBlock[]) => {
    for (const block of blocks) {
      if (Array.isArray(block.content)) lines.push(plainText(block.content as InlineContent[]));
      if (block.children?.length) walk(block.children);
    }
  };
  walk(body as PageBlock[]);
  return lines.join("\n").trim();
}

/** Comment bodies use the comment editor's default schema: plain paragraphs. */
export function textBody(text: string): unknown[] {
  const blocks = markdownToBlocks(text);
  const paragraphs = (blocks.length ? blocks : [{ type: "paragraph", content: [] }]).map((block) => ({
    id: randomUUID(),
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: (Array.isArray(block.content) ? block.content : []).map((item) =>
      item.type === "mention" ? { type: "text", text: `@${item.props.label}`, styles: {} } : item,
    ),
    children: [],
  }));
  return paragraphs;
}

const time = (value: Date | number | undefined) => (value instanceof Date ? value.getTime() : Number(value ?? 0));

export function listThreads(doc: Y.Doc, options: { includeResolved?: boolean } = {}): ThreadView[] {
  const anchors = commentAnchors(doc);
  const threads = [...store(doc, "reader").getThreads().values()] as ThreadData[];
  return threads
    .filter((thread) => !thread.deletedAt && (options.includeResolved || !thread.resolved))
    .map((thread) => {
      const anchor = anchors.get(thread.id);
      return {
        id: thread.id,
        resolved: thread.resolved,
        blockId: anchor?.blockId ?? null,
        quote: anchor?.text ?? "",
        comments: thread.comments
          .filter((comment) => !comment.deletedAt)
          .map((comment) => ({
            id: comment.id,
            author: comment.userId,
            text: bodyText(comment.body),
            createdAt: time(comment.createdAt),
          })),
        updatedAt: time(thread.updatedAt),
      };
    })
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

export function getThread(doc: Y.Doc, threadId: string): ThreadView | null {
  return listThreads(doc, { includeResolved: true }).find((thread) => thread.id === threadId) ?? null;
}

export async function createThread(
  doc: Y.Doc,
  author: string,
  input: { block: string; quote?: string; text: string },
  origin: string,
): Promise<{ threadId: string; blockId: string }> {
  let pending: Promise<ThreadData> | null = null;
  // The store writes synchronously; the outer transaction tags it with origin.
  doc.transact(() => {
    pending = store(doc, author).createThread({ initialComment: { body: textBody(input.text) } });
  }, origin);
  const threadId = (await pending!).id;
  try {
    return { threadId, blockId: addCommentMark(doc, input.block, threadId, input.quote, origin) };
  } catch (error) {
    doc.transact(() => void store(doc, author).deleteThread({ threadId }), origin);
    throw error;
  }
}

export function reply(doc: Y.Doc, author: string, threadId: string, text: string, origin: string): void {
  requireThread(doc, threadId);
  doc.transact(() => void store(doc, author).addComment({ threadId, comment: { body: textBody(text) } }), origin);
}

export function setResolved(doc: Y.Doc, author: string, threadId: string, resolved: boolean, origin: string): void {
  requireThread(doc, threadId);
  doc.transact(() => {
    const threads = store(doc, author);
    void (resolved ? threads.resolveThread({ threadId }) : threads.unresolveThread({ threadId }));
  }, origin);
}

function requireThread(doc: Y.Doc, threadId: string): void {
  if (!doc.getMap(THREADS_MAP).has(threadId)) throw new Error(`No comment thread "${threadId}" on this page.`);
}

/** Raw thread data for change detection (comment ids and authors). */
export function threadAuthors(doc: Y.Doc): Map<string, { resolved: boolean; comments: { id: string; author: string; text: string }[] }> {
  const out = new Map<string, { resolved: boolean; comments: { id: string; author: string; text: string }[] }>();
  for (const thread of store(doc, "reader").getThreads().values() as Iterable<ThreadData>) {
    if (thread.deletedAt) continue;
    out.set(thread.id, {
      resolved: thread.resolved,
      comments: thread.comments
        .filter((comment) => !comment.deletedAt)
        .map((comment) => ({ id: comment.id, author: comment.userId, text: bodyText(comment.body) })),
    });
  }
  return out;
}
