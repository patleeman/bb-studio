// The Drawings tab in a thread's workbench. It shows one drawing's editor
// beside the conversation; opened without one, it lists the thread's
// drawings and recent ones. Loaded on demand by app.tsx: it brings Excalidraw.
import { ThreadItemsPanel } from "@bb-studio/kit/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { PLUGIN_ID, REALTIME_CHANNEL, isDrawingId } from "../shared";
import { DrawingEditor } from "./drawing-editor";
import { useDrawingProvider } from "./provider";

function drawingParam(params: JsonValue | null): string | null {
  const value = params && typeof params === "object" && !Array.isArray(params) ? params.drawingId : null;
  return typeof value === "string" && isDrawingId(value) ? value : null;
}

export default function DrawingsTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const call = useDrawingProvider();
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="drawing"
      channel={REALTIME_CHANNEL}
      call={call}
      initialId={drawingParam(params)}
      renderItem={(id, { backLabel, onBack }) => <DrawingEditor key={id} drawingId={id} threadId={threadId} backLabel={backLabel} onBack={onBack} />}
    />
  );
}
