// Studio's star host (../kit/app/item-star.ts): knows which items are
// starred, for every item header's star toggle, and stars or unstars them.
// Mounted once per window as an app overlay; it draws nothing.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract } from "../contract";
import { itemKey, itemStarsChanged, setItemStarHost, type ItemStarHost } from "../kit/app/index";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { errorMessage } from "../kit/format";

export function StarHost() {
  const rpc = useRpc<typeof rpcContract>();
  // null until the stars have loaded.
  const [starred, setStarred] = useState<ReadonlySet<string> | null>(null);
  const current = useRef(starred);
  current.current = starred;
  const generation = useRef(0);
  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const { items } = await rpc.call("starred", null);
      if (mine === generation.current) setStarred(new Set(items.map(itemKey)));
    } catch {
      // Headers keep the last known stars; the next change reloads them.
    }
  }, [rpc]);
  useEffect(() => { void load(); }, [load]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 300);
  });
  useEffect(() => itemStarsChanged(), [starred]);
  useEffect(() => {
    const host: ItemStarHost = {
      starred: (ref) => current.current?.has(itemKey(ref)),
      set: async (ref, star) => {
        // Show it now; the reload confirms it.
        generation.current++;
        setStarred((previous) => {
          const next = new Set(previous ?? []);
          if (star) next.add(itemKey(ref)); else next.delete(itemKey(ref));
          return next;
        });
        try {
          await rpc.call("starItems", { items: [{ pluginId: ref.pluginId, id: ref.id }], starred: star });
        } catch (cause) {
          toast.error(`Couldn't ${star ? "star" : "unstar"} it: ${errorMessage(cause)}`);
        } finally {
          void load();
        }
      },
    };
    return setItemStarHost(host);
  }, [rpc, load]);
  return null;
}
