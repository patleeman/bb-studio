// The canvas page: /plugins/studio-visual-chat/canvas/<threadId>, or /canvas for a
// new one. A full-window board under a header (top-bar.tsx), and the chat
// at the bottom: the agent's latest caption over a composer drawn like BB's
// (a rounded box with the field, the model, the dictation mic, the
// hands-free button and send). Loaded on demand by app.tsx.
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn, errorMessage, HANDSFREE_START_EVENT, Icon, INSERT_EVENT, STATE_EVENT, TOGGLE_EVENT, useWidgetTheme } from "./studio";
import type { canvasContract } from "../contract";
import { CANVAS_NEW_SEGMENT, CANVAS_DEFAULT_EXECUTION, CANVAS_LIMITS, type CanvasExecution, type CanvasItem, type CanvasMeta, type CanvasTurn, type CanvasVersion, type CanvasVersionMeta, type CanvasView } from "../shared";
import { DEFAULT_LOOK, isLook, type Look, type OrganicLook } from "../looks";
import { Board } from "./board";
import { useBbTheme } from "./bb-theme";
import { lookCss } from "./board-css";
import { ModelPicker } from "./model-picker";
import { CanvasNavContext } from "./nav";
import { OrganicBoard, type BoardItem } from "./organic-board";
import { PageFrame, type EmbedServices } from "./page-frame";
import { CardHeader, useCardSteps, type CardSteps } from "./quick-header";
import { TopBar } from "./top-bar";
import { useCanvas } from "./use-canvas";

export { CanvasNavContext, type CanvasNav } from "./nav";

const decode = (segment: string) => {
  try { return decodeURIComponent(segment); } catch { return ""; }
};

/**
 * The style a new canvas shows until its agent picks one (the agent
 * chooses each board's style; looks.ts). ?look=<style> overrides it, for
 * tests and captures.
 */
function startLook(): OrganicLook {
  try {
    const query = new URLSearchParams(window.location.search).get("look");
    return query && isLook(query) && query !== "classic" ? query : DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}

/**
 * A reference board, shown in place of the canvas's own (for design
 * comparisons): a window event, so only the page's own scripts (a capture
 * driving it) can show one; nothing in a URL can. detail null puts the
 * canvas's own board back. Items may carry fixed: {x, y, w} (shares of the
 * board) to be placed by hand.
 */
export const PREVIEW_EVENT = "bb-studio-canvas:preview";
interface Preview { look: OrganicLook; title: string; caption: string | null; items: BoardItem[] }
function usePreview(enabled = true): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const on = (event: Event) => {
      const detail = (event as CustomEvent).detail as { look?: unknown; title?: unknown; caption?: unknown; items?: unknown } | null;
      if (!detail || !Array.isArray(detail.items)) { setPreview(null); return; }
      const items = (detail.items as Partial<BoardItem>[]).filter((item) => item && typeof item.id === "string" && typeof item.kind === "string").map((item, index): BoardItem => ({
        title: null, data: null, options: {}, html: null, size: "m", importance: 3, rev: 1, createdAt: index + 1, updatedAt: index + 1,
        ...(item as Partial<CanvasItem>), id: item.id!, kind: item.kind!, fixed: item.fixed ?? null,
      } as BoardItem));
      setPreview({ look: isLook(detail.look) && detail.look !== "classic" ? detail.look : DEFAULT_LOOK, title: typeof detail.title === "string" ? detail.title : "Reference", caption: typeof detail.caption === "string" ? detail.caption : null, items });
    };
    window.addEventListener(PREVIEW_EVENT, on);
    return () => window.removeEventListener(PREVIEW_EVENT, on);
  }, [enabled]);
  return preview;
}

/** The canvas this window had open last: the rail opens the bare root, which reopens it. */
const LAST_KEY = "bb-studio-canvas:last";
const readLast = () => { try { return window.localStorage.getItem(LAST_KEY); } catch { return null; } };
const writeLast = (threadId: string) => { try { window.localStorage.setItem(LAST_KEY, threadId); } catch { /* storage off */ } };

export default function CanvasRoute({ rest }: { rest: string }) {
  const segment = decode(rest.split("/")[0] ?? "");
  if (!segment) return <ResumeLast />;
  const threadId = segment === CANVAS_NEW_SEGMENT ? null : segment;
  return <CanvasPage key={threadId ?? "new"} threadId={threadId} />;
}

/**
 * Coming back to Canvas: reopen the last canvas (its board as it is now, a
 * board still being made included, since the turn runs on the server), else
 * the most recent one, else a new canvas.
 */
function ResumeLast() {
  const rpc = useRpc<typeof canvasContract>();
  const nav = useContext(CanvasNavContext);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const last = readLast();
      try {
        if (last && (await rpc.call("canvas.get", { threadId: last })).canvas) {
          if (live) nav.open(last, { replace: true });
          return;
        }
        const { canvases } = await rpc.call("canvas.list", null);
        const latest = [...(canvases as CanvasMeta[])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) { if (live) nav.open(latest.threadId, { replace: true }); return; }
      } catch { /* fall through to a new canvas */ }
      if (live) setFresh(true);
    })();
    return () => { live = false; };
  }, [rpc, nav]);
  return fresh ? <CanvasPage key="new" threadId={null} /> : null;
}

/** The composer field stops growing here and scrolls. */
const COMPOSER_MAX_HEIGHT = 168;

const FAINT_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** Whether Talk is dictating into this field right now (fields.ts publishes it on <html>). */
function useDictating(field: string): boolean {
  const read = () => typeof document !== "undefined" && document.documentElement.dataset.bbTalk === "dictating" && document.documentElement.dataset.bbTalkField === field;
  const [on, setOn] = useState(read);
  useEffect(() => {
    const update = () => setOn(read());
    window.addEventListener(STATE_EVENT, update);
    return () => window.removeEventListener(STATE_EVENT, update);
  }, [field]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}

/** What the quick card (quick-card.tsx) gives the canvas it shows. */
export interface CardProps {
  /** Follow a chat in the card: the one its first message made, another it steps to, or null for a new one. */
  onThread(threadId: string | null): void;
  onClose(): void;
  onExpand(): void;
  /** The header is the card's drag handle. */
  onDragStart(event: ReactPointerEvent<HTMLElement>): void;
  /** The id the card's dialog is labelled by (the header's title). */
  titleId: string;
}

/** A canvas: the full page, or in the quick card (`card`), with a compact header and chat line and the same board. */
export function CanvasPage({ threadId, card }: { threadId: string | null; card?: CardProps }) {
  const rpc = useRpc<typeof canvasContract>();
  const theme = useWidgetTheme();
  // BB's theme tokens, live: the board's ground, text, rules and cards, under the style's accent layer.
  const bb = useBbTheme();
  const { canvas: own, stream: liveStream, send, reload } = useCanvas(threadId);
  // Webpage parts: the server checks each URL (canvas.webpage); Open hands it to BB's openUrl when clicked.
  const navigate = useBbNavigate();
  const nav = useContext(CanvasNavContext);
  const embedServices = useMemo<EmbedServices>(() => ({
    webpage: (url) => (threadId ? rpc.call("canvas.webpage", { threadId, url }) : Promise.reject(new Error("No canvas yet."))),
    openUrl: (url) => { navigate.openUrl(url); },
  }), [rpc, threadId, navigate]);
  // Remember the open canvas, so coming back to Canvas reopens it (the card's chats don't change what the page reopens).
  useEffect(() => { if (!card && threadId && own) writeLast(threadId); }, [card, threadId, own]);
  const preview = usePreview(!card);
  const timeline = useTimeline(threadId, own);
  // A canvas made or moved (after a provider switch): the page goes to its address, the card follows it.
  const onThread = card?.onThread;
  const follow = useCallback((next: string) => {
    if (onThread) onThread(next);
    else nav.open(next, { replace: true });
  }, [onThread, nav]);
  const steps = useCardSteps(card ? threadId : undefined, own, timeline, onThread);
  const snap = timeline.snapshot;
  const canvas = useMemo(() => {
    if (preview && own) return { ...own, look: preview.look, title: preview.title, caption: preview.caption, page: null, items: preview.items, status: "idle" as const };
    // An old version: its board, style, title and caption (the live board comes back at the latest).
    if (own && snap) return { ...own, look: snap.look, title: snap.title || own.title, caption: snap.caption, page: snap.page, items: snap.board };
    return own;
  }, [own, preview, snap]);
  const [pending, setPending] = useState<string | null>(null);
  const [chatHeight, setChatHeight] = useState(0);
  const [newLook] = useState<OrganicLook>(startLook);
  const [draft, setDraft] = useState<CanvasExecution>(CANVAS_DEFAULT_EXECUTION);
  // The page the agent is writing shows on the live board only (not a preview or an old version).
  const stream = !preview && !snap ? liveStream : null;
  // A board written as a page always has a style (a canvas from before styles takes the default).
  const look: Look = canvas ? ((canvas.page || stream) && canvas.look === "classic" ? DEFAULT_LOOK : canvas.look) : threadId ? "classic" : newLook;
  const css = useMemo(() => (look === "classic" ? null : lookCss(look, bb)), [look, bb]);

  const submit = useCallback(async (text: string) => {
    if (!threadId) {
      setPending(text);
      try {
        const created = await rpc.call("canvas.create", { text, look: newLook, providerId: draft.providerId, model: draft.model, ...(draft.reasoningLevel ? { reasoningLevel: draft.reasoningLevel } : {}) });
        follow(created.threadId);
      } catch (error) {
        setPending(null);
        toast.error(errorMessage(error));
        throw error;
      }
      return;
    }
    try {
      const now = await send(text, timeline.viewing);
      timeline.toLatest();
      // After a provider switch the canvas has a fresh thread: follow it (the old address still finds the canvas).
      if (now !== threadId) follow(now);
    } catch (error) { toast.error(errorMessage(error)); throw error; }
  }, [rpc, send, threadId, newLook, draft, timeline, follow]);

  // Hands-free can be the first input: on a new canvas it creates the canvas (on the picked model) first.
  const voice = useCallback(async () => {
    let target = threadId;
    if (!target) {
      try {
        const created = await rpc.call("canvas.create", { voice: true, look: newLook, providerId: draft.providerId, model: draft.model, ...(draft.reasoningLevel ? { reasoningLevel: draft.reasoningLevel } : {}) });
        target = created.threadId;
        follow(target);
      } catch (error) {
        toast.error(errorMessage(error));
        return;
      }
    }
    window.dispatchEvent(new CustomEvent(HANDSFREE_START_EVENT, { detail: { threadId: target } }));
  }, [rpc, threadId, newLook, draft, follow]);

  const items = canvas?.items ?? [];
  const page = canvas?.page ?? null;
  const working = canvas?.status === "working" || !!pending;
  return (
    <div className={cn("canvas-page relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", css && "cv-scope")} data-canvas-page data-canvas-preview={preview ? "" : undefined} data-canvas-status={canvas?.status ?? (pending ? "working" : "new")} data-canvas-rev={canvas?.rev ?? 0} data-cv-look={look} data-cv-mode={bb.mode}>
      {css ? <style>{css}</style> : null}
      {card ? (
        <CardHeader canvas={canvas ?? null} pending={pending} steps={steps} titleId={card.titleId} onExpand={card.onExpand} onClose={card.onClose} onDragStart={card.onDragStart} />
      ) : (
        <TopBar canvas={canvas ?? null} />
      )}
      {/* The board ends where the chat block starts, by its measured height: nothing ever draws under the caption. */}
      <div className={cn("canvas-scroll min-h-0 flex-1 overflow-x-hidden", page ? "overflow-hidden" : card ? "overflow-y-auto px-4 pt-1" : "overflow-y-auto px-8 pt-2")} style={{ marginBottom: chatHeight }} data-canvas-scroll>
        {canvas === undefined ? null : (page || stream) && look !== "classic" ? (
          <PageFrame html={page} stream={stream?.html ?? null} streamN={stream?.n ?? 0} rev={canvas?.rev ?? 0} look={look} mode={bb.mode} title={canvas?.title ?? "Visual Chat"} services={embedServices} />
        ) : look !== "classic" ? (
          <OrganicBoard
            key={preview ? "preview" : "board"}
            items={items}
            look={look}
            mode={bb.mode}
            bottomPad={24}
            empty={<p className="max-w-sm text-center text-[15px] leading-relaxed" style={{ color: "var(--cv-muted)", fontFamily: "var(--cv-font-text)" }}>{working ? "Thinking it through…" : "Ask anything."}</p>}
          />
        ) : (
          <Board
            items={items}
            theme={theme}
            bottomPad={24}
            empty={<p className="max-w-sm text-center text-[15px] leading-relaxed text-muted-foreground/70">{working ? "Thinking it through…" : "Ask anything."}</p>}
          />
        )}
      </div>
      <ChatLine threadId={threadId} canvas={canvas ?? null} pending={pending} working={working} timeline={timeline} steps={card ? steps : null} onSubmit={submit} onVoice={voice} onHeight={setChatHeight}
        model={!card && (canvas || !threadId) ? <ModelPicker canvas={canvas ?? null} onChanged={() => void reload()} draft={draft} onDraft={setDraft} placement="above-start" /> : null} />
    </div>
  );
}

/** Where a timeline position points: a version's n, or null for the live board (always the last position). */
export function timelinePositions(versions: readonly Pick<CanvasVersionMeta, "n" | "rev">[], liveRev: number, working: boolean, viewing: number | null) {
  const last = versions.at(-1);
  // While a turn works, its board isn't a version yet: the live board is one more position after the last version.
  const liveExtra = !last || (working && last.rev !== liveRev);
  const total = versions.length + (liveExtra ? 1 : 0);
  const at = viewing === null ? -1 : versions.findIndex((version) => version.n === viewing);
  const position = at >= 0 && at < total - 1 ? at + 1 : total;
  const target = (p: number): number | null => (p >= total ? null : versions[p - 1]?.n ?? null);
  return { total, position, target };
}

/** Paging back and forward through the canvas's versions: which one is showing, and its board once fetched. */
function useTimeline(threadId: string | null, canvas: CanvasView | null | undefined) {
  const rpc = useRpc<typeof canvasContract>();
  const [viewing, setViewing] = useState<number | null>(null);
  const [boards, setBoards] = useState<Map<number, CanvasVersion>>(() => new Map());
  const started = useRef<string | null>(null);
  // Open where the user left it (the server remembers), once per canvas.
  useEffect(() => {
    if (!canvas || !threadId || started.current === threadId) return;
    started.current = threadId;
    setBoards(new Map());
    setViewing(canvas.viewing ?? null);
  }, [canvas, threadId]);
  const versions = canvas?.versions ?? [];
  const { total, position, target } = timelinePositions(versions, canvas?.rev ?? 0, canvas?.status === "working", viewing);
  const shown = position < total ? viewing : null;
  useEffect(() => {
    if (!threadId || shown === null || boards.has(shown)) return;
    let live = true;
    rpc.call("canvas.version", { threadId, n: shown }).then(({ version }) => {
      if (live && version) setBoards((map) => new Map(map).set(version.n, version as CanvasVersion));
    }, () => {});
    return () => { live = false; };
  }, [rpc, threadId, shown, boards]);
  const go = useCallback((p: number) => {
    if (!threadId || p < 1 || p > total) return;
    const n = target(p);
    setViewing(n);
    rpc.call("canvas.view", { threadId, n }).catch(() => {});
  }, [rpc, threadId, total, target]);
  const promptAt = (p: number) => (p >= 1 && p <= versions.length && p < total ? versions[p - 1]!.prompt : p === total ? (canvas?.history ?? []).filter((line) => line.role !== "agent").at(-1)?.text ?? null : null);
  return {
    viewing: shown,
    snapshot: shown === null ? null : boards.get(shown) ?? null,
    position, total,
    back: () => go(position - 1),
    forward: () => go(position + 1),
    toLatest: () => setViewing(null),
    promptAt,
  };
}
export type Timeline = ReturnType<typeof useTimeline>;

const ROLE: Record<string, string> = { user: "You", agent: "Visual Chat", voice: "Voice" };

function History({ lines }: { lines: readonly CanvasTurn[] }) {
  return (
    <div className="mb-2 max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-background/95 p-3 text-[13px] shadow-sm backdrop-blur" data-canvas-history>
      {lines.length ? lines.map((line) => (
        <p key={line.seq} className="mb-1.5 last:mb-0"><span className="mr-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{ROLE[line.role] ?? line.role}</span><span className="text-foreground/85">{line.text.length > 280 ? `${line.text.slice(0, 279)}…` : line.text}</span></p>
      )) : <p className="text-muted-foreground">Nothing yet.</p>}
    </div>
  );
}

/** The field key Talk dictates into: the card's is its own, so the page and the card never share one. */
export const fieldKey = (threadId: string | null, inCard: boolean) => `${inCard ? "canvas-quick" : "canvas"}:${threadId ?? "new"}`;

/**
 * The chat: the latest caption over a composer drawn like BB's own (a
 * rounded, bordered box with a multi-line field, a row of controls under it
 * and a round send button). Enter sends, Shift+Enter starts a new line.
 * `model` is the model control of that row. In the quick card (`steps`),
 * it's compact, the versions are in the card's header, and ← → step as its
 * ‹ › do, only for keys inside the card.
 */
export function ChatLine({ threadId, canvas, pending, working, timeline, steps, onSubmit, onVoice, onHeight, model = null }: { threadId: string | null; canvas: CanvasView | null; pending: string | null; working: boolean; timeline: Timeline; steps: CardSteps | null; onSubmit(text: string): Promise<void>; onVoice(): Promise<void>; onHeight(height: number): void; model?: ReactNode }) {
  const { voice = true } = useContext(CanvasNavContext);
  const [startingVoice, setStartingVoice] = useState(false);
  const startVoice = async () => {
    setStartingVoice(true);
    try { await onVoice(); } finally { setStartingVoice(false); }
  };
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const block = useRef<HTMLDivElement>(null);
  // The page reserves exactly this block's height for it, as it changes (a longer caption, the history peek).
  useLayoutEffect(() => {
    const element = block.current;
    if (!element) return;
    const report = () => onHeight(Math.ceil(element.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeight]);
  const inCard = steps !== null;
  const field = fieldKey(threadId, inCard);
  const dictating = useDictating(field);

  // Talk delivers dictation to the field, the form (src/talk/ui/fields.ts).
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    const onInsert = (event: Event) => {
      const inserted = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!inserted) return;
      event.preventDefault();
      setText((value) => (value.trim() ? `${value.trimEnd()} ${inserted}` : inserted));
      input.current?.focus();
    };
    element.addEventListener(INSERT_EVENT, onInsert);
    return () => element.removeEventListener(INSERT_EVENT, onInsert);
  }, []);

  // ← and → page through the versions while the field is empty (and nothing else has focus).
  // The card's keys stay in the card, and the page's never come from it.
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const inSomeCard = !!target?.closest?.("[data-canvas-card]");
      if (inCard ? !inSomeCard || !block.current?.closest("[data-canvas-card]")?.contains(target) : inSomeCard) return;
      const ours = target === input.current;
      if (ours ? textRef.current !== "" : target && target !== document.body && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      const go = steps ?? timeline;
      if (event.key === "ArrowLeft") go.back(); else go.forward();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline, steps, inCard]);

  // The field grows with its text, up to its max height (then it scrolls).
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    if (element.scrollHeight > 0) element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [text]);

  const deliver = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText("");
    try { await onSubmit(value); } catch { setText(value); } finally { setSending(false); input.current?.focus(); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void deliver();
  };

  const caption = pending ? null : canvas?.caption ?? null;
  const lastUser = pending ?? [...(canvas?.history ?? [])].reverse().find((line) => line.role === "user")?.text ?? null;
  return (
    <div ref={block} className={cn("canvas-chat pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-background", inCard ? "pb-3 pt-2" : "pb-5 pt-3")} data-canvas-chat>
      <div className={cn("pointer-events-auto w-full", inCard ? "px-4" : "max-w-2xl px-6")}>
        {history && canvas ? <History lines={canvas.history} /> : null}
        <div className="mb-1.5 min-h-[1.5rem] text-[15px] leading-snug" aria-live="polite" data-canvas-caption>
          {working ? (
            <p className="flex items-center gap-2 text-muted-foreground"><span className="canvas-pulse inline-block size-1.5 rounded-full bg-primary" aria-hidden />{lastUser ? <span className="truncate opacity-80">“{lastUser}”</span> : "Thinking…"}</p>
          ) : caption ? (
            <p className={cn(inCard ? "line-clamp-2 text-[14px]" : "line-clamp-3", "text-foreground/80")} title={inCard ? caption : undefined}>{caption}</p>
          ) : null}
        </div>
        <form ref={form} onSubmit={submit} className={cn("rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-foreground/25", inCard ? "px-2.5 pb-1.5 pt-2" : "px-3 pb-2 pt-2.5")} data-canvas-composer data-talk-field={field} data-talk-field-label={canvas ? `“${canvas.title}”` : "the new canvas"}>
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void deliver();
            }}
            maxLength={CANVAS_LIMITS.messageChars}
            placeholder={!threadId ? (inCard ? "Ask anything…" : "What should we look at?") : timeline.position < timeline.total ? `Continue from version ${timeline.position}…` : "Say what's next…"}
            aria-label="Message Visual Chat"
            className="block w-full resize-none bg-transparent px-0.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
            style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
            data-canvas-input
            autoFocus
          />
          <div className="mt-1 flex items-center gap-0.5 text-sm text-muted-foreground" data-canvas-composer-row>
            {model}
            {canvas && !inCard && timeline.total > 1 ? <Versions timeline={timeline} /> : null}
            <span className="min-w-0 flex-1" />
            {/* Talk shows its dictation controls here while dictating into this field, as in BB's composer (fields.ts). */}
            <span className="flex min-w-0 items-center" data-talk-field-dock />
            {canvas ? (
              <button type="button" className={cn(FAINT_BUTTON, history && "bg-foreground/5 text-foreground")} aria-label="History" title="History" aria-pressed={history} onClick={() => setHistory((value) => !value)}>
                <Icon name="Clock" className="size-4" />
              </button>
            ) : null}
            {voice ? (
              <>
                <button type="button" className={cn(FAINT_BUTTON, dictating && "bg-red-500/10 text-red-600 dark:text-red-400")} aria-label={dictating ? "Finish dictation" : "Dictate"} title={dictating ? "Finish dictation" : "Dictate"} aria-pressed={dictating}
                  onClick={() => input.current?.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { bubbles: true }))} data-canvas-voice>
                  <Icon name="Mic" className="size-4" />
                </button>
                <button type="button" className={FAINT_BUTTON} aria-label="Hands-free voice" title="Hands-free voice" disabled={startingVoice}
                  onClick={() => void startVoice()} data-canvas-handsfree data-canvas-voice>
                  <Icon name="studio/handsfree" className="size-4" />
                </button>
              </>
            ) : null}
            {/* BB's send button: 28px, round, the primary colour. */}
            <button type="submit" className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-35" aria-label="Send" title="Send" disabled={sending || text.trim() === ""} data-canvas-send>
              <Icon name="ArrowUp" className="size-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const quoted = (text: string | null) => (text ? `“${text.length > 120 ? `${text.slice(0, 119)}…` : text}”` : "");

/** ‹ 3 / 7 ›: the version showing, of the canvas's versions; hovering shows the message that led to each. */
function Versions({ timeline }: { timeline: Timeline }) {
  const { position, total } = timeline;
  const old = position < total;
  const step = "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  return (
    <span className="mr-0.5 flex shrink-0 items-center" data-canvas-versions data-position={position} data-total={total}>
      <button type="button" className={step} aria-label="Previous version" title={position > 1 ? `Version ${position - 1}: ${quoted(timeline.promptAt(position - 1))} (←)` : "Previous version"} disabled={position <= 1} onClick={timeline.back}>
        <Icon name="ChevronLeft" className="size-3.5" />
      </button>
      <span className={cn("min-w-[2.75rem] select-none text-center text-[12px] tabular-nums", old ? "font-medium text-foreground" : "text-muted-foreground/70")} title={`Version ${position} of ${total}${timeline.promptAt(position) ? `: ${quoted(timeline.promptAt(position))}` : ""}`} aria-live="polite" data-canvas-version-label>
        {position} / {total}
      </span>
      <button type="button" className={step} aria-label="Next version" title={position < total ? `Version ${position + 1}: ${quoted(timeline.promptAt(position + 1))} (→)` : "Next version"} disabled={position >= total} onClick={timeline.forward}>
        <Icon name="ChevronRight" className="size-3.5" />
      </button>
    </span>
  );
}
