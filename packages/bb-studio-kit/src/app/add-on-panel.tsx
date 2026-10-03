import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useState, type ReactNode } from "react";
import type { StudioSchemas } from "../contract";
import { AddOnCollection, type ProviderCall } from "./add-on";
import { openAppPath, studioPath } from "./nav";
import { useStudioPresent } from "./presence";

/** The common RPC, realtime, and back navigation for an add-on panel. */
export function useAddOnPanel(channel: string, panelPath: string, kind: string, rpcPrefix = "") {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call((rpcPrefix + method) as typeof method, input as never) as never, [rpc, rpcPrefix]);
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const [refreshKey, setRefreshKey] = useState(0);
  useRealtime(channel, () => setRefreshKey((current) => current + 1));
  const toCollection = useCallback(
    (replace = false) =>
      studio ? openAppPath(studioPath(kind), { replace }) : navigate.toPluginPanel(panelPath, { subPath: "", replace }),
    [kind, navigate, panelPath, studio],
  );
  return { call, refreshKey, studio, toCollection };
}

export function AddOnPanel({
  subPath,
  pluginId,
  title,
  kind,
  panelPath,
  channel,
  isItemId,
  renderItem,
  handOver,
  headerActions,
}: {
  subPath: string;
  pluginId: string;
  title: string;
  kind: string;
  panelPath: string;
  channel: string;
  isItemId(id: string): boolean;
  renderItem(id: string, options: { backLabel: string; onBack(replace?: boolean): void }): ReactNode;
  handOver?: boolean;
  headerActions?: ReactNode;
}) {
  const { call, refreshKey, studio, toCollection } = useAddOnPanel(channel, panelPath, kind);
  const [id = ""] = subPath.split("/").filter(Boolean);
  if (isItemId(id)) return <>{renderItem(id, { backLabel: studio ? "Studio" : title, onBack: toCollection })}</>;
  return (
    <AddOnCollection
      pluginId={pluginId}
      title={title}
      kind={kind}
      call={call}
      refreshKey={refreshKey}
      handOver={handOver}
      headerActions={headerActions}
    />
  );
}
