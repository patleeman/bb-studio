// The Design tab in a thread's workbench, and the card that opens it from a
// reply. The tab shows one design's canvas beside the conversation; opened
// without one, it lists the thread's designs.
import { BarTitle, ICON_BUTTON, Icon, ItemDirectiveCard, ThreadItemsPanel, remember } from "@bb-studio/kit/app";
import { useBbNavigate, type JsonValue, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { DESIGN_ICON, PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, frameSize, isDeck, isDesignId, screenUrl, type DesignView, type ScreenView } from "../src/shared";
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

/** Screens a card shows from the newest round. */
export const PREVIEW_SCREENS = 3;
const PREVIEW_HEIGHT = 240;

/** A screen at its own size, scaled down to the preview's height. Clicks go to the card. */
function ScreenThumb({ designId, screen }: { designId: string; screen: ScreenView }) {
  const { width, height } = frameSize(screen.viewport);
  const scale = PREVIEW_HEIGHT / height;
  return (
    <figure className="flex shrink-0 flex-col gap-1.5">
      <div className="overflow-hidden rounded-md border border-border/70 bg-white" style={{ width: width * scale, height: PREVIEW_HEIGHT }}>
        <iframe
          title={`Screen ${screen.id}`}
          src={screenUrl(designId, screen.id, screen.updatedAt)}
          sandbox="allow-scripts"
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none origin-top-left border-0"
          style={{ width, height, transform: `scale(${scale})` }}
        />
      </div>
      <figcaption className="max-w-full truncate text-xs text-muted-foreground" style={{ width: width * scale }}>{screen.caption || screen.title || screen.id}</figcaption>
    </figure>
  );
}

function DesignPreview({ design }: { design: DesignView }) {
  const screens = design.rounds[0]?.screens.slice(0, PREVIEW_SCREENS) ?? [];
  if (!screens.length) return <p className="px-3 py-2 text-sm text-muted-foreground">This design has no screens yet.</p>;
  return <div className="flex gap-3 overflow-x-auto p-3">{screens.map((screen) => <ScreenThumb key={screen.id} designId={design.id} screen={screen} />)}</div>;
}

/** `::design{id="dsn_…"}` in a reply: the newest round's screens, under a header that opens the design in the workbench. */
export function DesignCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isDesignId(id);
  const design = remember(`design:${id}`, useDesign(valid ? id : "").design);
  if (!valid || design === null) return <ItemDirectiveCard state="deleted" kind="design" icon={DESIGN_ICON} />;
  if (!design) return <ItemDirectiveCard state="loading" kind="design" icon={DESIGN_ICON} />;
  const screens = design.rounds.reduce((sum, round) => sum + round.screens.length, 0);
  const name = design.name.trim() || "Untitled design";
  /** The newest round's decks: one is the deck itself; several are directions to pick from. */
  const decks = design.rounds[0]?.screens.filter(isDeck) ?? [];
  const deck = decks.length === 1 ? decks[0] : undefined;
  return (
    <ItemDirectiveCard
      state="ready"
      kind="design"
      icon={DESIGN_ICON}
      title={name}
      details={deck ? `Deck · ${deck.steps.length} ${deck.steps.length === 1 ? "slide" : "slides"}` : decks.length ? `Deck · ${decks.length} directions to pick from` : `Design · ${design.rounds.length} ${design.rounds.length === 1 ? "round" : "rounds"} · ${screens} ${screens === 1 ? "screen" : "screens"}`}
      body={<DesignPreview design={design} />}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: DESIGN_TAB, title: name, params: { designId: id } }))
          navigate.toPluginPanel(PANEL_PATH, { subPath: id });
      }}
    />
  );
}
