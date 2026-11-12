// A dashboard in the thread's Studio tab, beside the conversation. Loaded on
// demand by the tab. The grid sizes to the panel (useContainerWidth), so a
// narrow panel gets the md/sm layout, and useDashboard's heartbeat counts the
// tab as viewing, so widgets refresh and scripts can be approved here.
import { BarTitle, ICON_BUTTON, Icon } from "../../kit/app/index";
import { DashboardBoard } from "./dashboard-view";
import { useDashboard } from "./use-dashboard";

/** Just the toolbar and grid: the conversation is already beside it. */
export function TabDashboard({ dashboardId, backLabel, onBack }: { dashboardId: string; backLabel: string; onBack(): void }) {
  const state = useDashboard(dashboardId);
  const { dashboard } = state;
  if (dashboard === null) return <p className="p-4 text-sm text-muted-foreground">This dashboard was deleted.</p>;
  const leading = (
    <>
      <button type="button" aria-label={`Back to ${backLabel}`} title={`Back to ${backLabel}`} className={ICON_BUTTON} onClick={onBack}>
        <Icon name="ArrowLeft" className="size-4" />
      </button>
      <div className="max-w-56 min-w-0">
        <BarTitle key={`${dashboardId}:${dashboard?.name ?? ""}`} title={dashboard?.name ?? ""} label="Dashboard name" placeholder="Untitled dashboard" disabled={!dashboard} onRename={state.rename} />
      </div>
    </>
  );
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground" data-dashboard-tab>
      {dashboard ? <DashboardBoard dashboard={dashboard} state={state} leading={leading} /> : null}
    </div>
  );
}
