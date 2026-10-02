import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FLOATING, Icon, openCompanion } from "@bb-studio/kit/app";
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
  return <div className={`${FLOATING} flex h-8 shrink-0 items-center rounded-md text-sm text-muted-foreground`}>
    <button type="button" disabled={disabled || pending} onClick={() => void open(false)} title="Continue this bot’s conversation" className="flex h-full items-center gap-1.5 rounded-l-md pr-2 pl-2.5 hover:bg-state-hover hover:text-foreground disabled:opacity-50"><Icon name="MessageSquare" className="size-4" /> Chat</button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" aria-label="Chat options" disabled={disabled || pending} className="flex h-full items-center rounded-r-md px-1.5 hover:bg-state-hover hover:text-foreground disabled:opacity-50"><Icon name="ChevronDown" className="size-3.5" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void open(true)}><Icon name="MessageSquarePlus" className="size-4" /> New conversation</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
