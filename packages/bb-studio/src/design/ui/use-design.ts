// One design, loaded and kept current: the canvas, the thread tab and reply cards share it.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { DESIGN_UPDATE_TYPE, REALTIME_CHANNEL, type DesignView } from "../shared";

/** Loads a design and follows its changes. `design` is undefined while loading and null once deleted. */
export function useDesign(designId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [design, setDesign] = useState<DesignView | null | undefined>(undefined);
  /** Only the newest load wins when changes arrive quickly. */
  const latest = useRef(0);
  const seen = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const { design: next } = await rpc.call("designs.getDesign", { id: designId });
      if (ticket !== latest.current) return;
      seen.current = next?.updatedAt ?? 0;
      setDesign(next as DesignView | null);
    } catch (error) {
      if (ticket === latest.current) toast.error(errorMessage(error));
    }
  }, [designId, rpc]);

  useEffect(() => { void load(); }, [load]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; designId?: string; updatedAt?: number } | null;
    if (event?.type !== DESIGN_UPDATE_TYPE || event.designId !== designId) return;
    if (event.updatedAt !== undefined && event.updatedAt <= seen.current) return;
    void load();
  });

  const rename = useCallback((next: string) => {
    const name = next.trim();
    setDesign((current) => {
      if (!current || name === current.name.trim()) return current;
      void rpc.call("designs.renameDesign", { id: designId, name }).catch((error) => toast.error(errorMessage(error)));
      return { ...current, name };
    });
  }, [designId, rpc]);

  return { design, rename };
}
