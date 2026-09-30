// The Drawings nav panel: Studio's collection at the root, and one drawing's
// editor at `<drawing id>`. With Studio installed, back leads to Studio.
import { useCallback, useState } from "react";
import { AddOnCollection, openAppPath, studioPath, useStudioPresent, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isDrawingId } from "../src/shared";
import { DrawingEditor } from "./drawing-editor";

export function DrawingsPanel({ subPath }: { subPath: string }) {
  const studioRpc = useRpc<StudioSchemas["provider"]>();
  const callStudio = useCallback<ProviderCall>((method, input) => studioRpc.call(method, input as never) as never, [studioRpc]);
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const [drawingId = ""] = subPath.split("/").filter(Boolean);
  const [version, setVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, () => setVersion((current) => current + 1));

  const toCollection = useCallback(
    (replace = false) =>
      studio ? openAppPath(studioPath("drawing"), { replace }) : navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace }),
    [navigate, studio],
  );

  if (isDrawingId(drawingId)) {
    return (
      <DrawingEditor
        key={drawingId}
        drawingId={drawingId}
        backLabel={studio ? "Studio" : "Drawings"}
        onBack={toCollection}
      />
    );
  }
  return <AddOnCollection pluginId={PLUGIN_ID} title="Drawings" kind="drawing" call={callStudio} refreshKey={version} />;
}
