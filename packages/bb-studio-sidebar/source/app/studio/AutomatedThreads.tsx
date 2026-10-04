import { useAtom } from "jotai";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { sidebarAutomatedThreadsAtom } from "../preferences/atoms.js";
import { useThreadListVisibilityGroupId } from "../list/ThreadListVisibility.js";
import type { AutomatedThreadsMode } from "../../shared/preferences.js";
import { automatedModeFor } from "./automated-threads.js";
import { useAutomatedThreadsState } from "./useAutomatedThreads.js";

// BB's icon falls back to a lightning bolt for names it doesn't know.
const MARKS = {
  automation: { icon: "Clock", label: "Automation thread" },
  bot: { icon: "Bot", label: "Bot thread" },
} as const;

/** A small clock or bot before an automated thread's title. */
export function AutomatedThreadMark({ threadId }: { threadId: string }) {
  const kind = useAutomatedThreadsState()?.kinds.get(threadId);
  if (!kind) return null;
  const mark = MARKS[kind];
  return (
    <span
      data-sidebar-automated-mark={kind}
      data-automated-thread-id={threadId}
      title={mark.label}
      className="mr-1 inline-flex size-3.5 shrink-0 items-center justify-center text-subtle-foreground"
    >
      <Icon name={mark.icon} aria-label={mark.label} className="size-3.5" />
    </span>
  );
}

function plural(count: number): string {
  return `${count} automated thread${count === 1 ? "" : "s"}`;
}

/**
 * The last row of a section whose Automated threads choice hides some:
 * Show reveals them until reload, and Hide puts them away again.
 */
export function AutomatedHiddenRow() {
  const sectionKey = useThreadListVisibilityGroupId();
  const state = useAutomatedThreadsState();
  if (!sectionKey || !state) return null;
  const count = state.hidden.get(sectionKey) ?? 0;
  if (count === 0) return null;
  const revealed = state.revealed.has(sectionKey);
  return (
    <div
      data-sidebar-automated-hidden={sectionKey}
      className="flex h-7 min-w-0 items-center gap-1 px-2 text-xs text-subtle-foreground max-md:pointer-coarse:h-9"
    >
      <span className="min-w-0 truncate">{revealed ? `Showing ${plural(count)}` : `${plural(count)} hidden`}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label={revealed ? `Hide ${plural(count)}` : `Show ${plural(count)}`}
        onClick={() => state.setRevealed(sectionKey, !revealed)}
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </div>
  );
}

const OPTIONS: ReadonlyArray<readonly [AutomatedThreadsMode, string]> = [
  ["all", "Show all"],
  ["updates", "Only with updates"],
  ["hidden", "Hide"],
];

/** Automated threads: Show all / Only with updates / Hide, in a section's ⋯ menu. */
export function AutomatedThreadsMenuItems({ sectionKey }: { sectionKey: string | undefined }) {
  const [preferences, setPreferences] = useAtom(sidebarAutomatedThreadsAtom);
  const state = useAutomatedThreadsState();
  if (!sectionKey || sectionKey === "pinned") return null;
  const mode = automatedModeFor(preferences, sectionKey);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup aria-label="Automated threads">
        <DropdownMenuLabel>Automated threads</DropdownMenuLabel>
        {OPTIONS.map(([value, label]) => (
          <DropdownMenuItem
            key={value}
            role="menuitemradio"
            aria-checked={mode === value}
            onSelect={(event) => {
              event.preventDefault();
              setPreferences((current) => ({ ...current, [sectionKey]: value }));
              state?.setRevealed(sectionKey, false);
            }}
          >
            {label}
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {mode === value && <Icon name="Check" className="size-4" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}
