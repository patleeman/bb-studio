// The canvas page: /plugins/studio/studio/canvas/<threadId>, or /canvas for a
// new one. A full-window board, and the chat as one faint line at the
// bottom: the agent's latest caption, a text field, the dictation mic and
// the hands-free button. Loaded on demand by app.tsx.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { openAppPath } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Icon, cn } from "../../kit/ui/index";
import { useWidgetTheme } from "../../dashboards/ui/theme";
import { INSERT_EVENT, TOGGLE_EVENT, STATE_EVENT } from "../../talk/ui/fields";
import { startHandsFree } from "../../voice/live/ui/HandsFree";
import type { canvasContract } from "../contract";
import { canvasHref, CANVAS_LIMITS, type CanvasMeta, type CanvasTurn, type CanvasView } from "../shared";
import { Board } from "./board";
import { useCanvas } from "./use-canvas";

const decode = (segment: string) => {
  try { return decodeURIComponent(segment); } catch { return ""; }
};

export default function CanvasRoute({ rest }: { rest: string }) {
  const threadId = decode(rest.split("/")[0] ?? "") || null;
  return <CanvasPage key={threadId ?? "new"} threadId={threadId} />;
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
  const { canvas, send } = useCanvas(threadId);
  const [pending, setPending] = useState<string | null>(null);

  const submit = useCallback(async (text: string) => {
    if (!threadId) {
      setPending(text);
      try {
        const created = await rpc.call("canvas.create", { text });
        openAppPath(canvasHref(created.threadId), { replace: true });
      } catch (error) {
        setPending(null);
        toast.error(errorMessage(error));
        throw error;
      }
      return;
    }
    try { await send(text); } catch (error) { toast.error(errorMessage(error)); throw error; }
  }, [rpc, send, threadId]);

  const items = canvas?.items ?? [];
  const working = canvas?.status === "working" || !!pending;
  return (
    <div className="canvas-page relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" data-canvas-page data-canvas-status={canvas?.status ?? (pending ? "working" : "new")} data-canvas-rev={canvas?.rev ?? 0}>
      <TopBar canvas={canvas ?? null} />
      <div className="canvas-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-8 pt-2">
        {canvas === undefined ? null : (
          <Board
            items={items}
            theme={theme}
            empty={<p className="max-w-sm text-center text-[15px] leading-relaxed text-muted-foreground/70">{working ? "Thinking it through…" : "Ask anything. The board fills in as we talk, and changes as the conversation does."}</p>}
          />
        )}
      </div>
      <ChatLine threadId={threadId} canvas={canvas ?? null} pending={pending} working={working} onSubmit={submit} />
    </div>
  );
}

/** A faint bar: the canvas's name, its other canvases, and New. */
function TopBar({ canvas }: { canvas: CanvasView | null }) {
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
        <span className="truncate">{canvas?.title ?? "New canvas"}</span>
        <Icon name="ChevronDown" className="size-3.5 shrink-0 opacity-60" />
      </button>
      <span className="ml-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground/70">Prototype</span>
      <div className="flex-1" />
      <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/5 hover:text-foreground" onClick={() => openAppPath(canvasHref(null))}>
        <Icon name="Plus" className="size-3.5" /> New canvas
      </button>
      {open ? (
        <div role="menu" className="absolute left-5 top-10 w-80 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {list === null ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p> : list.length ? list.slice(0, 12).map((each) => (
            <button key={each.id} role="menuitem" type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover", each.threadId === canvas?.threadId && "font-medium")} onClick={() => { setOpen(false); openAppPath(canvasHref(each.threadId)); }}>
              <span className="min-w-0 flex-1 truncate">{each.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{each.itemCount} items</span>
            </button>
          )) : <p className="px-2 py-1.5 text-xs text-muted-foreground">No canvases yet.</p>}
        </div>
      ) : null}
    </div>
  );
}

const ROLE: Record<string, string> = { user: "You", agent: "Canvas", voice: "Voice" };

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
function ChatLine({ threadId, canvas, pending, working, onSubmit }: { threadId: string | null; canvas: CanvasView | null; pending: string | null; working: boolean; onSubmit(text: string): Promise<void> }) {
  const voiceRpc = useRpc();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
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
    <div className="canvas-chat pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-background from-45% via-background/80 to-transparent pb-5 pt-16">
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
            placeholder={threadId ? "Say what's next…" : "What should we look at?"}
            aria-label="Message the canvas"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/55"
            data-canvas-input
            autoFocus
          />
          {canvas ? (
            <button type="button" className={cn(FAINT_BUTTON, history && "bg-foreground/5 text-foreground")} aria-label="History" title="History" aria-pressed={history} onClick={() => setHistory((value) => !value)}>
              <Icon name="Clock" className="size-4" />
            </button>
          ) : null}
          <button type="button" className={cn(FAINT_BUTTON, dictating && "bg-red-500/10 text-red-600 dark:text-red-400")} aria-label={dictating ? "Finish dictation" : "Dictate"} title={dictating ? "Finish dictation" : "Dictate"} aria-pressed={dictating}
            onClick={() => input.current?.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { bubbles: true }))}>
            <Icon name="Mic" className="size-4" />
          </button>
          <button type="button" className={FAINT_BUTTON} aria-label="Hands-free voice" title={threadId ? "Hands-free voice: talk, and the board changes as it answers" : "Start the canvas first"} disabled={!threadId}
            onClick={() => threadId && startHandsFree(voiceRpc as never, threadId)} data-canvas-handsfree>
            <Icon name="studio/handsfree" className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
