import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { ChatButton, openCompanion } from "@bb-studio/kit/app";
import type { rpcContract } from "./client-contract";
import { message } from "./bot-ui";

export function BotChat({ id, disabled, onError }: { id: string; disabled?: boolean; onError(error: string): void }) {
  const rpc = useRpc<typeof rpcContract>(), navigate = useBbNavigate();
  const [pending, setPending] = useState(false);
  const request = useRef(0), busy = useRef(false);
  useEffect(() => () => { request.current++; busy.current = false; }, [id]);
  const open = async (fresh: boolean) => {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    const sequence = ++request.current;
    try {
      const conversation = await rpc.call(fresh ? "newConversation" : "conversation", { id });
      if (request.current !== sequence) return;
      if (!openCompanion({ kind: "thread", threadId: conversation.threadId })) navigate.toThread(conversation.threadId);
    } catch (error) {
      if (request.current === sequence) onError(message(error));
    } finally {
      if (request.current === sequence) { busy.current = false; setPending(false); }
    }
  };
  return <ChatButton
    title="Continue this bot’s conversation"
    disabled={disabled || pending}
    onOpen={() => void open(false)}
    items={[{ label: "New conversation", icon: "MessageSquarePlus", onSelect: () => void open(true) }]}
  />;
}
