// The drawings grid in a thread's right panel, where each drawing can be
// attached to that conversation as a rendered image. The Drawings page uses
// Studio's collection instead (see drawings-panel.tsx).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, Icon, PRIMARY_BUTTON } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { blobToBase64, parseScene, renderSceneToPng } from "../lib/scene";
import { DRAW_ICON, REALTIME_CHANNEL } from "../src/shared";
import { CARD_ACTION, DrawingCard, drawingName, type DrawingMeta } from "./drawing-card";

export function DrawingGallery({ threadId, onOpen }: { threadId: string; onOpen: (id: string) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [drawings, setDrawings] = useState<DrawingMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDrawings((await rpc.call("listDrawings")).drawings);
    } catch (error) {
      toast.error(errorMessage(error));
      setDrawings((current) => current ?? []);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any write to any drawing (agent tool, CLI, another editor) reloads the
  // grid so thumbnails and order stay current.
  useRealtime(REALTIME_CHANNEL, () => {
    void load();
  });

  async function createDrawing() {
    if (creating) return;
    setCreating(true);
    try {
      const { drawing } = await rpc.call("createDrawing", { name: "", threadId });
      onOpen(drawing.id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  /** Renders the drawing to a PNG and attaches it to this thread's project. */
  async function attachImage(id: string) {
    setAttachingId(id);
    try {
      const { drawing } = await rpc.call("getDrawing", { id });
      if (!drawing) throw new Error("Drawing not found");
      const pngBase64 = await blobToBase64(await renderSceneToPng(parseScene(drawing.data)));
      await rpc.call("attachDrawingImage", { threadId, drawingId: id, pngBase64 });
      toast.success("Drawing attached");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setAttachingId(null);
    }
  }

  const newButton = (
    <button type="button" className={PRIMARY_BUTTON} onClick={() => void createDrawing()} disabled={creating}>
      <Icon name={creating ? "Loading" : "Plus"} className={creating ? "animate-spin motion-reduce:animate-none" : undefined} /> New drawing
    </button>
  );

  return (
    <div className="studio-root h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Drawings</h1>
          {drawings?.length ? newButton : null}
        </header>
        {drawings === null ? (
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">
            Loading drawings…
          </p>
        ) : drawings.length === 0 ? (
          <EmptyState icon={DRAW_ICON} title="No drawings yet" actions={newButton} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
            {drawings.map((drawing) => (
              <DrawingCard
                key={drawing.id}
                drawing={drawing}
                openLabel={`Open ${drawingName(drawing)}`}
                onOpen={() => onOpen(drawing.id)}
                actions={
                  <button
                    type="button"
                    className={CARD_ACTION}
                    aria-label="Attach to the conversation"
                    title="Attach to the conversation"
                    disabled={attachingId === drawing.id || drawing.elementCount === 0}
                    onClick={() => void attachImage(drawing.id)}
                  >
                    {attachingId === drawing.id ? (
                      <Icon name="Loading" className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Icon name="Paperclip" />
                    )}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
