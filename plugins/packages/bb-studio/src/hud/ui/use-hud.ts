// What the HUD needs when no conversation is named: the primary Bot (its chat
// is the HUD's thread) and whether it is working.
// The chat itself is BB's own component, which keeps itself current. This is
// reloaded when Studio says something changed (a thread started or settled),
// when the window is shown again, and on a slow timer while the Bot works,
// so "working" clears.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../kit/format";
import { STUDIO_REALTIME_CHANNEL } from "../../kit/contract";
import type { hudContract } from "../contract";

const WORKING_POLL_MS = 5000;

export interface HudBot { id: string; name: string; threadId: string | null }

export interface HudView {
  /** Undefined until the first answer; null before a Bot is made. */
  bot: HudBot | null | undefined;
  working: boolean;
  error: string | null;
}

export function useHud(): HudView {
  const rpc = useRpc<typeof hudContract>();
  const [data, setData] = useState<{ bot: HudBot | null; working: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(() => {
    const mine = ++generation.current;
    return rpc.call("hud.get", null).then(
      (answer) => { if (mine === generation.current) { setData(answer); setError(null); } },
      (cause: unknown) => { if (mine === generation.current) setError(errorMessage(cause)); },
    );
  }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => void load(), 250); }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, soon);
  const working = data?.working ?? false;
  useEffect(() => {
    const shown = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", shown);
    const poll = working ? setInterval(shown, WORKING_POLL_MS) : undefined;
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", shown); };
  }, [load, working]);
  return { bot: data ? data.bot : undefined, working, error };
}
