// The Design tab in a thread's workbench, and the card that opens it from a
// reply. The tab shows one design's canvas beside the conversation; opened
// without one, it lists the thread's designs.
import { BarTitle, ICON_BUTTON, Icon, ItemDirectiveCard, ThreadItemsPanel } from "@bb-studio/kit/app";
import { useBbNavigate, type JsonValue, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { DESIGN_ICON, PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isDesignId } from "../src/shared";
import { DesignBoard, useDesign } from "./design-view";

/** The workbench tab's action id; reply cards open it with `{ designId }`. */
export const DESIGN_TAB = "design";

function designParam(params: JsonValue | null): string | null {
  const value = params && typeof params === "object" && !Array.isArray(params) ? params.designId : null;
  return typeof value === "string" && isDesignId(value) ? value : null;
}

export function DesignTab({ threadId, params }: { threadId: string; params: JsonValue | null }) {
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="design"
      channel={REALTIME_CHANNEL}
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

/** `::design{id="dsn_…"}` in a reply: a card that opens the design in the workbench. */
export function DesignCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isDesignId(id);
  const { design } = useDesign(valid ? id : "");
  if (!valid || design === null) return <ItemDirectiveCard state="deleted" kind="design" icon={DESIGN_ICON} />;
  if (!design) return <ItemDirectiveCard state="loading" kind="design" icon={DESIGN_ICON} />;
  const screens = design.rounds.reduce((sum, round) => sum + round.screens.length, 0);
  const name = design.name.trim() || "Untitled design";
  return (
    <ItemDirectiveCard
      state="ready"
      kind="design"
      icon={DESIGN_ICON}
      title={name}
      details={`Design · ${design.rounds.length} ${design.rounds.length === 1 ? "round" : "rounds"} · ${screens} ${screens === 1 ? "screen" : "screens"}`}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: DESIGN_TAB, title: name, params: { designId: id } }))
          navigate.toPluginPanel(PANEL_PATH, { subPath: id });
      }}
    />
  );
}
