// A group of rows on a Bot page under its heading and count ("Today 3"),
// optionally collapsible. The heading can be a node (the Library's
// conversation groups open their conversation); `label` then names it.
import { useState, type ReactNode } from "react";
import { Icon } from "../../kit/ui/icon";
import { cn } from "../../kit/ui/utils";

export function BotPageGroup({ title, label, count, aside, collapsible = false, defaultOpen = true, testId, children }: {
  title: ReactNode;
  /** The group's accessible name, when the title isn't a string. */
  label?: string;
  count?: number;
  /** Small text or a control at the heading's right. */
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const name = label ?? (typeof title === "string" ? title : undefined);
  const shown = !collapsible || open;
  const heading = <>
    <span className="min-w-0 truncate">{title}</span>
    {count !== undefined ? <span data-testid="bot-page-group-count" className="shrink-0 font-normal tabular-nums text-muted-foreground">{count}</span> : null}
  </>;
  return (
    <section aria-label={name} data-testid={testId ?? "bot-page-group"} data-open={shown} className="flex flex-col">
      <div className="flex h-8 items-center gap-2 border-b border-border px-2 text-xs font-semibold text-muted-foreground">
        {collapsible ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-ml-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
            {heading}
          </button>
        ) : <h2 className="flex min-w-0 items-center gap-2">{heading}</h2>}
        {aside ? <span className="ml-auto flex shrink-0 items-center gap-2 font-normal">{aside}</span> : null}
      </div>
      {shown ? <div className="flex flex-col gap-px pt-1">{children}</div> : null}
    </section>
  );
}

export function BotPageMore({ count, group, onOpen, testId }: { count: number; group: string; onOpen(): void; testId?: string }) {
  return (
    <button type="button" data-testid={testId ?? "bot-page-more"} onClick={onOpen}
      className="flex h-8 items-center rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none">{count} more in {group}</button>
  );
}
