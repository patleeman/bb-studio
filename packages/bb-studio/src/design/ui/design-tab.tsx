// The Design tab in a thread's workbench. It shows one design's canvas
// beside the conversation; opened without one, it lists the thread's
// designs. Loaded on demand by app.tsx.
import { BarTitle, ICON_BUTTON, Icon, ThreadItemsPanel } from "@bb-studio/kit/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { PLUGIN_ID, REALTIME_CHANNEL, isDesignId } from "../shared";
import { DesignBoard } from "./design-view";
import { useDesignProvider } from "./provider";
import { useDesign } from "./use-design";

function designParam(params: JsonValue | null): string | null {
  const value = params && typeof params === "object" && !Array.isArray(params) ? params.designId : null;
  return typeof value === "string" && isDesignId(value) ? value : null;
}

export default function DesignTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  const call = useDesignProvider();
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="design"
      channel={REALTIME_CHANNEL}
      call={call}
      initialId={designParam(params)}
      renderItem={(id, { backLabel, onBack }) => <TabCanvas key={id} designId={id} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

/** Just the canvas: the conversation is already beside it. */
function TabCanvas({ designId, backLabel, onBack }: { designId: string; backLabel: string; onBack(): void }) {
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
