import type { BlockNoteEditor } from "@blocknote/core";
import { CommentsExtension, type ThreadData } from "@blocknote/core/comments";
import type { YjsThreadStore } from "@blocknote/core/yjs";
import { useBlockNoteEditor, useComponentsContext, useEditorState, useExtension, useExtensionState } from "@blocknote/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../kit/ui/index";
import { CommentAuthor } from "../../ui/comments/CommentAuthor";
import { CommentsPanel, type CommentThread } from "../../ui/comments/CommentsPanel";
import { THREADS_MAP } from "../schema-config";
import type { PageConnection } from "./connection";
import { pageFieldLabel } from "./talk";
import { snapPositions } from "../word-snap";

type Draft = { from: number; to: number; quote: string };

const StartComment = createContext<() => void>(() => {});

export function PageCommentButton() {
  const components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const start = useContext(StartComment);
  const toolbar = useExtension("formattingToolbar") as unknown as { store: { setState(open: boolean): void } };
  const empty = useEditorState({ editor, selector: ({ editor: current }) => current.prosemirrorState.selection.empty });
  if (empty || !editor.isEditable) return null;
  return (
    <components.FormattingToolbar.Button
      className="bn-button"
      label="Comment"
      mainTooltip="Comment"
      icon={<Icon name="MessageSquare" className="size-4" />}
      onClick={() => {
        start();
        toolbar.store.setState(false);
      }}
    />
  );
}

export function textOfBody(body: unknown): string {
  if (!Array.isArray(body)) return typeof body === "string" ? body : "";
  const lines: string[] = [];
  const walk = (blocks: { content?: unknown; children?: unknown[] }[]) => {
    for (const block of blocks) {
      if (Array.isArray(block.content)) {
        lines.push(block.content.map((item: { text?: unknown; props?: { label?: unknown } }) => (typeof item.text === "string" ? item.text : typeof item.props?.label === "string" ? `@${item.props.label}` : "")).join(""));
      } else if (typeof block.content === "string") lines.push(block.content);
      if (Array.isArray(block.children) && block.children.length) walk(block.children as never);
    }
  };
  walk(body as never);
  return lines.join("\n").trim();
}

export function commentBody(text: string): unknown[] {
  return text.split("\n").map((line) => ({
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: line ? [{ type: "text", text: line, styles: {} }] : [],
    children: [],
  }));
}

const time = (value: Date | number | undefined) => (value instanceof Date ? value.getTime() : Number(value ?? 0));

export function threadViews(threads: Iterable<ThreadData>, deleted: (id: string) => boolean, quoteOf: (id: string) => { quote: string; at: number | null }): CommentThread[] {
  return [...threads]
    .filter((thread) => !deleted(thread.id) && !thread.deletedAt)
    .map((thread) => {
      const anchor = quoteOf(thread.id);
      return {
        view: {
          id: thread.id,
          quote: anchor.quote,
          resolved: thread.resolved,
          resolvedBy: thread.resolved ? thread.resolvedBy ?? null : null,
          resolvedAt: thread.resolved && thread.resolvedUpdatedAt ? time(thread.resolvedUpdatedAt) : null,
          messages: thread.comments
            .filter((comment) => !comment.deletedAt)
            .map((comment) => ({ id: comment.id, authorId: comment.userId, text: textOfBody(comment.body), at: time(comment.createdAt) })),
        } satisfies CommentThread,
        at: anchor.at,
        created: time(thread.createdAt),
      };
    })
    .filter((each) => each.view.messages.length > 0)
    .sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER) || a.created - b.created)
    .map((each) => each.view);
}

function scrollToPosition(editor: BlockNoteEditor<any, any, any>, from: number) {
  try {
    const found = editor.prosemirrorView?.domAtPos(from).node;
    const element = found instanceof HTMLElement ? found : found?.parentElement;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    return;
  }
}

export function usePageComments({ editor, threadStore, connection, open, onOpenChange, pageTitle }: {
  editor: BlockNoteEditor<any, any, any>;
  threadStore: YjsThreadStore;
  connection: PageConnection;
  open: boolean;
  onOpenChange(open: boolean): void;
  pageTitle: string;
}) {
  const comments = editor.getExtension(CommentsExtension)!;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pulse, setPulse] = useState(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const versionRef = useRef(0);
  const version = useSyncExternalStore(
    useCallback((onChange: () => void) => threadStore.subscribe(() => { versionRef.current += 1; onChange(); }), [threadStore]),
    () => versionRef.current,
  );
  const positions = useExtensionState(CommentsExtension, { editor, selector: (state) => state.threadPositions });
  const selected = useExtensionState(CommentsExtension, { editor, selector: (state) => state.selectedThreadId }) ?? null;

  useEffect(() => {
    if (selected) onOpenChange(true);
  }, [selected, onOpenChange]);

  const threads = useMemo(() => {
    const raw = connection.doc.getMap(THREADS_MAP);
    const deleted = (id: string) => Boolean((raw.get(id) as { get(key: string): unknown } | undefined)?.get("deletedAt"));
    const doc = editor.prosemirrorState.doc;
    return threadViews(threadStore.getThreads().values(), deleted, (id) => {
      const position = positions.get(id);
      if (!position) return { quote: "", at: null };
      try {
        const shown = snapPositions(doc, position.from, position.to);
        return { quote: doc.textBetween(shown.from, shown.to, " "), at: position.from };
      }
      catch { return { quote: "", at: position.from }; }
    });
  }, [version, threadStore, positions, connection, editor]);

  const startDraft = useCallback(() => {
    const { selection, doc } = editor.prosemirrorState;
    if (selection.empty) return;
    const { from, to } = snapPositions(doc, selection.from, selection.to);
    const quote = doc.textBetween(from, to, " ");
    if (from !== selection.from || to !== selection.to) editor._tiptapEditor.commands.setTextSelection({ from, to });
    comments.startPendingComment();
    setDraft({ from, to, quote });
    onOpenChange(true);
  }, [comments, editor, onOpenChange]);

  const cancelDraft = useCallback(() => {
    comments.stopPendingComment();
    setDraft(null);
  }, [comments]);

  const select = useCallback((id: string) => {
    comments.selectThread(id, false);
    const position = comments.store.state.threadPositions.get(id);
    if (position) scrollToPosition(editor, position.from);
    setPulse((count) => count + 1);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(0), 1200);
  }, [comments, editor]);

  const panel = open ? (
    <CommentsPanel
      threads={threads}
      activeId={selected}
      onSelect={select}
      onClose={() => { cancelDraft(); comments.selectThread(undefined, false); onOpenChange(false); }}
      onResolve={async (id, resolved) => { await (resolved ? threadStore.resolveThread({ threadId: id }) : threadStore.unresolveThread({ threadId: id })); }}
      onReply={async (id, text) => { await threadStore.addComment({ threadId: id, comment: { body: commentBody(text) } }); }}
      draft={draft ? {
        quote: draft.quote,
        onCancel: cancelDraft,
        onSubmit: async (text) => {
          const before = new Set(threadStore.getThreads().keys());
          editor._tiptapEditor.chain().setTextSelection({ from: draft.from, to: draft.to }).run();
          await comments.createThread({ initialComment: { body: commentBody(text) } });
          comments.stopPendingComment();
          setDraft(null);
          const created = [...threadStore.getThreads().keys()].find((id) => !before.has(id));
          if (created) comments.selectThread(created, false);
        },
      } : null}
      Author={CommentAuthor}
      emptyHint="Select text in the page and choose Comment."
      dictationLabel={`Comment on ${pageFieldLabel(pageTitle)}`}
      className="max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:h-[75%] max-md:w-auto max-md:border-t max-md:border-l-0"
    />
  ) : null;

  return { startDraft, panel, pulse: pulse > 0 };
}

export function CommentsPortal({ slot, children }: { slot: HTMLElement | null; children: React.ReactNode }) {
  return slot && children ? createPortal(children, slot) : null;
}

export function StartCommentProvider({ start, children }: { start: () => void; children: React.ReactNode }) {
  return <StartComment.Provider value={start}>{children}</StartComment.Provider>;
}
