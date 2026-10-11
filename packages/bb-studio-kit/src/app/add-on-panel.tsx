import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useState, type ReactNode } from "react";
import type { StudioSchemas } from "../contract";
import { AddOnCollection, type ProviderCall } from "./add-on";
import { openAppPath, studioPath } from "./nav";

/** The common RPC, realtime, and back navigation for an add-on panel. */
export function useAddOnPanel(channel: string, kind: string) {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call(method, input as never) as never, [rpc]);
  const [refreshKey, setRefreshKey] = useState(0);
  useRealtime(channel, () => setRefreshKey((current) => current + 1));
  const toCollection = useCallback((replace = false) => openAppPath(studioPath(kind), { replace }), [kind]);
  return { call, refreshKey, toCollection };
}

export function AddOnPanel({
  subPath,
  pluginId,
  title,
  kind,
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
  channel: string;
  isItemId(id: string): boolean;
  renderItem(id: string, options: { backLabel: string; onBack(replace?: boolean): void }): ReactNode;
  handOver?: boolean;
  headerActions?: ReactNode;
}) {
  const { call, refreshKey, toCollection } = useAddOnPanel(channel, kind);
  const [id = ""] = subPath.split("/").filter(Boolean);
  if (isItemId(id)) return <>{renderItem(id, { backLabel: "Studio", onBack: toCollection })}</>;
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
