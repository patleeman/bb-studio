import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";

/** A compact directive link with the same loading and deleted states in every add-on. */
export function ItemDirectiveCard({
  state,
  kind,
  icon,
  title,
  preview,
  details,
  onOpen,
}: {
  state: "loading" | "deleted" | "ready";
  kind: string;
  icon: string;
  title?: string;
  preview?: ReactNode;
  details?: ReactNode;
  onOpen?(): void;
}) {
  if (state === "deleted") {
    return <div className="my-2 flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground">
      <Icon name={icon} className="size-4" /> This {kind} was deleted.
    </div>;
  }
  if (state === "loading") {
    return <div className="my-2 h-14 max-w-md animate-pulse rounded-lg border border-border/70 bg-muted/40 motion-reduce:animate-none" />;
  }
  return (
    <button type="button" onClick={onOpen} className={cn(
      "group my-2 flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border/70 bg-background text-left hover:border-border hover:bg-state-hover",
    )}>
      {preview}
      <div className="flex w-full items-center gap-3 px-3 py-2.5">
        {preview ? null : <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name={icon} className="size-4" />
        </div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{details}</div>
        </div>
        <Icon name="ArrowUpRight" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </div>
    </button>
  );
}
