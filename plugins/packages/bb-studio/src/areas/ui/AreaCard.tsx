import { Icon, cn } from "../../kit/ui/index";
import type { AreaStatus, AreaView } from "../contract";
import { areaWhen, areaWho, itemAge, OUTCOME_LABEL, openItems, runBars, STATUS_LABEL } from "./model";

const DOT: Record<AreaStatus, string> = { broken: "bg-destructive", flagged: "bg-warning", ok: "bg-success", unknown: "bg-muted-foreground/50" };
const BORDER: Record<AreaStatus, string> = {
  broken: "border-[color-mix(in_oklab,var(--destructive)_55%,transparent)]",
  flagged: "border-[color-mix(in_oklab,var(--warning)_45%,transparent)]",
  ok: "border-border/70",
  unknown: "border-border/70",
};
const BAR = { ok: "bg-success/60", flagged: "bg-warning", broken: "bg-destructive" } as const;

export type AreaCardProps = {
  area: AreaView;
  now: number;
  zone?: string;
  live?: boolean;
  workers?: number;
  onOpenTask?(id: string, title: string): void;
  onOpenOwner?(threadId: string): void;
};

export function ownerThreadOf(area: Pick<AreaView, "owner">): string | null {
  return area.owner.kind === "lead" ? area.owner.thread : area.owner.kind === "runner" ? area.owner.thread : null;
}

export function AreaCard({ area, now, zone, live = false, workers = 0, onOpenTask, onOpenOwner }: AreaCardProps) {
  const items = openItems(area.open);
  const bars = runBars(area.runs);
  const when = areaWhen(area, now, zone);
  const who = areaWho(area, workers);
  const owner = ownerThreadOf(area);
  const status = STATUS_LABEL[area.status];
  const headingId = `area-${area.id}`;
  return (
    <article data-testid="area-card" data-area={area.id} data-status={area.status} data-studio-card="" aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col rounded-2xl border bg-card px-4 py-3.5 text-sm", BORDER[area.status])}>
      <header className="flex min-w-0 items-center gap-2">
        <span role="img" aria-label={live ? `${status}, working now` : status} data-testid="area-dot" className={cn("size-2.5 shrink-0 rounded-full", DOT[area.status], live && "shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_25%,transparent)]")} />
        <h3 id={headingId} className="min-w-0 truncate text-[15px] font-semibold text-foreground">{area.name}</h3>
        {owner && onOpenOwner
          ? <button type="button" data-testid="area-who" onClick={() => onOpenOwner(owner)} aria-label={`Open ${area.ownerName}`} className="ml-auto min-w-0 truncate rounded text-xs text-subtle-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{who}</button>
          : <span data-testid="area-who" className="ml-auto min-w-0 truncate text-xs text-subtle-foreground">{who}</span>}
      </header>
      {area.covers ? <p data-testid="area-covers" className="mt-0.5 line-clamp-1 text-xs text-subtle-foreground">{area.covers}</p> : null}
      {area.reason ? <p data-testid="area-reason" className={cn("mt-1.5 line-clamp-2 text-xs", area.status === "broken" ? "text-destructive" : "text-warning")}>{area.reason}</p> : null}
      <p data-testid="area-now" className={cn("mt-3 line-clamp-3 leading-snug", area.now ? "text-foreground" : "text-muted-foreground")}>{area.now ?? (area.status === "unknown" ? "No report yet." : "Nothing new.")}</p>
      <h4 className="mt-3.5 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle-foreground">Open · {area.open.length}</h4>
      <ul data-testid="area-open" className="flex flex-col">
        {items.shown.length ? items.shown.map((item, i) => {
          const age = itemAge(item, now, zone);
          const title = <><span className="min-w-0 flex-1 truncate">{item.needsUser ? <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-warning align-[1px]" /> : null}{item.title}</span>{age ? <span className="shrink-0 text-[11.5px] text-subtle-foreground">{age}</span> : null}</>;
          const label = `${item.title}${item.needsUser ? ", needs you" : ""}${age ? `, ${age}` : ""}`;
          const row = cn("flex min-w-0 items-baseline gap-2.5 py-0.5 text-[12.5px]", item.needsUser ? "text-foreground" : "text-muted-foreground");
          return (
            <li key={`${item.title}-${i}`} data-testid="area-item" data-needs-you={item.needsUser || undefined}>
              {item.taskId && onOpenTask
                ? <button type="button" onClick={() => onOpenTask(item.taskId!, item.title)} aria-label={label} className={cn(row, "w-full cursor-pointer rounded text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{title}</button>
                : <span aria-label={label} className={row}>{title}</span>}
            </li>
          );
        }) : <li className="py-0.5 text-[12.5px] text-subtle-foreground">Nothing open</li>}
        {items.more ? <li data-testid="area-more" className="py-0.5 text-xs text-subtle-foreground">+{items.more} more</li> : null}
      </ul>
      <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 pt-3.5 text-[11.5px] text-subtle-foreground">
        {bars.length ? (
          <ol data-testid="area-runs" aria-label={`Last ${bars.length} run${bars.length === 1 ? "" : "s"}, oldest first, newest last: ${bars.map((run) => OUTCOME_LABEL[run.outcome]).join(", ")}`} className="mr-auto flex items-center gap-[3px]">
            {bars.map((run, i) => <li key={`${run.at}-${i}`} data-testid="area-run" data-outcome={run.outcome} title={`${new Date(run.at).toLocaleString()}: ${run.line || OUTCOME_LABEL[run.outcome]}`} className={cn("h-3.5 w-2 rounded-[2px]", BAR[run.outcome])} />)}
          </ol>
        ) : <span className="mr-auto">No runs yet</span>}
        <span data-testid="area-when" className="flex min-w-0 items-center gap-1 whitespace-nowrap">
          {when.last ? <>Last <b className="font-medium text-muted-foreground">{when.last}</b></> : null}
          {when.last && when.next ? <span aria-hidden>·</span> : null}
          {when.next ? <>{area.paused ? <Icon name="Pause" aria-hidden className="size-3" /> : when.nextLabel} <b className="font-medium text-muted-foreground">{when.next}</b></> : null}
        </span>
      </footer>
    </article>
  );
}
