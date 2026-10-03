// Quoting an artifact into its thread. Select text in the viewer, including
// inside an HTML preview (its quote script reports the selection), or drag
// over an image, then send it with a note. It goes to the artifact's home
// thread through Studio Chat; without Studio Chat, BB's composer opens with it.
import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { GHOST_BUTTON, Icon, PRIMARY_BUTTON, cn, useHomeThread, useItemChat } from "@bb-studio/kit/app";
import { mentionPrompt } from "@bb-studio/kit/contract";
import { errorMessage, quoteMessage, type ItemQuote } from "@bb-studio/kit/format";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { SELECTION_MESSAGE } from "../src/shared";

export type Rect = { left: number; top: number; right: number; bottom: number };

/** Something picked out of the artifact, waiting for a note. */
export type Picked = Omit<ItemQuote, "note"> & { rect: Rect };

const CARD_WIDTH = 340;
const CARD_HEIGHT = 230;
const QUOTE_LIMIT = 20_000;
/** Marks the quote's own UI and images, whose clicks don't change the selection. */
const IGNORE = "data-quote-ignore";

/**
 * Follows what's selected in `container`, as text in the page or in the HTML
 * preview's frame inside it. Ends a selection when it collapses or scrolls
 * away. Turn it off while a note is being written, so the pick stays.
 */
export function useSelectionPick(container: RefObject<HTMLElement | null>, where: string, enabled: boolean): [Picked | null, (picked: Picked | null) => void] {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const fromPage = () => {
      const selection = document.getSelection();
      const root = container.current;
      if (!selection || selection.isCollapsed || !root || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
      const text = String(selection).trim();
      if (!text) return null;
      const box = selection.getRangeAt(0).getBoundingClientRect();
      return { text: text.slice(0, QUOTE_LIMIT), where, image: null, rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
    };
    let frame = 0;
    const soon = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(`[${IGNORE}]`)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPicked(fromPage()));
    };
    const onChange = () => {
      if (document.getSelection()?.isCollapsed) setPicked((current) => (current?.image ? current : null));
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; text?: unknown; rect?: Partial<Rect> } | null;
      if (data?.type !== SELECTION_MESSAGE) return;
      const iframe = [...(container.current?.querySelectorAll("iframe") ?? [])].find((each) => each.contentWindow === event.source);
      if (!iframe) return;
      const r = data.rect;
      if (typeof data.text !== "string" || !data.text || !r || ![r.left, r.top, r.right, r.bottom].every((n) => typeof n === "number")) {
        setPicked(null);
        return;
      }
      const at = iframe.getBoundingClientRect();
      setPicked({
        text: data.text.slice(0, QUOTE_LIMIT),
        where,
        image: null,
        rect: { left: at.left + r.left!, top: at.top + r.top!, right: at.left + r.right!, bottom: at.top + r.bottom! },
      });
    };
    document.addEventListener("mouseup", soon);
    document.addEventListener("keyup", soon);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("scroll", soon, true);
    window.addEventListener("message", onMessage);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mouseup", soon);
      document.removeEventListener("keyup", soon);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("scroll", soon, true);
      window.removeEventListener("message", onMessage);
    };
  }, [container, where, enabled]);
  return [picked, setPicked];
}

/**
 * Drag over the image to pick an area; a plain click still toggles zoom.
 * Returns the props for the <img> and the box being drawn.
 */
export function useImageArea(where: string, onPick: (picked: Picked) => void) {
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const dragged = useRef(false);
  const box = drag
    ? { left: Math.min(drag.x, drag.x2), top: Math.min(drag.y, drag.y2), right: Math.max(drag.x, drag.x2), bottom: Math.max(drag.y, drag.y2) }
    : null;
  return {
    box: box && box.right - box.left > 4 && box.bottom - box.top > 4 ? box : null,
    imgProps: {
      [IGNORE]: "",
      draggable: false,
      onPointerDown: (event: React.PointerEvent<HTMLImageElement>) => {
        if (event.button !== 0) return;
        dragged.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ x: event.clientX, y: event.clientY, x2: event.clientX, y2: event.clientY });
      },
      onPointerMove: (event: React.PointerEvent<HTMLImageElement>) => {
        if (!drag) return;
        if (Math.abs(event.clientX - drag.x) > 4 || Math.abs(event.clientY - drag.y) > 4) dragged.current = true;
        setDrag({ ...drag, x2: event.clientX, y2: event.clientY });
      },
      onPointerUp: (event: React.PointerEvent<HTMLImageElement>) => {
        const img = event.currentTarget;
        setDrag(null);
        if (!drag || !dragged.current) return;
        const shown = img.getBoundingClientRect();
        const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
        const rect = {
          left: clamp(Math.min(drag.x, event.clientX), shown.left, shown.right),
          top: clamp(Math.min(drag.y, event.clientY), shown.top, shown.bottom),
          right: clamp(Math.max(drag.x, event.clientX), shown.left, shown.right),
          bottom: clamp(Math.max(drag.y, event.clientY), shown.top, shown.bottom),
        };
        if (rect.right - rect.left < 4 || rect.bottom - rect.top < 4) return;
        const scale = img.naturalWidth / shown.width || 1;
        const area = {
          x: Math.round((rect.left - shown.left) * scale),
          y: Math.round((rect.top - shown.top) * (img.naturalHeight / shown.height || 1)),
          width: Math.round((rect.right - rect.left) * scale),
          height: Math.round((rect.bottom - rect.top) * (img.naturalHeight / shown.height || 1)),
        };
        const label = `area x ${area.x}–${area.x + area.width}, y ${area.y}–${area.y + area.height} px of the ${img.naturalWidth}×${img.naturalHeight} image, ${where}`;
        onPick({ text: null, where: label, image: crop(img, area), rect });
      },
      /** Swallows the click that ends a drag, so it doesn't toggle zoom. */
      onClickCapture: (event: React.MouseEvent) => {
        if (!dragged.current) return;
        dragged.current = false;
        event.stopPropagation();
      },
    },
  };
}

/** The area as a data URL no larger than 1024px a side, or null if the browser won't. */
function crop(img: HTMLImageElement, area: { x: number; y: number; width: number; height: number }): string | null {
  try {
    const fit = Math.min(1, 1024 / Math.max(area.width, area.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(area.width * fit));
    canvas.height = Math.max(1, Math.round(area.height * fit));
    canvas.getContext("2d")?.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    return png.length < 3_000_000 ? png : canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

/** The box being dragged over an image. */
export function AreaBox({ box }: { box: Rect | null }) {
  if (!box) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-30 rounded-sm border-2 border-sky-500 bg-sky-500/10"
      style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
    />
  );
}

/**
 * The button by a selection, then the card where you write a note and send
 * it. `item` is the artifact as its thread knows it.
 */
export function QuoteCard({
  picked,
  writing,
  onWrite,
  item,
  onClose,
}: {
  picked: Picked;
  /** Showing the card rather than the button. */
  writing: boolean;
  onWrite: () => void;
  item: { pluginId: string; id: string; title: string; href: string };
  onClose: () => void;
}) {
  const host = useItemChat();
  const home = useHomeThread({ pluginId: item.pluginId, id: item.id });
  const navigate = useBbNavigate();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (writing) field.current?.focus();
  }, [writing]);

  const target = home ? `"${home.title}"` : "a new thread";
  async function send() {
    const quote: ItemQuote = { text: picked.text, note, where: picked.where, image: picked.image };
    setSending(true);
    try {
      if (host) {
        const threadId = await host.send({ pluginId: item.pluginId, id: item.id }, quote);
        if (threadId) toast.success(`Sent to ${target}`);
      } else {
        navigate.toCompose({ initialPrompt: `${mentionPrompt([item])}\n\n${quoteMessage(quote)}`, focusPrompt: true });
      }
      window.getSelection()?.removeAllRanges();
      onClose();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  const { rect } = picked;
  if (!writing) {
    const top = rect.top > 48 ? rect.top - 40 : rect.bottom + 8;
    return (
      <button
        type="button"
        {...{ [IGNORE]: "" }}
        className="fixed z-50 flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm shadow-lg hover:bg-state-hover"
        style={{ top, left: clampLeft(rect.left, 180) }}
        // Keep the page's selection while the button takes the click.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onWrite}
      >
        <Icon name="MessageSquareQuote" fallback="MessageSquare" className="size-4" /> Send to thread
      </button>
    );
  }
  const top = rect.bottom + 8 + CARD_HEIGHT < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - CARD_HEIGHT - 8);
  return (
    <section
      {...{ [IGNORE]: "" }}
      aria-label="Send to thread"
      className="fixed z-50 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 shadow-xl"
      style={{ top, left: clampLeft(rect.left, CARD_WIDTH), width: CARD_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === "Enter" && !event.shiftKey && event.target === field.current) {
          if (!sending) void send();
        }
        else return;
        event.preventDefault();
      }}
    >
      {picked.image ? (
        <img src={picked.image} alt="The area you picked" className="max-h-24 self-start rounded border border-border object-contain" />
      ) : (
        <blockquote className="line-clamp-3 border-l-2 border-border pl-2 text-xs text-muted-foreground">{picked.text}</blockquote>
      )}
      <textarea
        ref={field}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="Add a note (optional)"
        aria-label="Note"
        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-foreground/30"
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={home ? home.title : undefined}>
          To {target}
        </span>
        <button type="button" className={GHOST_BUTTON} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={cn(PRIMARY_BUTTON, "h-8 px-3")} disabled={sending} onClick={() => void send()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}

const clampLeft = (left: number, width: number) => Math.max(8, Math.min(left, window.innerWidth - width - 8));
