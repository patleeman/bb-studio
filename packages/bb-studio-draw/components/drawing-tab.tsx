// The Drawings tab in a thread's workbench, and the card that opens it from a
// reply. The tab shows one drawing's editor beside the conversation; opened
// without one, it lists the thread's drawings and recent ones.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, THUMBNAIL, ThreadItemsPanel, remember } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { useBbNavigate, useRealtime, useRpc, type JsonValue, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server";
import { DRAW_ICON, DRAWING_UPDATE_TYPE, PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isDrawingId, thumbnailUrl } from "../src/shared";
import { drawingName } from "./drawing-card";
import { DrawingEditor } from "./drawing-editor";

/** The workbench tab's action id; reply cards open it with `{ drawingId }`. */
export const DRAWINGS_TAB = "excalidraw";

type DrawingMeta = NonNullable<z.infer<(typeof rpcContract)["getDrawingMeta"]["output"]>["drawing"]>;

function drawingParam(params: JsonValue | null): string | null {
  const value = params && typeof params === "object" && !Array.isArray(params) ? params.drawingId : null;
  return typeof value === "string" && isDrawingId(value) ? value : null;
}

export function DrawingsTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="drawing"
      channel={REALTIME_CHANNEL}
      initialId={drawingParam(params)}
      renderItem={(id, { backLabel, onBack }) => <DrawingEditor key={id} drawingId={id} threadId={threadId} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

/** A drawing's name and size, kept current as it changes. Null once it's gone. */
function useDrawingMeta(id: string): DrawingMeta | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [drawing, setDrawing] = useState<DrawingMeta | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("getDrawingMeta", { id }).then(
      (result) => setDrawing(result.drawing),
      () => setDrawing(null),
    );
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as { type?: string; drawingId?: string } | null;
    if (event?.type === DRAWING_UPDATE_TYPE && event.drawingId === id) load();
  });
  return drawing;
}

/** `::drawing{id="…"}` in a reply: the drawing's picture, under a header that opens it in the workbench. */
export function DrawingDirective({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isDrawingId(id);
  const drawing = remember(`drawing:${id}`, useDrawingMeta(valid ? id : ""));
  if (!valid || drawing === null) return <ItemDirectiveCard state="deleted" kind="drawing" icon={DRAW_ICON} />;
  if (!drawing) return <ItemDirectiveCard state="loading" kind="drawing" icon={DRAW_ICON} />;
  const name = drawingName(drawing);
  return (
    <ItemDirectiveCard
      state="ready"
      kind="drawing"
      icon={DRAW_ICON}
      title={name}
      body={drawing.elementCount > 0 ? (
        <div className="flex h-72 w-full items-center justify-center bg-foreground/[0.03] p-3">
          <img src={thumbnailUrl(drawing.id, drawing.updatedAt)} alt={name} loading="lazy" className={THUMBNAIL} />
        </div>
      ) : <p className="px-3 py-2 text-sm text-muted-foreground">This drawing is empty.</p>}
      details={`Drawing · ${drawing.elementCount} ${drawing.elementCount === 1 ? "element" : "elements"} · ${relativeTime(drawing.updatedAt)}`}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: DRAWINGS_TAB, title: name, params: { drawingId: id } }))
          navigate.toPluginPanel(PANEL_PATH, { subPath: id });
      }}
    />
  );
}
