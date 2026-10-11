// The Drawings nav panel: Studio's collection at the root, and one item's view.
import { AddOnPanel } from "@bb-studio/kit/app";
import { PLUGIN_ID, REALTIME_CHANNEL, isDrawingId } from "../src/shared";
import { DrawingEditor } from "./drawing-editor";

export function DrawingsPanel({ subPath }: { subPath: string }) {
  return (
    <AddOnPanel
      subPath={subPath}
      pluginId={PLUGIN_ID}
      title="Drawings"
      kind="drawing"
      channel={REALTIME_CHANNEL}
      isItemId={isDrawingId}
      renderItem={(id, { backLabel, onBack }) => (
        <DrawingEditor key={id} drawingId={id} backLabel={backLabel} onBack={onBack} />
      )}
    />
  );
}
