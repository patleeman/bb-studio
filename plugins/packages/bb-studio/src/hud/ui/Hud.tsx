// The HUD window (src/hud/shared.ts): a conversation popped out, over other
// apps. The window is see-through; the page is BB's own chat for the thread
// (ThreadChat: the transcript as a thread shows it, following new output,
// with BB's composer), styled by hud-style.ts into one bar at the bottom
// with the transcript fading out above it, over a tint that thickens toward
// the bar. No title bar: the bar's empty parts drag the window.
//
// The thread is the window's `threadId` param ("Pop out to HUD" on a
// conversation), else the primary Bot's chat (the hotkey, the menu bar).
// At the bar's right end: the eye, which turns click-through on (clicks then
// reach the app underneath, and a strip at the top says so with the ways
// back; click-through.ts), and "Pop back in", which shows the conversation in
// BB's main window and closes the HUD.
import { HudPresence } from "../../presence/ui/HudPresence";
import { ThreadChat, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../kit/ui/index";
import { CLICK_THROUGH_EVENT, hasClickThroughHold, useHostWindows, windowParams, type HostWindows } from "../../kit/app/windows";
import { threadPath } from "../../launcher/shared";
import { LinksBridge } from "../../links/open";
import { useStudioSettings } from "../../settings/ui/use-settings";
import type { hudContract } from "../contract";
import { CLICK_THROUGH_OFF, clickThroughStep, type ClickThroughEvent, type ClickThroughState } from "../click-through";
import { useHudHotkey } from "../hotkey";
import { HUD_THREAD_PARAM, HUD_WINDOW_ID, wayBack } from "../shared";
import { HUD_CSS, HUD_PAGE_CSS } from "./hud-style";
import { useHud } from "./use-hud";
import { HudTheme } from "../../theme/ui/ThemeLayer";

const TOOL = "flex size-[26px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * The window's click-through (click-through.ts), wired to BB and the page.
 * `available` is false in a browser and on a BB that can't switch it on an
 * open window, where the HUD offers no toggle.
 */
export function useClickThrough(windows: HostWindows, windowId: string): { state: ClickThroughState; available: boolean; toggle(): void } {
  const available = windows.native && typeof windows.setClickThrough === "function";
  const hold = hasClickThroughHold(windows);
  const [state, setState] = useState<ClickThroughState>(CLICK_THROUGH_OFF);
  const current = useRef(state);
  const dispatch = useCallback((event: ClickThroughEvent) => {
    // With BB's hold mode, Option only pauses passing clicks: click-through stays on, so BB's hotkey and menu bar entry turn it off and never hide the HUD.
    const step = clickThroughStep(current.current, event, { hold });
    if (step.state !== current.current) { current.current = step.state; setState(step.state); }
    if (step.ask === null) return;
    void (step.hold ? windows.setClickThrough?.(windowId, step.ask, { hold: true }) : windows.setClickThrough?.(windowId, step.ask))?.catch(() => false);
  }, [windows, windowId, hold]);
  useEffect(() => {
    if (!available) return;
    const host = (event: Event) => dispatch({ type: "host", on: (event as CustomEvent<{ on?: unknown }>).detail?.on === true });
    // A click-through window still gets mousemove, with the modifier keys.
    const moved = (event: MouseEvent) => dispatch({ type: "pointer", alt: event.altKey });
    const left = () => dispatch({ type: "release" });
    const keyUp = (event: KeyboardEvent) => { if (event.key === "Alt") dispatch({ type: "release" }); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && current.current.mode !== "off") { event.preventDefault(); dispatch({ type: "escape" }); } };
    window.addEventListener(CLICK_THROUGH_EVENT, host);
    window.addEventListener("mousemove", moved);
    document.documentElement.addEventListener("mouseleave", left);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("keydown", keyDown, true);
    return () => {
      window.removeEventListener(CLICK_THROUGH_EVENT, host);
      window.removeEventListener("mousemove", moved);
      document.documentElement.removeEventListener("mouseleave", left);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("keydown", keyDown, true);
    };
  }, [available, dispatch]);
  const toggle = useCallback(() => dispatch({ type: "toggle" }), [dispatch]);
  return { state, available, toggle };
}

/** The conversation the window was opened on, from its address; null for the primary Bot's chat. */
export function hudThreadParam(search?: string): string | null {
  return windowParams(search)[HUD_THREAD_PARAM]?.trim() || null;
}

export function HudWindow() {
  const windows = useHostWindows();
  const rpc = useRpc<typeof hudContract>();
  const hud = useHud();
  // The shortcut BB holds for the HUD: the one the user set, or none.
  const hotkey = useHudHotkey(useStudioSettings().values?.hudHotkey ?? "").inUse;
  const clickThrough = useClickThrough(windows, HUD_WINDOW_ID);
  const mode = clickThrough.state.mode;
  // Shown again (the hotkey, the menu bar): the composer takes the keys.
  const [focusRequest, setFocusRequest] = useState(1);
  useEffect(() => {
    const focused = () => setFocusRequest((count) => count + 1);
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, []);
  const [named] = useState(() => hudThreadParam());
  const bot = hud.bot;
  const threadId = named ?? bot?.threadId ?? null;
  const close = () => { void windows.close(HUD_WINDOW_ID).then((closed) => { if (!closed && !windows.native) window.close(); }, () => {}); };
  const popBackIn = () => {
    if (!threadId) return;
    void rpc.call("window.openInMain", { path: threadPath(threadId) }).then(close, () => {});
  };
  const empty = threadId ? null : bot === undefined ? (hud.error ?? "") : bot === null ? "No Bot yet. Make one in BB, on the Bot page." : `${bot.name} has no chat yet.`;
  return (
    <div data-studio-hud="" data-hud-thread={threadId ?? undefined} data-hud-click-through={mode} className={`relative h-dvh w-full overflow-hidden text-sm text-foreground${windows.native ? "" : " bg-background"}`}>
      <style>{windows.native ? `${HUD_PAGE_CSS}\n${HUD_CSS}` : HUD_CSS}</style>
      <HudTheme />
      <LinksBridge />
      <div data-hud-backdrop="" aria-hidden className="pointer-events-none absolute inset-0" />
      {mode !== "off" ? (
        <div role="status" data-testid="hud-click-through-banner" className="absolute inset-x-2 top-2 z-40 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm">
          {mode === "peek"
            ? "Click-through on · usable while ⌥ is held · Esc or the eye turns it off"
            : `Click-through on · hold ⌥ to use · ${wayBack(hotkey)} turns it off`}
        </div>
      ) : null}
      {threadId
        ? <div className="relative h-full" data-testid="hud-chat"><ThreadChat threadId={threadId} variant="compact" focusRequest={focusRequest} /></div>
        : (
          <div className="absolute inset-x-2 bottom-2">
            <p data-testid="hud-empty" className="m-0 flex min-h-12 items-center rounded-2xl border border-border bg-background pl-4 pr-16 text-muted-foreground shadow-lg">{empty}</p>
          </div>
        )}
      <div data-hud-bar-tools="" data-testid="hud-bar-tools" className="absolute z-30 flex items-center gap-1">
        <HudPresence botId={bot?.id ?? null} working={hud.working} />
        {clickThrough.available ? (
          <button type="button" className={TOOL} aria-label="Click-through" aria-pressed={mode !== "off"} data-testid="hud-click-through"
            title={mode === "off" ? "Turn click-through on" : "Turn click-through off"}
            onClick={clickThrough.toggle}><Icon name={mode === "off" ? "Eye" : "EyeOff"} className="size-3.5" /></button>
        ) : null}
        {threadId
          ? <button type="button" className={TOOL} aria-label="Pop back in" title="Pop back in" data-testid="hud-pop-in" onClick={popBackIn}><Icon name="Minimize2" className="size-3.5" /></button>
          : <button type="button" className={TOOL} aria-label="Close" title="Close" data-testid="hud-close" onClick={close}><Icon name="X" className="size-3.5" /></button>}
      </div>
    </div>
  );
}
