// Playing one screen inside the canvas pane, as Claude Design does: a bar
// with back, the screen's label, download and Fit/Fill, over the screen
// itself, live and interactive. A slide deck plays as a presentation: the
// arrow keys, Space and the bar's buttons move between its slides, and
// Full screen presents it alone.
import { useEffect, useRef, useState } from "react";
import { ICON_BUTTON, Icon, cn } from "@bb-studio/kit/app";
import { VIEWPORTS, isDeck, screenDownloadUrl, screenUrl, type ScreenView } from "../src/shared";

const PADDING = 32;

export function PlayView({ designId, screen, step = "", onClose }: { designId: string; screen: ScreenView; step?: string; onClose(): void }) {
  const { width, height } = VIEWPORTS[screen.viewport] ?? VIEWPORTS.desktop;
  const url = screenUrl(designId, screen.id, screen.updatedAt);
  const deck = isDeck(screen);
  /** The slide on show; only a deck moves between steps from here. */
  const [slide, setSlide] = useState(() => Math.max(0, screen.steps.findIndex((each) => each.id === step)));
  const current = deck ? screen.steps[slide]?.id ?? "" : step;
  /** Starts at `step` and plays on from there with the prototype's own state. A new hash moves the frame without reloading it. */
  const playUrl = current ? `${url}#${encodeURIComponent(current)}` : url;
  const stepLabel = screen.steps.find((each) => each.id === step)?.label;
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const go = (by: number) => setSlide((index) => Math.min(screen.steps.length - 1, Math.max(0, index + by)));
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /** Fit shows the whole screen; Fill uses the stage's width and scrolls. */
  const [mode, setMode] = useState<"fit" | "fill">("fit");

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setRoom({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape leaves full screen first; the browser handles that itself.
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
      if (!deck || (event.target instanceof Element && event.target.closest("input, textarea, select, button"))) return;
      const by = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[event.key];
      if (by) {
        event.preventDefault();
        setSlide((index) => Math.min(screen.steps.length - 1, Math.max(0, index + by)));
      } else if (event.key === "Home") setSlide(0);
      else if (event.key === "End") setSlide(screen.steps.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, deck, screen.steps.length]);

  const availableWidth = Math.max(0, room.width - PADDING * 2);
  const availableHeight = Math.max(0, room.height - PADDING * 2);
  const scale = mode === "fill"
    ? availableWidth / width
    : Math.min(1, availableWidth / width, availableHeight / height);

  return (
    <div ref={root} role="dialog" aria-label={`Playing ${screen.id}`} className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <button type="button" aria-label="Back to the canvas" title="Back to the canvas (Esc)" className={ICON_BUTTON} onClick={onClose}>
          <Icon name="ChevronLeft" className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{screen.id}</span>
          {deck ? <span className="text-muted-foreground"> · {screen.steps[slide]?.label}</span> : stepLabel ? <span className="text-muted-foreground"> · from {stepLabel}</span> : screen.caption ? <span className="text-muted-foreground"> · {screen.caption}</span> : null}
        </span>
        {deck ? (
          <>
            <button type="button" aria-label="Previous slide" title="Previous slide (←)" disabled={slide === 0} className={ICON_BUTTON} onClick={() => go(-1)}>
              <Icon name="ChevronLeft" className="size-4" />
            </button>
            <span role="status" className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{slide + 1} / {screen.steps.length}</span>
            <button type="button" aria-label="Next slide" title="Next slide (→)" disabled={slide === screen.steps.length - 1} className={ICON_BUTTON} onClick={() => go(1)}>
              <Icon name="ChevronRight" className="size-4" />
            </button>
            <button type="button" aria-label="Full screen" title="Present full screen" className={ICON_BUTTON} onClick={() => void root.current?.requestFullscreen?.().catch(() => undefined)}>
              <Icon name="FullScreen" className="size-4" />
            </button>
          </>
        ) : null}
        <a href={screenDownloadUrl(designId, screen.id, screen.updatedAt)} download={`${screen.id}.html`} aria-label="Download HTML" title="Download HTML" className={ICON_BUTTON}>
          <Icon name="Download" className="size-4" />
        </a>
        <div role="group" aria-label="Size" className="flex rounded-md border border-border p-0.5 text-xs">
          {(["fill", "fit"] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={mode === each}
              onClick={() => setMode(each)}
              className={cn("rounded px-2 py-0.5 capitalize", mode === each ? "bg-state-hover text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {each}
            </button>
          ))}
        </div>
      </div>
      <div ref={stage} className={cn("min-h-0 flex-1", mode === "fill" ? "overflow-auto" : "overflow-hidden")}>
        {scale > 0 ? (
          <div className="flex min-h-full items-center justify-center" style={{ padding: PADDING }}>
            <div className="shrink-0 overflow-hidden rounded-[28px] bg-white shadow-[0_0_0_1px_oklch(1_0_0/0.06),0_16px_48px_oklch(0_0_0/0.35)]" style={{ width: width * scale, height: height * scale }}>
              <iframe
                title={`Screen ${screen.id}`}
                src={playUrl}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                className="origin-top-left border-0"
                style={{ width, height, transform: `scale(${scale})` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
