import { useAtom } from "jotai";
import { ActionMenuItem } from "../ui/action-menu-items.js";
import { sidebarHiddenThreadsAtom } from "../preferences/atoms.js";
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
 * Show or hide a section's hidden threads, in its ⋯ menu. Showing lasts until
 * the window reloads. Nothing when the section hides none.
 */
export function HiddenThreadsMenuItem({ sectionKey, surface = "dropdown" }: {
  sectionKey: string;
  surface?: "context" | "dropdown";
}) {
  const state = useHiddenThreadsState();
  const count = state?.hidden.get(sectionKey) ?? 0;
  if (!state || count === 0) return null;
  const revealed = state.revealed.has(sectionKey);
  return (
    <ActionMenuItem
      surface={surface}
      icon={revealed ? "EyeOff" : "Eye"}
      onSelect={() => state.setRevealed(sectionKey, !revealed)}
    >
      {revealed ? "Hide hidden threads" : `Show ${count} hidden ${count === 1 ? "thread" : "threads"}`}
    </ActionMenuItem>
  );
}
