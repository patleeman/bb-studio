// The `::design{id="dsn_…"}` card in a reply: the newest round's screens,
// under a header that opens the design in the thread's Studio tab.
import { ItemDirectiveCard, openAppPath, remember } from "../../kit/app/index";
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { DESIGN_ICON, designHref, frameSize, isDeck, isDesignId, screenUrl, type DesignView, type ScreenView } from "../shared";
import { useDesign } from "./use-design";
import { itemParams, STUDIO_TAB } from "../../ui/studio-tab/model";

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
        if (!navigate.openThreadPanel({ actionId: STUDIO_TAB, title: name, params: itemParams("design", id) }))
          openAppPath(designHref(id));
      }}
    />
  );
}
