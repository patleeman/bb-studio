// The Dashboards tab in a thread's workbench. It shows one dashboard beside
// the conversation; opened without one, it lists the thread's dashboards,
// then recent ones, and search finds any. Loaded on demand by app.tsx.
// The grid sizes to the panel (useContainerWidth), so a narrow panel gets the
// md/sm layout, and useDashboard's heartbeat counts the tab as viewing, so
// widgets refresh and scripts can be approved here.
import { useMemo } from "react";
import { BarTitle, ICON_BUTTON, Icon, ThreadItemsPanel, type ProviderCall } from "@bb-studio/kit/app";
import { STUDIO_PROVIDER_CALL_METHOD } from "@bb-studio/kit/contract";
import { useRpc, type JsonValue } from "@get-bb/plugin-sdk/app";
import type { builtinProviderContract } from "../../builtin-provider";
import { DASHBOARD_KIND, PLUGIN_ID, REALTIME_CHANNEL, isDashboardId } from "../shared";
import { DashboardBoard } from "./dashboard-view";
import { useDashboard } from "./use-dashboard";

export function dashboardParam(params: JsonValue | null): string | null {
  const value = params && typeof params === "object" && !Array.isArray(params) ? params.dashboardId : null;
  return typeof value === "string" && isDashboardId(value) ? value : null;
}

/** Dashboards' `studio_*` methods, through Studio's provider.call. */
function useDashboardProvider(): ProviderCall {
  const rpc = useRpc<typeof builtinProviderContract>();
  return useMemo(() => ((method, input) => rpc.call(STUDIO_PROVIDER_CALL_METHOD, { pluginId: PLUGIN_ID, method, input })) as ProviderCall, [rpc]);
}

export default function DashboardsTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const call = useDashboardProvider();
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind={DASHBOARD_KIND}
      channel={REALTIME_CHANNEL}
      call={call}
      initialId={dashboardParam(params)}
      renderItem={(id, { backLabel, onBack }) => <TabDashboard key={id} dashboardId={id} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

/** Just the toolbar and grid: the conversation is already beside it. */
function TabDashboard({ dashboardId, backLabel, onBack }: { dashboardId: string; backLabel: string; onBack(): void }) {
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
