import { useThreadBadge } from "@bb-studio/kit/app";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

/**
 * A Studio app's mark before a thread's title, such as the avatar of the bot
 * the thread works as. Most threads have none and keep their usual inset.
 */
export function StudioThreadBadge({ threadId }: { threadId: string }) {
  const badge = useThreadBadge(threadId);
  if (!badge) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sidebar-thread-badge=""
          role="img"
          aria-label={badge.label}
          className="pointer-events-auto relative z-[31] mr-1.5 flex size-4 shrink-0 items-center justify-center text-[13px] leading-none"
        >
          {badge.glyph}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{badge.label}</TooltipContent>
    </Tooltip>
  );
}
