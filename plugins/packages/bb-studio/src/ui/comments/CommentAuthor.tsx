import { Icon } from "../../kit/ui/index";
import { BotFace } from "../../presence/ui/BotFace";
import { useLive } from "../live";

const SIZE = 20;

function Name({ children }: { children: string }) {
  return <span data-author-name="" className="min-w-0 truncate text-sm font-medium">{children}</span>;
}

export function CommentAuthor({ authorId }: { authorId: string }) {
  const threadId = authorId.startsWith("agent:thr_") ? authorId.slice("agent:".length) : "";
  const owner = useLive("bot_thread_owner", { threadId: threadId || "none" }, { enabled: !!threadId, pollMs: 300_000 });
  const botId = owner.data?.botId ?? null;
  const view = useLive("bot_get", botId ? { botId } : {}, { enabled: !!botId, pollMs: 300_000 });
  const bot = view.data?.bot ?? null;

  if (authorId === "user") {
    return (
      <span className="inline-flex min-w-0 items-center gap-2" data-author="you">
        <span data-author-avatar="" aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold">Y</span>
        <Name>You</Name>
      </span>
    );
  }
  if (bot) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2" data-author="bot" data-bot-id={bot.id}>
        <span data-author-avatar="" className="flex shrink-0"><BotFace botId={bot.id} size={SIZE} /></span>
        <Name>{bot.name}</Name>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-author="agent">
      <span data-author-avatar="" aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10"><Icon name="Bot" className="size-3" /></span>
      <Name>{authorId.startsWith("bot:") ? "Former bot" : "Agent"}</Name>
    </span>
  );
}
