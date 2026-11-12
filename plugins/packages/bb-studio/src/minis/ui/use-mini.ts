// One mini app, loaded and kept current: its tab, page blocks and chat cards
// share it. It reloads when the source, grants or anything else changes.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MiniView, rpcContract } from "../contract";
import { REALTIME_CHANNEL } from "../shared";

export type MiniRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export function useMini(miniId: string): { mini: MiniView | null | undefined; reload(): void; rpc: MiniRpc } {
  const rpc = useRpc<typeof rpcContract>();
  const [mini, setMini] = useState<MiniView | null | undefined>(undefined);
  const latest = useRef(0);
  const reload = useCallback(() => {
    const request = ++latest.current;
    rpc.call("minis.get", { id: miniId }).then(
      (result) => { if (request === latest.current) setMini(result.mini); },
      () => { if (request === latest.current) setMini(null); },
    );
  }, [rpc, miniId]);
  useEffect(() => {
    setMini(undefined);
    reload();
  }, [reload]);
  // Record writes also say "changed"; a burst of them reloads once.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; miniId?: string } | null;
    if (event?.miniId !== miniId) return;
    if (event.type === "source" || event.type === "grants") reload();
    else if (event.type === "changed") {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(reload, 800);
    }
  });
  return { mini, reload, rpc };
}
