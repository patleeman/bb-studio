import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  requestDesktopControl,
  useDesktopControlState,
  type ForkDesktopControlState,
} from "@/lib/fork-desktop-control";

export const DESKTOP_OVERLAY_WINDOW_ID = "desktop-overlay";

const PIN_COLOR = "oklch(0.8 0.15 65)";
const GHOST_COLOR = "oklch(0.74 0.13 258)";
const TALK_KEY_LABELS: Record<string, string> = {
  fn: "fn",
  AltRight: "right ⌥",
  MetaRight: "right ⌘",
  ControlRight: "right ⌃",
};

type Pin = ForkDesktopControlState["pins"][number];

function pinCaption(pin: Pin): string {
  const element = pin.label !== null ? `“${pin.label}”` : pin.role;
  return [pin.app, element]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-foreground/15 px-1.5 py-px font-sans text-xs text-foreground">
      {children}
    </kbd>
  );
}

export interface ModeBarItem {
  key: string;
  text: string;
  kbd?: string;
  after?: string;
}

export function modeBarItems(
  state: ForkDesktopControlState,
): ModeBarItem[] | null {
  const talkKey = TALK_KEY_LABELS[state.talkKey] ?? state.talkKey;
  if (state.ask !== null) {
    return [
      { key: "who", text: `${state.ask.agent} asks to drive` },
      { key: "esc", text: "", kbd: "esc", after: "say no" },
    ];
  }
  if (state.activity !== null) {
    if (state.activity.phase === "stopped")
      return [{ key: "who", text: `${state.activity.agent} stopped` }];
    if (state.activity.phase === "paused") {
      return [
        { key: "who", text: `${state.activity.agent} paused` },
        { key: "why", text: "You are using this window" },
      ];
    }
    return [
      { key: "who", text: `${state.activity.agent} is acting` },
      {
        key: "how",
        text: state.activity.foreground
          ? "Using your cursor"
          : "In the background",
      },
      { key: "esc", text: "", kbd: "esc", after: "stop" },
    ];
  }
  if (state.pointing) {
    return [
      { key: "mode", text: "Pointing" },
      { key: "click", text: "Click to pin" },
      { key: "talk", text: "Hold", kbd: talkKey, after: "to talk" },
      { key: "esc", text: "", kbd: "esc", after: "back to BB" },
    ];
  }
  return null;
}

export function ForkDesktopOverlay() {
  const [search] = useSearchParams();
  const originX = Number(search.get("x") ?? "0");
  const originY = Number(search.get("y") ?? "0");
  const state = useDesktopControlState();
  const lastMove = useRef(0);
  const clickAt = state?.activity?.clickAt ?? null;
  const [rippleDone, setRippleDone] = useState<number | null>(null);

  useEffect(() => {
    if (clickAt === null) return;
    const timer = window.setTimeout(() => setRippleDone(clickAt), 900);
    return () => window.clearTimeout(timer);
  }, [clickAt]);
  const ripple = clickAt !== null && rippleDone !== clickAt ? clickAt : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        void requestDesktopControl({ op: "hud", shown: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const local = useMemo(
    () => (x: number, y: number) => ({ left: x - originX, top: y - originY }),
    [originX, originY],
  );

  if (state === null || !state.hud.shown) return null;
  const pointing = state.pointing;
  const hover = pointing ? state.hover : null;
  const items = modeBarItems(state);
  const activity = state.activity;
  const listening = state.pins.find((pin) => !pin.placed) ?? null;

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden"
      style={{ cursor: pointing ? "crosshair" : "default" }}
      onMouseMove={(event) => {
        if (!pointing) return;
        const now = performance.now();
        if (now - lastMove.current < 80) return;
        lastMove.current = now;
        void requestDesktopControl({
          op: "point",
          x: event.screenX,
          y: event.screenY,
          click: false,
        });
      }}
      onMouseDown={(event) => {
        if (!pointing || event.button !== 0) return;
        event.preventDefault();
        void requestDesktopControl({
          op: "point",
          x: event.screenX,
          y: event.screenY,
          click: true,
        });
      }}
    >
      {hover?.elementFrame ? (
        <div
          className="pointer-events-none absolute rounded-lg border-2"
          style={{
            ...local(hover.elementFrame.x - 4, hover.elementFrame.y - 4),
            width: hover.elementFrame.width + 8,
            height: hover.elementFrame.height + 8,
            borderColor: GHOST_COLOR,
            background: "oklch(0.74 0.13 258 / 0.08)",
          }}
        >
          <span className="absolute top-full left-0 mt-2 whitespace-nowrap rounded-md bg-popover px-2 py-0.5 text-xs text-popover-foreground shadow">
            {pinCaption(hover)}
          </span>
        </div>
      ) : null}

      {state.pins.map((pin) => (
        <div
          key={pin.id}
          data-desktop-pin={pin.number}
          className="pointer-events-none absolute grid size-7 place-items-center text-sm font-bold text-black shadow-lg transition-transform"
          style={{
            ...local(pin.x, pin.y - 28),
            background: PIN_COLOR,
            borderRadius: "14px 14px 14px 2px",
            opacity: pin.placed ? 1 : 0.55,
            transform: pin.placed ? "scale(1)" : "scale(0.85)",
          }}
        >
          {pin.number}
        </div>
      ))}

      {listening !== null ? (
        <div
          className="pointer-events-none absolute flex h-8 items-center gap-2 rounded-full bg-popover px-3 text-xs text-popover-foreground shadow-lg"
          style={local(listening.x + 14, listening.y + 14)}
        >
          <span className="flex h-4 items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className="w-0.5 animate-pulse rounded bg-destructive"
                style={{
                  height: `${String(6 + ((bar * 5) % 10))}px`,
                  animationDelay: `${String(bar * 120)}ms`,
                }}
              />
            ))}
          </span>
          Listening · release to pin
        </div>
      ) : null}

      {activity !== null && activity.x !== null && activity.y !== null ? (
        <div
          className="pointer-events-none absolute transition-all duration-300"
          style={local(activity.x, activity.y)}
          aria-hidden
        >
          {ripple !== null ? (
            <span
              key={ripple}
              className="absolute -top-5 -left-5 size-10 animate-ping rounded-full border-2"
              style={{ borderColor: GHOST_COLOR }}
            />
          ) : null}
          <svg
            width="20"
            height="24"
            viewBox="0 0 20 24"
            className="drop-shadow"
          >
            <path
              d="M2 2l15 11-7 1-3 7z"
              fill={GHOST_COLOR}
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="absolute top-[-30px] left-[18px] whitespace-nowrap rounded-md px-2 py-1 text-xs text-white shadow"
            style={{ background: "oklch(0.36 0.07 258)" }}
          >
            {activity.agent} ·{" "}
            {activity.phase === "paused"
              ? "paused"
              : activity.phase === "stopped"
                ? "stopped"
                : activity.caption}
          </span>
        </div>
      ) : null}

      {items !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-10 left-1/2 flex h-9 -translate-x-1/2 items-center gap-3.5 rounded-full border border-border bg-popover/95 px-4 text-xs text-popover-foreground shadow-lg"
        >
          {items.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5">
              {item.text.length > 0 ? item.text : null}
              {item.kbd !== undefined ? <Kbd>{item.kbd}</Kbd> : null}
              {item.after ?? null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
