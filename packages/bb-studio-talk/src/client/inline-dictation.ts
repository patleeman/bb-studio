import { useLayoutEffect, useState } from "react";
import { BUILT_IN_MIC_SELECTOR } from "./composer-dom";
import { talk } from "./controller";

const CSS = `
[data-talk-inline-mic] { display: none !important; }
[data-talk-inline-row] { flex-wrap: wrap; }
[data-talk-inline-row][data-talk-inline-narrow] { position: relative !important; inset: auto !important; }
[data-talk-inline-narrow] [data-talk-inline-actions] { flex: 1 1 100%; width: 100%; min-width: 0; justify-content: flex-end; }
[data-talk-inline-host] { display: flex; min-width: 0; max-width: 100%; }
[data-talk-inline-narrow] [data-talk-inline-host] { flex: 1; }
`;

/** Dock only into the source input, and only while its controls are on screen. */
export function inlineMic(composer: HTMLElement | null): HTMLButtonElement | null {
  if (!composer?.isConnected || composer.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
  const mic = composer.querySelector<HTMLButtonElement>(BUILT_IN_MIC_SELECTOR);
  if (!mic || mic.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
  const anchor = mic.hasAttribute("data-talk-inline-mic") ? mic.parentElement?.querySelector<HTMLElement>("[data-talk-inline-host]") : mic;
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth ? mic : null;
}

/** A portal beside the mic; removing it restores the native toolbar exactly. */
export function mountInlineDock(mic: HTMLButtonElement) {
  const parent = mic.parentElement!;
  const actions = mic.closest<HTMLElement>("[data-promptbox-standard-actions]") ?? parent;
  const row = mic.closest<HTMLElement>("[data-promptbox-action-row]") ?? actions.parentElement!;
  const composer = mic.closest<HTMLElement>("[data-promptbox]")!;
  const host = document.createElement("span");
  host.setAttribute("data-talk-inline-host", "");
  host.setAttribute("data-bb-plugin", "talk");
  host.setAttribute("data-bb-plugin-root", "");
  parent.insertBefore(host, mic);
  mic.setAttribute("data-talk-inline-mic", "");
  actions.setAttribute("data-talk-inline-actions", "");
  row.setAttribute("data-talk-inline-row", "");
  const resize = () => {
    const narrow = composer.getBoundingClientRect().width < 640;
    if (row.hasAttribute("data-talk-inline-narrow") !== narrow) row.toggleAttribute("data-talk-inline-narrow", narrow);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(composer);
  return {
    mic, host,
    remove: () => {
      observer.disconnect();
      host.remove();
      mic.removeAttribute("data-talk-inline-mic");
      actions.removeAttribute("data-talk-inline-actions");
      row.removeAttribute("data-talk-inline-row");
      row.removeAttribute("data-talk-inline-narrow");
    },
  };
}

/** Follow navigation, input remounts, scroll visibility, and toolbar changes. */
export function useInlineDictation(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    let dock: ReturnType<typeof mountInlineDock> | null = null;
    const sync = () => {
      const mic = inlineMic(talk.dictationComposer());
      if (mic === dock?.mic && dock.host.isConnected) return;
      dock?.remove();
      dock = mic ? mountInlineDock(mic) : null;
      setSlot(dock?.host ?? null);
    };
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // Attribute changes may hide a pane without unmounting it. Keep this
    // separate from the meter's per-frame style updates.
    const timer = window.setInterval(sync, 500);
    const unsubscribe = talk.subscribe(schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    sync();
    return () => {
      observer.disconnect();
      clearInterval(timer);
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      dock?.remove();
      style.remove();
      setSlot(null);
    };
  }, [enabled]);
  return enabled ? slot : null;
}
