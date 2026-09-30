// Composer picker shown while "Drawing" is selected from the composer's `+`
// menu. Rendered by the host in place of the composer (pendingInteraction);
// picking a drawing submits its id to the waiting backend call, which then
// uploads the rendered image for the thread.
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { EmptyState, GHOST_BUTTON } from "@bb-studio/kit/app";
import { DRAW_ICON } from "../src/shared";
import { DrawingCard, drawingName, type DrawingMeta } from "./drawing-card";

export function ExcalidrawPicker({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = interaction.payload as { drawings?: DrawingMeta[] } | null;
  // An empty drawing would attach a blank image.
  const drawings = (payload?.drawings ?? []).filter((drawing) => drawing.elementCount > 0);

  return (
    <div className="studio-root flex h-full flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <header>
            <h1 className="text-lg font-semibold tracking-tight">Attach a drawing</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Pick one to attach as an image.</p>
          </header>
          {drawings.length === 0 ? (
            <EmptyState icon={DRAW_ICON} title="Nothing to attach yet">
              Sketch something in Drawings first.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
              {drawings.map((drawing) => (
                <DrawingCard
                  key={drawing.id}
                  drawing={drawing}
                  openLabel={`Attach ${drawingName(drawing)}`}
                  onOpen={() => void submit({ drawingId: drawing.id })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-4 py-2.5">
        <button type="button" className={GHOST_BUTTON} onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
