// Mounts the "at the desk" heartbeat (desk-presence.ts) on every desktop and
// computer browser client. Draws nothing.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import type { settingsContract } from "../contract";
import { CHECK_MS, DeskPresence, INPUT_EVENTS, presenceClientId, realInput, reportsPresence, type DesktopActivityBridge } from "./desk-presence";

export function DeskPresenceOverlay() {
  const rpc = useRpc<typeof settingsContract>();
  useEffect(() => {
    if (typeof window === "undefined" || !reportsPresence(window)) return;
    const bridge = ((window as { bbDesktop?: DesktopActivityBridge }).bbDesktop ?? null);
    const clientId = presenceClientId(safeSessionStorage(), () => crypto.randomUUID());
    const presence = new DeskPresence({
      now: Date.now,
      bridge,
      send: (state, source) => rpc.call("mobile.desk.beat", { clientId, state, source }),
    });
    // Recording a timestamp per event is cheap; a beat goes out only on a change or every BEAT_MS.
    const onInput = (event: Event) => { if (document.visibilityState === "visible" && realInput(event)) presence.input(); };
    for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { passive: true, capture: true });
    const unsubscribe = bridge?.experimental_onSystemActivity?.((activity) => presence.systemChanged(activity));
    void presence.tick();
    const timer = window.setInterval(() => void presence.tick(), CHECK_MS);
    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput, { capture: true });
    };
  }, [rpc]);
  return null;
}

function safeSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
