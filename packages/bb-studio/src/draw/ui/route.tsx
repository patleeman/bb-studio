// One drawing as a Studio page: /plugins/studio/studio/drawings/<id>, in a
// workspace tab or the main view. Loaded on demand by app.tsx: it brings
// Excalidraw.
import { openAppPath, WORKSPACE_PATH } from "../../kit/app/index";
import { openCollection } from "../../ui/StudioPanel";
import { DrawingEditor } from "./drawing-editor";

export default function DrawingRoute({ id }: { id: string }) {
  return (
    <DrawingEditor
      key={id}
      drawingId={id}
      backLabel="Studio"
      onBack={(replace) => {
        openCollection("drawing");
        openAppPath(WORKSPACE_PATH, { replace });
      }}
    />
  );
}
