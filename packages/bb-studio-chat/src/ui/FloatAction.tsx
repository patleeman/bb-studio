// Float icon in a thread's header: keeps this thread in the Studio chat
// while you go back to your pages and drawings.
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { cn, Icon } from "@bb-studio/kit/app";
import { floatThread, useChat } from "./store";

export function FloatAction({ threadId }: PluginThreadHeaderActionProps) {
  const { threadId: floating, mode } = useChat();
  const active = floating === threadId && mode !== "closed";
  return (
    <button
      type="button"
      aria-label="Float this thread in Studio Chat"
      title="Float this thread in Studio Chat"
      aria-pressed={active}
      className={cn(
        "studio-chat-float flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground",
        active && "text-foreground",
      )}
      onClick={() => floatThread(threadId)}
    >
      <Icon name="SideChat" className="size-4" />
    </button>
  );
}
