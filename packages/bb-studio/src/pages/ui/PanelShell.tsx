// The Page side-panel tab's frame: a page's metadata kept current, and its
// live editor under a header.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../kit/ui/index";
import type { BotView, PageMetaView, rpcContract } from "../contract";
export { usePanelPage } from "./use-panel-page";
import { PagesUiContext } from "./context";
import { PageEditor } from "./PageEditor";
import { usePagesData, usePagesUiValue } from "./PagesPanel";
import { PersistenceBadge, persistenceVisible, useConnection } from "./PageView";

export function OpenInPages({ onOpen }: { onOpen(): void }) {
  return (
    <button
      type="button"
      title="Open the full page in Pages"
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      onClick={onOpen}
    >
      Open in Pages
      <Icon name="ArrowUpRight" className="size-3.5" />
    </button>
  );
}

/** The panel tab's frame around a page's live editor: a header above it, and anything below it. */
export function PanelShell({ page, header, footer }: { page: PageMetaView; header: React.ReactNode; footer?: React.ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const { pages, bots } = usePagesData(rpc);
  const ui = usePagesUiValue(rpc, pages, bots);
  return (
    <PagesUiContext.Provider value={ui}>
      <div className="pages-doc pages-panel-tab relative flex h-full min-h-0 flex-col bg-background text-foreground">
        {header}
        <PanelEditor key={page.id} page={page} pages={pages ?? []} bots={bots.bots} footer={footer} />
      </div>
    </PagesUiContext.Provider>
  );
}

function PanelEditor({ page, pages, bots, footer }: { page: PageMetaView; pages: PageMetaView[]; bots: BotView[]; footer?: React.ReactNode }) {
  const { connection, status, ready } = useConnection(page.id);
  return (
    <>
    {persistenceVisible(connection) ? <div className="shrink-0 px-4 py-2"><PersistenceBadge connection={connection} /></div> : null}
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex pt-3 pb-6">
        {connection && ready && status !== "missing" ? (
          <PageEditor connection={connection} page={page} bots={bots} pages={pages} sidePanel={null} onCloseSidePanel={() => {}} />
        ) : (
          <p className="px-4 text-sm text-muted-foreground">{status === "missing" ? "This page no longer exists." : "Connecting…"}</p>
        )}
      </div>
      {footer ? <div className="px-4 pb-24">{footer}</div> : <div className="pb-20" />}
    </div>
    </>
  );
}
