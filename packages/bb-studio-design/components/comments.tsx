// Comments pinned to elements of a design's screens, as in Claude Design.
// In comment mode the screens' own script (src/server/screen-script.ts)
// outlines the element under the pointer and reports the one clicked; the
// canvas answers with a popover to add the comment or send it to the agent.
// Open comments show as numbered pins on their elements.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { Icon, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { frameSize, frameKey, type CommentView, type DesignView } from "../src/shared";
import type { CanvasApi } from "./canvas";

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
      } else if (data.type === "text") {
        rpc.call("editText", { designId: design.id, screenId, before: data.before, after: data.text })
          .then((result) => {
            if (result.ok) return;
            // The live text no longer matches the source exactly once; reload the frame to undo the typing.
            toast.error({
              ambiguous: "That text appears more than once in the screen. Comment on it instead, and the agent will change it.",
              missing: "That text is drawn by the screen's script, so it can't be edited here. Comment on it instead.",
              markup: "Only text and simple formatting can be edited here. Comment on it instead.",
            }[result.reason ?? "missing"]);
            const frame = frames.current.get(key);
            if (frame) frame.src = frame.src;
          })
          .catch((error) => toast.error(errorMessage(error)));
      } else if (data.type === "not-editable") {
        toast.info("Only text can be edited here. Click a heading, label or paragraph, or comment on the element instead.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canvas, commenting, design.id, editing, frameBox, locate, rpc, send, toBoard]);

  // Every screen follows the mode; leaving comment mode drops an unsent draft.
  useEffect(() => {
    for (const key of frames.current.keys()) send(key, { type: "mode", on: commenting, edit: editing });
    if (!commenting) setDraft(null);
  }, [commenting, editing, send]);

  // Re-place pins when comments change.
  useEffect(() => {
    for (const key of frames.current.keys()) locate(key);
  }, [locate]);

  return { commenting, setCommenting, editing, setEditing, rects, register, draft, setDraft, open, setOpen };
}

/** Numbered pins over one screen, in the screen's own pixels (the canvas scales them with it). */
export function Pins({ comments, numbers, rects, onOpen }: {
  comments: CommentView[];
  numbers: Map<string, number>;
  rects: Record<string, Rect | null> | undefined;
  onOpen(id: string, pin: HTMLElement): void;
}) {
  return (
    <>
      {comments.map((comment) => {
        const rect = rects?.[comment.selector];
        if (!rect) return null;
        return (
          <button
            key={comment.id}
            type="button"
            title={comment.sent ? `Sent to the agent: ${comment.body}` : comment.body}
            aria-label={`Comment ${numbers.get(comment.id)}${comment.sent ? ", sent to the agent" : ""}: ${comment.body}`}
            onClick={(event) => onOpen(comment.id, event.currentTarget)}
            className={cn(
              "absolute z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none text-xl font-semibold shadow-lg ring-4",
              // Sent ones wait on the agent: hollow, until it resolves them.
              comment.sent ? "bg-white text-[#4f7cff] ring-[#4f7cff]" : "bg-[#4f7cff] text-white ring-white/70",
            )}
            style={{ left: rect.x + rect.width, top: Math.max(22, rect.y) }}
          >
            {numbers.get(comment.id)}
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

const POPOVER = "absolute z-30 w-80 rounded-lg border border-border bg-background p-3 text-sm text-foreground shadow-xl";

/** Keeps a popover inside the board. */
function place(anchor: Point, board: RefObject<HTMLDivElement | null>) {
  const width = board.current?.clientWidth ?? 0;
  return { left: Math.max(8, Math.min(anchor.x + 8, width - 328)), top: Math.max(56, anchor.y) };
}

export function DraftPopover({ design, draft, board, inThread, onClose }: { design: DesignView; draft: Pick; board: RefObject<HTMLDivElement | null>; inThread: boolean; onClose(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const sent = useSentToast(design.threadId, inThread);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const canSend = Boolean(design.threadId);

  async function submit(send: boolean) {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await rpc.call("addComment", { designId: design.id, screenId: draft.screenId, step: draft.step, selector: draft.selector, elementHtml: draft.html, elementText: draft.text, body: body.trim(), send });
      if (send) sent();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="New comment" className={POPOVER} style={place(draft.anchor, board)} onPointerDown={(event) => event.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{draft.screenId}{draft.step ? ` · ${draft.step}` : ""}</span>
        <span className="min-w-0 flex-1 truncate">{draft.text || draft.selector}</span>
        <button type="button" aria-label="Cancel" className="rounded p-0.5 hover:bg-state-hover" onClick={onClose}><Icon name="X" className="size-3.5" /></button>
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(canSend);
        }}
        placeholder="Describe the issue or suggestion…"
        rows={3}
        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 outline-none focus:border-ring"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" disabled={!body.trim() || busy} className="rounded-md border border-border px-2.5 py-1 hover:bg-state-hover disabled:opacity-50" onClick={() => void submit(false)}>
          Add comment
        </button>
        <button
          type="button"
          disabled={!body.trim() || busy || !canSend}
          title={canSend ? "Send to the design's conversation (⌘↩)" : "This design has no conversation yet. Start one with Chat first."}
          className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:opacity-90 disabled:opacity-50"
          onClick={() => void submit(true)}
        >
          Send to agent
        </button>
      </div>
    </div>
  );
}

export function CommentPopover({ design, comment, number, anchor, board, inThread, onClose }: {
  design: DesignView;
  comment: CommentView;
  number: number;
  anchor: Point;
  board: RefObject<HTMLDivElement | null>;
  inThread: boolean;
  onClose(): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const sent = useSentToast(design.threadId, inThread);
  const [busy, setBusy] = useState(false);
  async function act(work: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    try {
      await work();
      done?.();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-label={`Comment ${number}`} className={POPOVER} style={place(anchor, board)} onPointerDown={(event) => event.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-[#4f7cff] text-[11px] font-semibold text-white">{number}</span>
        <span className="font-medium text-foreground">{comment.screenId}{comment.step ? ` · ${comment.step}` : ""}</span>
        <span className="min-w-0 flex-1 truncate">{comment.elementText || comment.selector}</span>
        <button type="button" aria-label="Close" className="rounded p-0.5 hover:bg-state-hover" onClick={onClose}><Icon name="X" className="size-3.5" /></button>
      </div>
      <p className="whitespace-pre-wrap [text-wrap:pretty]">{comment.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={busy} aria-label="Delete comment" title="Delete" className="rounded-md p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={() => void act(() => rpc.call("deleteComment", { id: comment.id }))}>
          <Icon name="Trash2" className="size-4" />
        </button>
        <span className="flex-1 text-xs text-muted-foreground">
          {comment.sent ? (
            !inThread && design.threadId ? (
              <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => navigate.toThread(design.threadId!)}>Sent to the agent · Open chat</button>
            ) : "Sent to the agent"
          ) : ""}
        </span>
        {comment.sent ? null : (
          <button
            type="button"
            disabled={busy || !design.threadId}
            title={design.threadId ? "Send to the design's conversation" : "This design has no conversation yet. Start one with Chat first."}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-state-hover disabled:opacity-50"
            onClick={() => void act(() => rpc.call("sendComment", { id: comment.id }), sent)}
          >
            Send to agent
          </button>
        )}
        <button type="button" disabled={busy} className={cn("flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:opacity-90 disabled:opacity-50")} onClick={() => void act(() => rpc.call("resolveComment", { id: comment.id, resolved: true }))}>
          <Icon name="Check" className="size-3.5" /> Resolve
        </button>
      </div>
    </div>
  );
}
