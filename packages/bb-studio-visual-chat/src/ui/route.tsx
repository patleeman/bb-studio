// The canvas page: /plugins/studio-visual-chat/canvas/<threadId>, or /canvas for a
// new one. A full-window board, and the chat as one faint line at the
// bottom: the agent's latest caption, a text field, the dictation mic and
// the hands-free button. Loaded on demand by app.tsx.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn, errorMessage, HANDSFREE_START_EVENT, Icon, INSERT_EVENT, openAppPath, STATE_EVENT, TOGGLE_EVENT, useWidgetTheme } from "./studio";
import type { canvasContract } from "../contract";
import { canvasHref, canvasNewHref, CANVAS_NEW_SEGMENT, CANVAS_DEFAULT_EXECUTION, CANVAS_LIMITS, type CanvasExecution, type CanvasItem, type CanvasMeta, type CanvasTurn, type CanvasVersion, type CanvasVersionMeta, type CanvasView } from "../shared";
import { DEFAULT_LOOK, isLook, type Look, type OrganicLook } from "../looks";
import { Board } from "./board";
import { lookCss } from "./board-css";
import { ModelPicker } from "./model-picker";
import { OrganicBoard, type BoardItem } from "./organic-board";
import { PageFrame } from "./page-frame";
import { useCanvas } from "./use-canvas";

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
function usePreview(): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
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
  }, []);
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
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const last = readLast();
      try {
        if (last && (await rpc.call("canvas.get", { threadId: last })).canvas) {
          if (live) openAppPath(canvasHref(last), { replace: true });
          return;
        }
        const { canvases } = await rpc.call("canvas.list", null);
        const latest = [...(canvases as CanvasMeta[])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) { if (live) openAppPath(canvasHref(latest.threadId), { replace: true }); return; }
      } catch { /* fall through to a new canvas */ }
      if (live) setFresh(true);
    })();
    return () => { live = false; };
  }, [rpc]);
  return fresh ? <CanvasPage key="new" threadId={null} /> : null;
}

const FAINT_BUTTON = "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

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

function CanvasPage({ threadId }: { threadId: string | null }) {
  const rpc = useRpc<typeof canvasContract>();
  const theme = useWidgetTheme();
  const { canvas: own, stream: liveStream, send, reload } = useCanvas(threadId);
  // Remember the open canvas, so coming back to Canvas reopens it.
  useEffect(() => { if (threadId && own) writeLast(threadId); }, [threadId, own]);
  const preview = usePreview();
  const timeline = useTimeline(threadId, own);
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
  const css = useMemo(() => (look === "classic" ? null : lookCss(look)), [look]);

  const submit = useCallback(async (text: string) => {
    if (!threadId) {
      setPending(text);
      try {
        const created = await rpc.call("canvas.create", { text, look: newLook, providerId: draft.providerId, model: draft.model, ...(draft.reasoningLevel ? { reasoningLevel: draft.reasoningLevel } : {}) });
        openAppPath(canvasHref(created.threadId), { replace: true });
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
      if (now !== threadId) openAppPath(canvasHref(now), { replace: true });
    } catch (error) { toast.error(errorMessage(error)); throw error; }
  }, [rpc, send, threadId, newLook, draft, timeline]);

  // Hands-free can be the first input: on a new canvas it creates the canvas (on the picked model) first.
  const voice = useCallback(async () => {
    let target = threadId;
    if (!target) {
      try {
        const created = await rpc.call("canvas.create", { voice: true, look: newLook, providerId: draft.providerId, model: draft.model, ...(draft.reasoningLevel ? { reasoningLevel: draft.reasoningLevel } : {}) });
        target = created.threadId;
        openAppPath(canvasHref(target), { replace: true });
      } catch (error) {
        toast.error(errorMessage(error));
        return;
      }
    }
    window.dispatchEvent(new CustomEvent(HANDSFREE_START_EVENT, { detail: { threadId: target } }));
  }, [rpc, threadId, newLook, draft]);

  const items = canvas?.items ?? [];
  const page = canvas?.page ?? null;
  const working = canvas?.status === "working" || !!pending;
  return (
    <div className={cn("canvas-page relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", css && "cv-scope")} data-canvas-page data-canvas-preview={preview ? "" : undefined} data-canvas-status={canvas?.status ?? (pending ? "working" : "new")} data-canvas-rev={canvas?.rev ?? 0} data-cv-look={look} data-cv-mode={theme.mode}>
      {css ? <style>{css}</style> : null}
      <TopBar canvas={canvas ?? null} onModelChanged={() => void reload()} isNew={!threadId} draft={draft} onDraft={setDraft} />
      {/* The board ends where the chat block starts, by its measured height: nothing ever draws under the caption. */}
      <div className={cn("canvas-scroll min-h-0 flex-1 overflow-x-hidden", page ? "overflow-hidden" : "overflow-y-auto px-8 pt-2")} style={{ marginBottom: chatHeight }} data-canvas-scroll>
        {canvas === undefined ? null : (page || stream) && look !== "classic" ? (
          <PageFrame html={page} stream={stream?.html ?? null} streamN={stream?.n ?? 0} rev={canvas?.rev ?? 0} look={look} mode={theme.mode} title={canvas?.title ?? "Visual Chat"} />
        ) : look !== "classic" ? (
          <OrganicBoard
            key={preview ? "preview" : "board"}
            items={items}
            look={look}
            mode={theme.mode}
            bottomPad={24}
            empty={<p className="max-w-sm text-center text-[15px] leading-relaxed" style={{ color: "var(--cv-muted)", fontFamily: "var(--cv-font-text)" }}>{working ? "Thinking it through…" : "Ask anything. The board fills in as we talk, and changes as the conversation does."}</p>}
          />
        ) : (
          <Board
            items={items}
            theme={theme}
            bottomPad={24}
            empty={<p className="max-w-sm text-center text-[15px] leading-relaxed text-muted-foreground/70">{working ? "Thinking it through…" : "Ask anything. The board fills in as we talk, and changes as the conversation does."}</p>}
          />
        )}
      </div>
      <ChatLine threadId={threadId} canvas={canvas ?? null} pending={pending} working={working} timeline={timeline} onSubmit={submit} onVoice={voice} onHeight={setChatHeight} />
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
type Timeline = ReturnType<typeof useTimeline>;

/** A faint bar: the canvas's name, its other canvases, the model, and New. */
function TopBar({ canvas, onModelChanged, isNew, draft, onDraft }: { canvas: CanvasView | null; onModelChanged(): void; isNew: boolean; draft: CanvasExecution; onDraft(pick: CanvasExecution): void }) {
  const rpc = useRpc<typeof canvasContract>();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CanvasMeta[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    rpc.call("canvas.list", null).then(({ canvases }) => { if (live) setList(canvases as CanvasMeta[]); }, () => {});
    return () => { live = false; };
  }, [open, rpc]);
  return (
    <div className="relative z-20 flex h-11 shrink-0 items-center gap-1 px-5 text-sm text-muted-foreground">
      <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-foreground/5 hover:text-foreground" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="GridView" className="size-3.5 shrink-0" />
        <span className="truncate">{canvas?.title ?? "New visual chat"}</span>
        <Icon name="ChevronDown" className="size-3.5 shrink-0 opacity-60" />
      </button>
      <span className="ml-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground/70">Prototype</span>
      <div className="flex-1" />
      {/* Always shown: on a new canvas it picks the model the first message starts on. */}
      {canvas || isNew ? <ModelPicker canvas={canvas} onChanged={onModelChanged} draft={draft} onDraft={onDraft} /> : null}
      <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/5 hover:text-foreground" onClick={() => openAppPath(canvasNewHref())}>
        <Icon name="Plus" className="size-3.5" /> New chat
      </button>
      {open ? (
        <div role="menu" className="absolute left-5 top-10 w-80 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {list === null ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p> : list.length ? list.slice(0, 12).map((each) => (
            <button key={each.id} role="menuitem" type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover", each.threadId === canvas?.threadId && "font-medium")} onClick={() => { setOpen(false); openAppPath(canvasHref(each.threadId)); }}>
              <span className="min-w-0 flex-1 truncate">{each.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{each.itemCount} items</span>
            </button>
          )) : <p className="px-2 py-1.5 text-xs text-muted-foreground">No chats yet.</p>}
        </div>
      ) : null}
    </div>
  );
}

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

/** The chat, as one faint line: the latest caption over a borderless field. */
function ChatLine({ threadId, canvas, pending, working, timeline, onSubmit, onVoice, onHeight }: { threadId: string | null; canvas: CanvasView | null; pending: string | null; working: boolean; timeline: Timeline; onSubmit(text: string): Promise<void>; onVoice(): Promise<void>; onHeight(height: number): void }) {
  const [startingVoice, setStartingVoice] = useState(false);
  const startVoice = async () => {
    setStartingVoice(true);
    try { await onVoice(); } finally { setStartingVoice(false); }
  };
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(false);
  const input = useRef<HTMLInputElement>(null);
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
  const field = `canvas:${threadId ?? "new"}`;
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
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const ours = target === input.current;
      if (ours ? textRef.current !== "" : target && target !== document.body && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") timeline.back(); else timeline.forward();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText("");
    try { await onSubmit(value); } catch { setText(value); } finally { setSending(false); input.current?.focus(); }
  };

  const caption = pending ? null : canvas?.caption ?? null;
  const lastUser = pending ?? [...(canvas?.history ?? [])].reverse().find((line) => line.role === "user")?.text ?? null;
  return (
    <div ref={block} className="canvas-chat pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-background pb-5 pt-3" data-canvas-chat>
      <div className="pointer-events-auto w-full max-w-2xl px-6">
        {history && canvas ? <History lines={canvas.history} /> : null}
        <div className="mb-1.5 min-h-[1.5rem] text-[15px] leading-snug" aria-live="polite" data-canvas-caption>
          {working ? (
            <p className="flex items-center gap-2 text-muted-foreground"><span className="canvas-pulse inline-block size-1.5 rounded-full bg-primary" aria-hidden />{lastUser ? <span className="truncate opacity-80">“{lastUser}”</span> : "Thinking…"}</p>
          ) : caption ? (
            <p className="line-clamp-3 text-foreground/80">{caption}</p>
          ) : null}
        </div>
        <form ref={form} onSubmit={submit} className="flex items-center gap-0.5 border-b border-foreground/10 transition-colors focus-within:border-foreground/30" data-talk-field={field} data-talk-field-label={canvas ? `“${canvas.title}”` : "the new canvas"}>
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={CANVAS_LIMITS.messageChars}
            placeholder={!threadId ? "What should we look at?" : timeline.position < timeline.total ? `Continue from version ${timeline.position}…` : "Say what's next…"}
            aria-label="Message Visual Chat"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/55"
            data-canvas-input
            autoFocus
          />
          {/* Talk shows its dictation controls here while dictating into this field, as in BB's composer (fields.ts). */}
          <span className="flex min-w-0 items-center" data-talk-field-dock />
          {canvas && timeline.total > 1 ? <Versions timeline={timeline} /> : null}
          {canvas ? (
            <button type="button" className={cn(FAINT_BUTTON, history && "bg-foreground/5 text-foreground")} aria-label="History" title="History" aria-pressed={history} onClick={() => setHistory((value) => !value)}>
              <Icon name="Clock" className="size-4" />
            </button>
          ) : null}
          <button type="button" className={cn(FAINT_BUTTON, dictating && "bg-red-500/10 text-red-600 dark:text-red-400")} aria-label={dictating ? "Finish dictation" : "Dictate"} title={dictating ? "Finish dictation" : "Dictate"} aria-pressed={dictating}
            onClick={() => input.current?.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { bubbles: true }))} data-canvas-voice>
            <Icon name="Mic" className="size-4" />
          </button>
          <button type="button" className={FAINT_BUTTON} aria-label="Hands-free voice" title="Hands-free voice: talk, and the board changes as it answers" disabled={startingVoice}
            onClick={() => void startVoice()} data-canvas-handsfree data-canvas-voice>
            <Icon name="studio/handsfree" className="size-4" />
          </button>
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
      <span className={cn("min-w-[2.75rem] select-none text-center text-[12px] tabular-nums", old ? "font-medium text-foreground" : "text-muted-foreground/70")} title={`Version ${position} of ${total}${timeline.promptAt(position) ? `: ${quoted(timeline.promptAt(position))}` : ""}${old ? ". A message from here continues from this version." : ""}`} aria-live="polite" data-canvas-version-label>
        {position} / {total}
      </span>
      <button type="button" className={step} aria-label="Next version" title={position < total ? `Version ${position + 1}: ${quoted(timeline.promptAt(position + 1))} (→)` : "Next version"} disabled={position >= total} onClick={timeline.forward}>
        <Icon name="ChevronRight" className="size-3.5" />
      </button>
    </span>
  );
}
