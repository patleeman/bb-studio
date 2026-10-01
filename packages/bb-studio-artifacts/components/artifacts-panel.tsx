// The Artifacts nav panel: Studio's collection at the root, and one item's view.
import { AddOnPanel } from "@bb-studio/kit/app";
import { PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isArtifactId } from "../src/shared";
import { ArtifactViewer } from "./artifact-viewer";

export function ArtifactsPanel({ subPath }: { subPath: string }) {
  return (
    <AddOnPanel
      subPath={subPath}
      pluginId={PLUGIN_ID}
      title="Artifacts"
      kind="artifact"
      panelPath={PANEL_PATH}
      channel={REALTIME_CHANNEL}
      isItemId={isArtifactId}
      renderItem={(id, { backLabel, onBack }) => (
        <ArtifactViewer key={id} artifactId={id} backLabel={backLabel} onBack={onBack} />
      )}
    />
  );
}
