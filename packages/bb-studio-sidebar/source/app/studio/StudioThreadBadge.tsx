import { useThreadBadge } from "@bb-studio/kit/app";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A Studio app's mark before a thread's title, such as the avatar of the bot
 * the thread works as, and an amber dot while the thread needs the user (a
 * pending question or approval). Most threads have neither and keep their usual inset.
 */
export function StudioThreadBadge({ threadId, needsYou = false }: { threadId: string; needsYou?: boolean }) {
  const badge = useThreadBadge(threadId);
  const dot = needsYou ? (
    <span
      data-sidebar-needs-you=""
      role="img"
      aria-label="Needs you"
      title="Needs you"
      className="mr-1.5 size-1.5 shrink-0 rounded-full bg-warning"
    />
  ) : null;
  if (!badge) return dot;
  return (
    <>
    {dot}
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
    </>
  );
}
