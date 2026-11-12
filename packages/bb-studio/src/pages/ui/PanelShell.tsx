// The Page side-panel tab's frame: a page's metadata kept current, and its
// live editor in the same column, with the same icon and title, as the Pages
// view (PageLayout), under a slim header.
import { WhiteboardExpandHost } from "./whiteboard-expand";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../kit/ui/index";
import { hasGlobalWorkbench } from "../../kit/app/host-sdk";
import type { BotView, PageMetaView, rpcContract } from "../contract";
export { usePanelPage } from "./use-panel-page";
import { PagesUiContext } from "./context";
import { PageEditor } from "./PageEditor";
import { PageBody, PageColumn, PageHeading } from "./PageLayout";
import { usePagesData, usePagesUiValue } from "./PagesPanel";
import { PersistenceBadge, persistenceVisible, useConnection } from "./PageView";
import type { usePageTitle } from "./use-page-title";

export function OpenInPages({ onOpen }: { onOpen(): void }) {
  // Where items open in BB's main view and its workbench, there is no separate Pages place to go to.
  if (hasGlobalWorkbench) return null;
  return (
    <button
      type="button"
      className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      onClick={onOpen}
    >
      Open in Pages
      <Icon name="ArrowUpRight" className="size-3.5" />
    </button>
  );
}

/** The panel tab's frame around a page's heading and live editor, with a header above them. */
export function PanelShell({ page, titleSave, header }: { page: PageMetaView; titleSave: ReturnType<typeof usePageTitle>; header: React.ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const { pages, bots } = usePagesData(rpc);
  const ui = usePagesUiValue(rpc, pages, bots);
  return (
    <PagesUiContext.Provider value={ui}>
      <div className="pages-doc pages-panel-tab relative flex h-full min-h-0 flex-col bg-background text-foreground">
        <WhiteboardExpandHost>
          {header}
          <PanelEditor key={page.id} page={page} titleSave={titleSave} pages={pages ?? []} bots={bots.bots} />
        </WhiteboardExpandHost>
      </div>
    </PagesUiContext.Provider>
  );
}

function PanelEditor({ page, titleSave, pages, bots }: { page: PageMetaView; titleSave: ReturnType<typeof usePageTitle>; pages: PageMetaView[]; bots: BotView[] }) {
  const rpc = useRpc<typeof rpcContract>();
  const { connection, status, ready } = useConnection(page.id);
  return (
    <>
    {persistenceVisible(connection) ? <div className="shrink-0 px-4 py-2"><PersistenceBadge connection={connection} /></div> : null}
    {/* The scroller is a size container, so a narrow panel can tighten the gutters (styles.css). */}
    <div className="pages-panel-scroll min-h-0 flex-1 overflow-auto">
      <PageColumn>
        <PageHeading page={page} rpc={rpc} titleSave={titleSave} />
        <PageBody missing={status === "missing"}>
          {connection && ready && status !== "missing" ? (
            <PageEditor connection={connection} page={page} bots={bots} pages={pages} sidePanel={null} onCloseSidePanel={() => {}} />
          ) : null}
        </PageBody>
      </PageColumn>
    </div>
    </>
  );
}
