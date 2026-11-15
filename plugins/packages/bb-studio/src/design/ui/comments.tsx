// Comments pinned to elements of a design's screens, as in Claude Design.
// In comment mode the screens' own script (src/server/screen-script.ts)
// outlines the element under the pointer and reports the one clicked; the
// comments panel opens a draft for it, sent to the agent when there is one.
// Open comments show as numbered pins on their elements.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { Icon, cn } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { frameSize, frameKey, type CommentView, type DesignView } from "../shared";
import type { CanvasApi } from "./canvas";
import { CommentAuthor } from "../../ui/comments/CommentAuthor";
import { CommentsPanel, type CommentThread } from "../../ui/comments/CommentsPanel";
import { createEditGate } from "./edit-gate";

export type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/** What the screen reported when the user clicked an element in comment mode. */
type Pick = { screenId: string; step: string; selector: string; html: string; text: string; anchor: Point };

type ScreenMessage =
  | { type: "ready" }
  | { type: "pick"; selector: string; html: string; text: string; rect: Rect }
  | { type: "rects"; rects: Record<string, Rect | null> }
  | { type: "wheel"; deltaX: number; deltaY: number; zoom: boolean; x: number; y: number }
  | { type: "space"; down: boolean }
  | { type: "edit-start"; before: string }
  | { type: "text"; before: string; text: string }
  | { type: "not-editable" };

/**
 * The comment layer's state for one board: the frames, comment mode, where
 * each comment's element is, and the open popover. It also relays the
 * gestures screens hand back to the canvas.
 * Frames are keyed by `frameKey(screenId, step)`: a splayed prototype has one per step.
 */
export function useComments(design: DesignView, board: RefObject<HTMLDivElement | null>, canvas: RefObject<CanvasApi | null>) {
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const rpc = useRpc<typeof rpcContract>();
  const [commenting, setCommentingState] = useState(false);
  /** Edit mode: click text on a screen to type over it. Comment and edit modes exclude each other. */
  const [editing, setEditingState] = useState(false);
  /** The edit the user started; a screen's script can't post one of its own. */
  const editGate = useRef(createEditGate());
  const setCommenting = useCallback((on: boolean) => { setCommentingState(on); if (on) setEditingState(false); }, []);
  const setEditing = useCallback((on: boolean) => { setEditingState(on); if (on) setCommentingState(false); }, []);
  /** Per frame: each commented selector's box, in the screen's own pixels. */
  const [rects, setRects] = useState<Record<string, Record<string, Rect | null>>>({});
  const [draft, setDraft] = useState<Pick | null>(null);
  const [open, setOpen] = useState<{ id: string; anchor: Point } | null>(null);

  const send = useCallback((key: string, message: Record<string, unknown>) => {
    frames.current.get(key)?.contentWindow?.postMessage({ bbDesign: true, ...message }, "*");
  }, []);

  /** Asks a frame where its commented elements are now. */
  const locate = useCallback((key: string) => {
    const selectors = [...new Set(design.comments.filter((comment) => frameKey(comment.screenId, comment.step) === key).map((comment) => comment.selector))];
    if (selectors.length) send(key, { type: "locate", selectors });
  }, [design.comments, send]);

  const register = useCallback((key: string) => (frame: HTMLIFrameElement | null) => {
    if (frame) frames.current.set(key, frame);
    else frames.current.delete(key);
  }, []);

  /** A frame's page box and its scale (frame pixels to page pixels). */
  const frameBox = useCallback((key: string) => {
    const frame = frames.current.get(key);
    const screen = design.rounds.flatMap((round) => round.screens).find((each) => each.id === key.split("#")[0]);
    if (!frame || !screen) return null;
    const box = frame.getBoundingClientRect();
    return { box, scale: box.width / frameSize(screen.viewport).width };
  }, [design.rounds]);

  /** A point inside a frame (screen pixels) in the board's coordinates. */
  const toBoard = useCallback((key: string, point: Point): Point | null => {
    const frame = frameBox(key);
    const box = board.current?.getBoundingClientRect();
    if (!frame || !box) return null;
    return { x: frame.box.left - box.left + point.x * frame.scale, y: frame.box.top - box.top + point.y * frame.scale };
  }, [board, frameBox]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as ({ bbDesign?: boolean } & ScreenMessage) | null;
      if (!data?.bbDesign) return;
      const key = [...frames.current].find(([, frame]) => frame.contentWindow === event.source)?.[0];
      if (!key) return;
      const [screenId = "", step = ""] = key.split("#");
      if (data.type === "ready") {
        send(key, { type: "mode", on: commenting, edit: editing });
        locate(key);
      } else if (data.type === "rects") {
        setRects((current) => ({ ...current, [key]: { ...current[key], ...data.rects } }));
      } else if (data.type === "pick") {
        const anchor = toBoard(key, { x: data.rect.x + data.rect.width, y: data.rect.y });
        if (!anchor) return;
        setOpen(null);
        setDraft({ screenId, step, selector: data.selector, html: data.html, text: data.text, anchor });
      } else if (data.type === "wheel") {
        const frame = frameBox(key);
        if (!frame) return;
        // Deltas and the point are in screen pixels; the canvas works in page pixels.
        canvas.current?.wheel({
          deltaX: data.deltaX * (data.zoom ? 1 : frame.scale),
          deltaY: data.deltaY * (data.zoom ? 1 : frame.scale),
          zoom: data.zoom,
          clientX: frame.box.left + data.x * frame.scale,
          clientY: frame.box.top + data.y * frame.scale,
        });
      } else if (data.type === "space") {
        canvas.current?.setSpace(data.down);
      } else if (data.type === "edit-start") {
        // The user's click in the frame activates the canvas too; a script alone can't.
        editGate.current.start(key, data.before, { editing, activated: navigator.userActivation?.isActive ?? false });
      } else if (data.type === "text") {
        if (!editGate.current.take(key, data.before, editing)) return;
        rpc.call("designs.editText", { designId: design.id, screenId, before: data.before, after: data.text })
          .then((result) => {
            if (result.ok) return;
            // The live text no longer matches the source exactly once; reload the frame to undo the typing.
            toast.error({
              ambiguous: "That text appears more than once in the screen. Comment on it instead.",
              missing: "Couldn't find that text in the screen's source. Comment on it instead.",
              markup: "Only text and simple formatting can be edited here. Comment on it instead.",
            }[result.reason ?? "missing"]);
            const frame = frames.current.get(key);
            if (frame) frame.src = frame.src;
          })
          .catch((error) => toast.error(errorMessage(error)));
      } else if (data.type === "not-editable") {
        toast.info("Only text can be edited here. Comment on the element instead.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canvas, commenting, design.id, editing, frameBox, locate, rpc, send, toBoard]);

  // Every screen follows the mode; leaving comment mode drops an unsent draft.
  useEffect(() => {
    for (const key of frames.current.keys()) send(key, { type: "mode", on: commenting, edit: editing });
    if (!commenting) setDraft(null);
    if (!editing) editGate.current.reset();
  }, [commenting, editing, send]);

  // Re-place pins when comments change.
  useEffect(() => {
    for (const key of frames.current.keys()) locate(key);
  }, [locate]);

  return { commenting, setCommenting, editing, setEditing, rects, register, draft, setDraft, open, setOpen };
}

/** Numbered pins over one screen, in the screen's own pixels (the canvas scales them with it). */
export function Pins({ comments, numbers, rects, activeId, pulse, onOpen }: {
  comments: CommentView[];
  numbers: Map<string, number>;
  rects: Record<string, Rect | null> | undefined;
  activeId?: string | null;
  pulse?: number;
  onOpen(id: string, pin: HTMLElement): void;
}) {
  return (
    <>
      {comments.map((comment) => {
        const rect = rects?.[comment.selector];
        if (!rect) return null;
        const active = comment.id === activeId;
        return (
          <button
            key={comment.id}
            type="button"
            data-comment-pin={comment.id}
            data-active={active ? "true" : undefined}
            title={comment.sent ? `Sent to the agent: ${comment.body}` : comment.body}
            aria-label={`Comment ${numbers.get(comment.id)}${comment.sent ? ", sent to the agent" : ""}: ${comment.body}`}
            onClick={(event) => onOpen(comment.id, event.currentTarget)}
            className={cn(
              "absolute z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none text-xl font-semibold shadow-lg ring-4 transition-transform",
              comment.sent ? "bg-white text-[#4f7cff] ring-[#4f7cff]" : "bg-[#4f7cff] text-white ring-white/70",
              active && "z-20 scale-125 ring-[#facc15]",
            )}
            style={{ left: rect.x + rect.width, top: Math.max(22, rect.y) }}
          >
            {active && pulse ? <span key={pulse} aria-hidden className="absolute inset-0 rounded-full rounded-bl-none bg-[#facc15]/60 motion-safe:animate-ping [animation-iteration-count:2]" /> : null}
            <span className="relative">{numbers.get(comment.id)}</span>
          </button>
        );
      })}
    </>
  );
}

/** Confirms a send; off the conversation's own view, offers to open it. */
function useSentToast(threadId: string | null, inThread: boolean) {
  const navigate = useBbNavigate();
  return () => toast.success("Sent to the agent", !inThread && threadId ? { action: { label: "Open chat", onClick: () => navigate.toThread(threadId) } } : undefined);
}

export function DesignCommentsPanel({ design, draft, activeId, numbers, inThread, onSelect, onDraftDone, onClose }: {
  design: DesignView;
  draft: Pick | null;
  activeId: string | null;
  numbers: Map<string, number>;
  inThread: boolean;
  onSelect(id: string): void;
  onDraftDone(): void;
  onClose(): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const sent = useSentToast(design.threadId, inThread);
  const where = (comment: { screenId: string; step: string }) => `${comment.screenId}${comment.step ? ` · ${comment.step}` : ""}`;
  const threads: CommentThread[] = [
    ...design.comments.map((comment) => ({
      id: comment.id,
      quote: comment.elementText || comment.selector,
      resolved: false,
      messages: [{ id: comment.id, authorId: "user", text: comment.body, at: comment.createdAt }],
      note: `Pin ${numbers.get(comment.id) ?? ""} on ${where(comment)}${comment.sent ? " · Sent to the agent" : ""}`,
    })),
    ...(design.resolvedComments ?? []).map((comment) => ({
      id: comment.id,
      quote: comment.elementText || comment.selector,
      resolved: true,
      resolvedAt: comment.resolvedAt,
      messages: [{ id: comment.id, authorId: "user", text: comment.body, at: comment.createdAt }],
      note: `On ${where(comment)}${comment.sent ? " · Sent to the agent" : ""}`,
    })),
  ];
  const open = new Map(design.comments.map((comment) => [comment.id, comment]));
  const act = async (work: () => Promise<unknown>, done?: () => void) => {
    try { await work(); done?.(); }
    catch (error) { toast.error(errorMessage(error)); }
  };
  return (
    <CommentsPanel
      threads={threads}
      activeId={activeId}
      onSelect={onSelect}
      onClose={onClose}
      onResolve={async (id, resolved) => { await rpc.call("designs.resolveComment", { id, resolved }); }}
      Author={CommentAuthor}
      emptyHint="Choose Comment, then click an element on a screen."
      draft={draft ? {
        quote: `${draft.text || draft.selector}`,
        onCancel: onDraftDone,
        onSubmit: async (body) => {
          const send = Boolean(design.threadId);
          const result = await rpc.call("designs.addComment", { designId: design.id, screenId: draft.screenId, step: draft.step, selector: draft.selector, elementHtml: draft.html, elementText: draft.text, body, send });
          if (result.sent) sent();
          else if (send) toast.error("Saved the comment, but couldn't send it to the agent", { description: "Choose Send to agent on it to try again." });
          onDraftDone();
          onSelect(result.id);
        },
      } : null}
      actions={(thread) => {
        const comment = open.get(thread.id);
        return (
          <>
            <button type="button" aria-label="Delete comment" title="Delete" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => void act(() => rpc.call("designs.deleteComment", { id: thread.id }))}>
              <Icon name="Trash2" className="size-3.5" />
            </button>
            {comment && !comment.sent ? (
              <button
                type="button"
                disabled={!design.threadId}
                title={design.threadId ? undefined : "This design has no conversation yet. Start one with Chat first."}
                className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
                onClick={() => void act(() => rpc.call("designs.sendComment", { id: thread.id }), sent)}
              >
                Send to agent
              </button>
            ) : comment?.sent && !inThread && design.threadId ? (
              <button type="button" className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => navigate.toThread(design.threadId!)}>Open chat</button>
            ) : null}
          </>
        );
      }}
    />
  );
}

