import { useEffect, useRef } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./contract";
import { saveChannelThreadHandoff } from "./handoff-draft";

const eventName = "bb:bots:handoff-to-channel";

type ChannelHandoffRequest = {
  /** The thread the channel continues from, linked at the top of its draft. */
  threadId: string | null;
  /** Bots invited to the new channel. */
  memberIds: string[];
  /** Text typed in the composer that started the handoff. */
  draft: string;
};

export function requestChannelHandoff(threadId: string | null, memberIds: string[] = [], draft = "") {
  const detail: ChannelHandoffRequest = { threadId, memberIds, draft };
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function ChannelHandoffController() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pending = useRef(false);

  useEffect(() => {
    const handoff = async (event: Event) => {
      const request = (event as CustomEvent<ChannelHandoffRequest | undefined>).detail;
      if (!request || (!request.threadId && !request.memberIds.length) || pending.current) return;
      pending.current = true;
      try {
        const source = request.threadId
          ? await rpc.call("handoffSource", { threadId: request.threadId })
          : null;
        const room = await rpc.call("createRoom", { memberIds: request.memberIds });
        const channel = await rpc.call("openChannelThread", { id: room.id });
        // The new channel thread's composer picks this up and pre-fills its draft.
        saveChannelThreadHandoff(channel.threadId, { source, draft: request.draft });
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
