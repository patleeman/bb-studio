// Needs you rows' Mark handled (docs/needs-you/REDO.md): a hover ✕ with a
// tooltip and a context-menu item. The row leaves at once; the server keeps
// it out (bot_needs_you_dismiss) until what it waits on changes, and the
// toast's Undo brings it back (bot_needs_you_restore).
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, Icon, Tooltip } from "../../kit/ui/index";
import type { BotThreadView } from "../../contract";
import { useCall } from "../live";

export type MarkHandled = (thread: Pick<BotThreadView, "id" | "title">, label?: string) => void;

/**
 * Mark handled for one Bot's Needs you. `threads` is its Needs you as the
 * server last sent it; `shown` is that less the rows marked handled here,
 * each hidden until the server stops sending it (so a new question on the
 * same thread later shows again). `refresh` reloads the Bot's activity.
 */
export function useMarkHandled<T extends Pick<BotThreadView, "id">>(botId: string, threads: readonly T[], refresh: () => void): { shown: T[]; markHandled: MarkHandled } {
  const call = useCall();
  // id → whether the server has it recorded yet.
  const [hidden, setHidden] = useState<ReadonlyMap<string, boolean>>(new Map());
  const set = (id: string, state: boolean | null) => setHidden((current) => {
    const next = new Map(current);
    if (state === null) next.delete(id); else next.set(id, state);
    return next;
  });
  const listed = threads.map((thread) => thread.id).join(",");
  useEffect(() => {
    const ids = new Set(listed.split(","));
    if ([...hidden].some(([id, recorded]) => recorded && !ids.has(id))) setHidden(new Map([...hidden].filter(([id, recorded]) => !recorded || ids.has(id))));
  }, [listed, hidden]);
  const markHandled: MarkHandled = (thread, label = thread.title) => {
    set(thread.id, false);
    call("bot_needs_you_dismiss", { botId, threadId: thread.id }).then(
      () => {
        set(thread.id, true);
        refresh();
        toast(`Marked handled: ${label}`, {
          action: {
            label: "Undo",
            onClick: () => {
              set(thread.id, null);
              call("bot_needs_you_restore", { botId, threadId: thread.id }).then(refresh, (error: unknown) => toast.error(`Couldn't undo: ${message(error)}`));
            },
          },
        });
      },
      (error: unknown) => {
        set(thread.id, null);
        toast.error(`Couldn't mark it handled: ${message(error)}`);
      },
    );
  };
  return { shown: threads.filter((thread) => !hidden.has(thread.id)), markHandled };
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The hover ✕ on a Needs you row. */
export function HandledButton({ label, onClick, className = "inline-flex" }: { label: string; onClick(): void; /** Its display (it's hidden until hover in a row). */ className?: string }) {
  return (
    <Tooltip label="Mark handled" side="right">
      <button type="button" aria-label={`Mark ${label} handled`} data-testid="needs-you-handled"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(); }}
        className={`size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:inline-flex ${className}`}>
        <Icon name="X" className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** A Needs you row's right-click menu: Open, Mark handled. */
export function NeedsYouMenu({ onOpen, onHandled, children }: { onOpen(): void; onHandled(): void; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={onOpen}><Icon name="ArrowUpRight" />Open</ContextMenuItem>
        <ContextMenuItem onSelect={onHandled}><Icon name="Check" />Mark handled</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
