import { requestGeneration } from "../../kit/ui/request-generation";
import { usePanelPage } from "./use-panel-page";
import { openAppPath, studioPath } from "../../kit/app/index";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pagePath, REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { PageMetaView, rpcContract, StudioEmbedItem } from "../contract";
import { PagesUiContext, type PagesUi } from "./context";
import { PageView } from "./PageView";
import { MissingPageRecovery } from "./MissingPageRecovery";
import { useProjects, type BotsState, type Rpc } from "./shared";

export function usePagesData(rpc: Rpc) {
  const [pages, setPages] = useState<PageMetaView[] | null>(null);
  const [bots] = useState<BotsState>({ available: false, reason: null, bots: [] });
  const [requests] = useState(requestGeneration);
  // A failed refresh keeps the last list.
  const refetch = useCallback(() => {
    const current = requests.begin();
    rpc.call("pages.tree", {}).then((result) => { if (current()) setPages(result.pages); }, () => {});
  }, [rpc, requests]);
  useEffect(() => { refetch(); return () => requests.invalidate(); }, [refetch, requests]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (event.type === "tree" || event.type === "deleted" || event.type === "page") refetch();
  });
  return { pages, bots, refetch };
}

/** What the page's blocks and mentions need to open things, shared by every view of a page. */
export function usePagesUiValue(rpc: Rpc, pages: PageMetaView[] | null, bots: BotsState): PagesUi {
  const navigate = useBbNavigate();
  const openPage = useCallback((id: string) => openAppPath(pagePath(id)), []);
  const studioItems = useRef<{ at: number; items: Promise<StudioEmbedItem[]> } | null>(null);
  return useMemo<PagesUi>(
    () => ({
      pages: pages ?? [],
      bots: bots.bots,
      openPage,
      openThread: (threadId) => navigate.toThread(threadId),
      openProject: (projectId) => navigate.toProject(projectId),
      openUrl: (url) => {
        if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener");
      },
      openPath: openAppPath,
      linkPreview: (url) => rpc.call("pages.linkPreview", { url }),
      studioItems: () => {
        // Every embed on a page asks; one request serves them all for a few seconds.
        if (!studioItems.current || Date.now() - studioItems.current.at > 5_000) {
          const items = rpc.call("pages.studioItems", null).then((result) => result.items);
          studioItems.current = { at: Date.now(), items };
          items.catch(() => (studioItems.current = null));
        }
        return studioItems.current.items;
      },
      artifactView: (id) => rpc.call("pages.artifactView", { id }).then((result) => result.view),
      recording: (id) => rpc.call("pages.recordingView", { id }).then((result) => result.recording),
      handOffChecklist: (pageId, blockId) => rpc.call("pages.checklistHandOff", { id: pageId, blockId }),
      whiteboard: (id) => rpc.call("pages.whiteboardGet", { id }).then((result) => result.whiteboard),
      saveWhiteboard: (input) => rpc.call("pages.whiteboardSave", input).then((result) => result.whiteboard),
      // A new item must show in the next embed's lookup.
      createItem: (pageId, pluginId, kind) =>
        rpc.call("pages.studioCreate", { pageId, pluginId, kind }).then((result) => {
          studioItems.current = null;
          return result.item;
        }),
      compose: (prompt) => navigate.toCompose({ initialPrompt: prompt, focusPrompt: true }),
    }),
    [pages, bots.bots, openPage, navigate, rpc],
  );
}

/**
 * One page, as a Studio tab at /plugins/studio/studio/pages/<page id>. The
 * collection is Studio's library filtered to pages.
 */
export function PagesPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const projects = useProjects();
  // `<page id>/chat/<thread id>` opens the page with that chat's card showing.
  const [pageId = null, section, chatThreadId = null] = subPath.split("/").filter(Boolean);
  const { pages, bots, refetch } = usePagesData(rpc);

  const { page: pageMeta, refetch: fetchPage, markMissing: showMissingPage } = usePanelPage(pageId);

  // The collection is Studio's.
  const toCollection = useCallback((replace = false) => openAppPath(studioPath("page"), { replace }), []);
  const [requestsVersion, setRequestsVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (event.type === "requests" && event.pageId === pageId) setRequestsVersion((version) => version + 1);
  });

  const ui = usePagesUiValue(rpc, pages, bots);
  const openPage = ui.openPage;

  const createPage = async (projectId: string | null, parentId: string | null = null) => {
    const result = await rpc.call("pages.create", { projectId, parentId, title: "" });
    refetch();
    openPage(result.page.id);
  };

  return (
    <PagesUiContext.Provider value={ui}>
      {!pageId ? null : pageMeta ? (
        <PageView
          key={pageId}
          page={pageMeta}
          pages={pages ?? []}
          bots={bots}
          projects={projects}
          rpc={rpc}
          requestsVersion={requestsVersion}
          chatThreadId={section === "chat" ? chatThreadId : null}
          // A page inside another shares its project.
          onCreateInside={() => void createPage(pageMeta.projectId, pageMeta.id)}
          onDeleted={showMissingPage}
          backLabel="Studio"
          onBack={() => toCollection()}
        />
      ) : pageMeta === null ? (
        <MissingPageRecovery key={pageId} pageId={pageId} onRetryPage={fetchPage} onBack={() => toCollection()} backLabel="Back to Studio" />
      ) : null}
    </PagesUiContext.Provider>
  );
}
