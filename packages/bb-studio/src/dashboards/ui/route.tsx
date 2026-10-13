// One dashboard as a Studio page: /plugins/studio/studio/dashboards/<id>, in
// a workspace tab or the main view. Loaded on demand by app.tsx: it brings
// the grid and the charts.
import { openAppPath, WORKSPACE_PATH } from "@bb-studio/kit/app";
import { openCollection } from "../../ui/StudioPanel";
import { DashboardPage } from "./dashboard-view";

export default function DashboardRoute({ id }: { id: string }) {
  return (
    <DashboardPage
      key={id}
      dashboardId={id}
      backLabel="Studio"
      onBack={(replace) => {
        openCollection("dashboard");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
