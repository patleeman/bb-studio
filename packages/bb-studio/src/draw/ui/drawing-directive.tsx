// The `::drawing{id="…"}` card in a reply: the drawing's picture, under a
// header that opens it in the thread's Studio tab. It doesn't load
// Excalidraw: the picture is the server's thumbnail.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, THUMBNAIL, remember } from "../../kit/app/index";
import { relativeTime } from "../../kit/format";
import { useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../contract";
import { DRAW_ICON, DRAWING_UPDATE_TYPE, REALTIME_CHANNEL, drawingHref, isDrawingId, thumbnailUrl } from "../shared";
import { drawingName } from "./drawing-card";
import { useOpenCard } from "../../links/open";

type DrawingMeta = NonNullable<z.infer<(typeof rpcContract)["drawings.getDrawingMeta"]["output"]>["drawing"]>;

/** A drawing's name and size, kept current as it changes. Null once it's gone. */
function useDrawingMeta(id: string): DrawingMeta | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [drawing, setDrawing] = useState<DrawingMeta | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("drawings.getDrawingMeta", { id }).then(
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

export function DrawingDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const openCard = useOpenCard(message.threadId);
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
      ) : <p className="px-3 py-2 text-sm text-muted-foreground">This whiteboard is empty.</p>}
      details={`Whiteboard · ${drawing.elementCount} ${drawing.elementCount === 1 ? "element" : "elements"} · ${relativeTime(drawing.updatedAt)}`}
      // In its thread's workbench (src/ui/studio-open.tsx).
      item={{ href: drawingHref(id), title: name }}
      onOpen={openCard(drawingHref(id), name)}
      onOpenFull={openCard(drawingHref(id), name, "main")}
    />
  );
}
