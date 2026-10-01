// The row along the bottom of the screen: windows, newest at the right, a
// menu for those that don't fit, and a corner for other plugins (Studio
// Chat's "Work with this…" bar) at the right end.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  publishFloatDock,
  setFloatHost,
  type FloatTarget,
} from "@bb-studio/kit/app";
import { FLOAT_RIGHT_VAR, STUDIO_CHAT_FLOAT_EVENT } from "@bb-studio/kit/contract";
import { useEffect, useLayoutEffect, useState } from "react";
import { update, useFloatState } from "./store";
import { bringForward, EMPTY, EXPANDED_WIDTH, fitCount, MINIMIZED_WIDTH, openWindow, toggleHidden } from "./windows";
import { pathTitle, Window } from "./Window";

const OVERFLOW_WIDTH = 44;

/** Lets every plugin open windows, and answers Studio Chat's older event. */
function useHost() {
  useEffect(() => {
    setFloatHost({ open: (target, options) => update((state) => openWindow(state, target, options)) });
    const onLegacyFloat = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
      if (typeof threadId === "string" && threadId) update((state) => openWindow(state, { kind: "thread", threadId }));
    };
    window.addEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    return () => {
      setFloatHost(null);
      window.removeEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    };
  }, []);
}

/** Follows an element's width. */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

const label = (target: FloatTarget) => target.title ?? (target.kind === "thread" ? "Thread" : pathTitle(target.path));

export function Dock() {
  useHost();
  const { windows, hidden } = useFloatState();
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [corner, setCorner] = useState<HTMLDivElement | null>(null);
  const rowWidth = useWidth(row);
  const cornerWidth = useWidth(corner);

  useEffect(() => {
    publishFloatDock(corner);
    return () => publishFloatDock(null);
  }, [corner]);

  // Phones and narrow windows get one full-width window at a time.
  const expandedWidth = Math.min(EXPANDED_WIDTH, Math.max(280, rowWidth));
  const minimizedWidth = Math.min(MINIMIZED_WIDTH, expandedWidth);
  const widths = windows.map((window) => (window.minimized ? minimizedWidth : expandedWidth));
  const room = rowWidth - (cornerWidth ? cornerWidth + 8 : 0);
  const shownCount = hidden ? 0 : fitCount(widths, room, OVERFLOW_WIDTH);
  const shown = windows.slice(windows.length - shownCount);
  const overflow = windows.slice(0, windows.length - shownCount);

  return (
    <div
      ref={setRow}
      className="bb-float pointer-events-none fixed bottom-0 left-2 z-40 flex items-end justify-end gap-2"
      style={{ right: `var(${FLOAT_RIGHT_VAR}, 1.5rem)` }}
    >
      {overflow.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={hidden ? `Show ${windows.length} windows` : `${overflow.length} more windows`}
              className="float-overflow pointer-events-auto mb-2 flex h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground shadow-lg hover:text-foreground"
              style={{ minWidth: OVERFLOW_WIDTH }}
            >
              <Icon name="AppWindow" className="size-3.5" />
              {overflow.length}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64">
            {overflow.map((window) => (
              <DropdownMenuItem key={window.key} onSelect={() => update((state) => bringForward(state, window.key))}>
                <Icon name={window.target.kind === "thread" ? "MessageSquare" : (window.target.icon ?? "AppWindow")} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{label(window.target)}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {hidden ? (
              <DropdownMenuItem onSelect={() => update(toggleHidden)}>
                <Icon name="ChevronUp" className="size-4" /> Show all
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => update(() => EMPTY)}>
              <Icon name="X" className="size-4" /> Close all
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {shown.map((window) => (
        <Window key={window.key} window={window} width={window.minimized ? minimizedWidth : expandedWidth} />
      ))}
      <div ref={setCorner} className="float-corner flex shrink-0 items-end empty:hidden" />
    </div>
  );
}
