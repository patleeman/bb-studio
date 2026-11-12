// The core profile in the Memory view: the page itself, rendered and edited
// in place with Pages' live editor (the same frame as a page in a thread's
// workbench). It brings the editor, so the view loads it on demand.
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import type { PageMetaView, rpcContract } from "../../pages/contract";
import { PanelShell, usePanelPage } from "../../pages/ui/PanelShell";
import { usePageTitle } from "../../pages/ui/use-page-title";

export default function ProfilePane({ pageId, header }: { pageId: string; header(page: PageMetaView): ReactNode }) {
  const { page } = usePanelPage(pageId);
  if (page === null) return <p className="p-6 text-sm text-muted-foreground">The core profile page is gone.</p>;
  if (!page) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  return <LoadedProfile key={page.id} page={page} header={header} />;
}

function LoadedProfile({ page, header }: { page: PageMetaView; header(page: PageMetaView): ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const titleSave = usePageTitle(page, rpc);
  return <PanelShell page={page} titleSave={titleSave} header={header(page)} />;
}
