// The areas' cards on the Strands page (src/strands/ui/StrandsPage.tsx),
// problems first.
import type { MouseEvent } from "react";
import type { AreaView } from "../contract";
import { AreaCard } from "./AreaCard";
import { areaOrder } from "./model";
import { noneOpen, type IsOpen } from "../../tasks/ui/open-row";

// The areas' cards. `workOf` says whether an area's lead is at work (a
// running strand in its conversation) and how many of its workers run.
export function AreasSection({ areas, error, workOf = () => ({ live: false, workers: 0 }), now, zone, query = false, onOpenTask, onOpenThread, isOpen = noneOpen }: { areas: readonly AreaView[] | null; query?: boolean; error: string | null; workOf?(area: AreaView): { live: boolean; workers: number }; now: number; zone?: string; onOpenTask(id: string, title: string, event?: MouseEvent): void; onOpenThread(threadId: string): void; isOpen?: IsOpen }) {
  const ordered = areas ? areaOrder(areas) : [];
  const problems = ordered.filter((a) => a.status === "broken" || a.status === "flagged").length;
  return (
    <section aria-labelledby="tasks-areas-head" data-testid="tasks-areas" className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 id="tasks-areas-head" className="text-sm font-semibold text-foreground">Areas</h2>
        {ordered.length ? <span className="text-xs text-subtle-foreground">{problems ? `${problems} need${problems === 1 ? "s" : ""} a look · problems first` : "all fine"}</span> : null}
      </div>
      {error && !areas ? <p role="alert" data-testid="areas-error" className="text-sm text-destructive">{error}</p> : null}
      {areas && !ordered.length ? <p data-testid="areas-empty" className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">{query ? "No areas match." : "No areas yet. Each runner and project lead gets a card here once it reports how its part is doing."}</p> : null}
      {ordered.length ? (
        <div data-testid="areas-grid" className="grid grid-cols-1 gap-3.5 @2xl/bot-page:grid-cols-2 @5xl/bot-page:grid-cols-3">
          {ordered.map((area) => { const work = workOf(area); return <AreaCard key={area.id} area={area} now={now} zone={zone} live={work.live} workers={work.workers} onOpenTask={onOpenTask} onOpenOwner={onOpenThread} isOpen={isOpen} />; })}
        </div>
      ) : null}
    </section>
  );
}

