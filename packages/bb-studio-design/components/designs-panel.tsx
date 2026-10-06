// The Designs nav panel: the collection with a "Make something new" row
// above it, and one design's canvas.
import { useCallback, useState } from "react";
import { AddOnPanel, Icon, cn, createStudioItem, useAddOnPanel } from "@bb-studio/kit/app";
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL, isDesignId } from "../src/shared";
import { DesignPage } from "./design-view";

export function DesignsPanel({ subPath }: { subPath: string }) {
  const [id = ""] = subPath.split("/").filter(Boolean);
  const navigate = useBbNavigate();
  // Back returns to this panel's list, not Studio's: see handOver below.
  const toList = useCallback((replace = false) => navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace }), [navigate]);
  const panel = (
    <AddOnPanel
      subPath={subPath}
      pluginId={PLUGIN_ID}
      title="Designs"
      kind="design"
      panelPath={PANEL_PATH}
      channel={REALTIME_CHANNEL}
      isItemId={isDesignId}
      // Keep our own page: handing over rewrites the URL, which the desktop
      // app's tab router doesn't follow, leaving the panel blank.
      handOver={false}
      renderItem={(id) => <DesignPage key={id} designId={id} backLabel="Designs" onBack={toList} />}
    />
  );
  if (isDesignId(id)) return panel;
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <MakeSomethingNew />
      <div className="min-h-0 flex-1">{panel}</div>
    </div>
  );
}

/** Starting points for a new design, as in Claude Design's home page. */
function MakeSomethingNew() {
  const { call } = useAddOnPanel(REALTIME_CHANNEL, PANEL_PATH, "design");
  const navigate = useBbNavigate();
  const context = useBbContext();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    await createStudioItem({ label: "Design", create: { mode: "rpc" } }, {
      projectId: context.projectId ?? null,
      addOn: "Studio Design",
      create: async () => (await call("studio_create", { kind: "design", projectId: context.projectId ?? null })).item.id,
      open: (designId) => navigate.toPluginPanel(PANEL_PATH, { subPath: designId }),
    });
    setBusy(false);
  }

  return (
    <section aria-labelledby="make-new" className="mx-auto w-full max-w-5xl shrink-0 px-10 pt-10 @max-3xl/page:px-4">
      <h2 id="make-new" className="mb-3 text-xs font-medium text-muted-foreground">Make something new</h2>
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className={cn(
          "group flex w-36 flex-col gap-2 rounded-lg text-left text-sm font-medium outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        )}
      >
        <span className="flex h-24 items-center justify-center rounded-lg border border-border bg-muted/50 transition-colors group-hover:bg-muted">
          <Icon name="design/design" className="size-6 text-muted-foreground" />
        </span>
        New design
      </button>
    </section>
  );
}
