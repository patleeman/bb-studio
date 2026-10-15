// A design in the thread's Studio tab: just its canvas, beside the
// conversation. Loaded on demand by the tab.
import { BarTitle, ICON_BUTTON, Icon } from "@bb-studio/kit/app";
import { DesignBoard } from "./design-view";
import { useDesign } from "./use-design";

/** Just the canvas: the conversation is already beside it. */
export function TabCanvas({ designId, backLabel, onBack }: { designId: string; backLabel: string; onBack(): void }) {
  const { design, rename } = useDesign(designId);
  if (design === null) return <p className="p-4 text-sm text-muted-foreground">This design was deleted.</p>;
  const back = (
    <>
      <button type="button" aria-label={`Back to ${backLabel}`} title={`Back to ${backLabel}`} className={ICON_BUTTON} onClick={onBack}>
        <Icon name="ArrowLeft" className="size-4" />
      </button>
      <div className="max-w-56">
        <BarTitle key={`${designId}:${design?.name ?? ""}`} title={design?.name ?? ""} label="Design name" placeholder="Untitled design" disabled={!design} onRename={rename} />
      </div>
    </>
  );
  return <div className="relative h-full min-h-0">{design ? <DesignBoard design={design} leftTools={back} inThread /> : null}</div>;
}
