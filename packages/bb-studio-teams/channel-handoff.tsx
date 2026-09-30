import { useEffect, useRef } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./contract";
import { saveChannelThreadHandoff } from "./handoff-draft";

const eventName = "bb:bots:handoff-to-channel";

export function requestChannelHandoff(threadId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: threadId }));
}

export function ChannelHandoffController() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pending = useRef(false);

  useEffect(() => {
    const handoff = async (event: Event) => {
      const threadId = (event as CustomEvent<unknown>).detail;
      if (typeof threadId !== "string" || !threadId || pending.current) return;
      pending.current = true;
      try {
        const source = await rpc.call("handoffSource", { threadId });
        const room = await rpc.call("createRoom", { memberIds: [] });
        const channel = await rpc.call("openChannelThread", { id: room.id });
        // The new channel thread's composer picks this up and pre-fills its draft.
        saveChannelThreadHandoff(channel.threadId, source);
        navigate.toThread(channel.threadId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not open a channel.",
        );
      } finally {
        pending.current = false;
      }
    };
    window.addEventListener(eventName, handoff);
    return () => window.removeEventListener(eventName, handoff);
  }, [rpc, navigate]);

  return null;
}
