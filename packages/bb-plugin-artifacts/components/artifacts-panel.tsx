// The Artifacts nav panel: Studio's collection at the root, and one
// artifact's viewer at `<artifact id>`. With Studio installed, back leads to
// Studio.
import { useCallback, useState } from "react";
import { AddOnCollection, openAppPath, studioPath, useStudioPresent, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isArtifactId } from "../src/shared";
import { ArtifactViewer } from "./artifact-viewer";

export function ArtifactsPanel({ subPath }: { subPath: string }) {
  const studioRpc = useRpc<StudioSchemas["provider"]>();
  const callStudio = useCallback<ProviderCall>((method, input) => studioRpc.call(method, input as never) as never, [studioRpc]);
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const [artifactId = ""] = subPath.split("/").filter(Boolean);
  const [version, setVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, () => setVersion((current) => current + 1));

  const toCollection = useCallback(
    (replace = false) =>
      studio ? openAppPath(studioPath("artifact"), { replace }) : navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace }),
    [navigate, studio],
  );

  if (isArtifactId(artifactId)) {
    return (
      <ArtifactViewer
        key={artifactId}
        artifactId={artifactId}
        backLabel={studio ? "Studio" : "Artifacts"}
        onBack={toCollection}
      />
    );
  }
  return <AddOnCollection pluginId={PLUGIN_ID} title="Artifacts" kind="artifact" call={callStudio} refreshKey={version} />;
}
