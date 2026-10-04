import { useAtom } from "jotai";
import { ActionMenuItem } from "../ui/action-menu-items.js";
import { sidebarHiddenThreadsAtom } from "../preferences/atoms.js";
import { useThreadListVisibilityGroupId } from "../list/ThreadListVisibility.js";
import { useHiddenThreadsState } from "./useHiddenThreads.js";

/** Hide, or Unhide for a hidden thread that is showing, in a thread's actions menu. */
export function HideThreadItem({ threadId, surface }: {
  threadId: string;
  surface: "context" | "dropdown";
}) {
  const [hiddenIds, setHiddenIds] = useAtom(sidebarHiddenThreadsAtom);
  const isHidden = hiddenIds.includes(threadId);
  return (
    <ActionMenuItem
      surface={surface}
      icon={isHidden ? "Eye" : "EyeOff"}
      onSelect={() => setHiddenIds((current) => isHidden
        ? current.filter((id) => id !== threadId)
        : current.includes(threadId) ? current : [...current, threadId])}
    >
      {isHidden ? "Unhide" : "Hide"}
    </ActionMenuItem>
  );
}

/**
 * The last row of a section that hides threads: Show reveals them until the
 * window reloads, and Hide puts them away again.
 */
export function HiddenThreadsRow() {
  const sectionKey = useThreadListVisibilityGroupId();
  const state = useHiddenThreadsState();
  if (!sectionKey || !state) return null;
  const count = state.hidden.get(sectionKey) ?? 0;
  if (count === 0) return null;
  const revealed = state.revealed.has(sectionKey);
  return (
    <div
      data-sidebar-hidden-threads={sectionKey}
      className="flex h-7 min-w-0 items-center gap-1 px-2 text-xs text-subtle-foreground max-md:pointer-coarse:h-9"
    >
      <span className="min-w-0 truncate">{revealed ? `Showing ${count} hidden` : `${count} hidden`}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label={revealed ? `Hide ${count} hidden` : `Show ${count} hidden`}
        onClick={() => state.setRevealed(sectionKey, !revealed)}
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </div>
  );
}
