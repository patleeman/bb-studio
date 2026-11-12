import { toast } from "sonner";
import { registerMessageAction, type MessageActionMessage } from "../../kit/app/host-sdk";
import { errorMessage } from "../../kit/format";
import { isBotThread } from "./bot-thread-owners";

export const FORK_FROM_HERE = "Fork conversation from here";

export interface ForkDeps {
  call(method: "bot_fork_conversation", input: { threadId: string; messageId: string; turnId: string | null; sourceSeqEnd: number }): Promise<{ threadId: string }>;
  open(threadId: string, sourceThreadId: string): void;
}

export async function forkFromHere(message: MessageActionMessage, deps: ForkDeps): Promise<string | null> {
  try {
    const { threadId } = await deps.call("bot_fork_conversation", { threadId: message.threadId, messageId: message.messageId, turnId: message.turnId, sourceSeqEnd: message.sourceSeqEnd });
    deps.open(threadId, message.threadId);
    return threadId;
  } catch (cause) {
    console.warn("Fork conversation failed", errorMessage(cause));
    toast.error("Couldn't fork the conversation.");
    return null;
  }
}

export function registerForkFromHere(slots: object, deps: ForkDeps): boolean {
  return registerMessageAction(slots, {
    id: "fork-conversation",
    title: FORK_FROM_HERE,
    icon: "GitFork",
    isAvailable: (message) => Number.isFinite(message.sourceSeqEnd) && message.sourceSeqEnd >= 0 && isBotThread(message.threadId),
    experimental_replaces: "thread.fork",
    run: (message) => { void forkFromHere(message, deps); },
  });
}
