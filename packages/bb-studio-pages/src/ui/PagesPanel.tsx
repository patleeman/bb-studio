import { AddOnCollection, openAppPath, studioPath, useStudioPresent, type ProviderCall } from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLUGIN_ID, REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { PageMetaView, rpcContract, StudioEmbedItem } from "../contract";
import { PagesUiContext, type PagesUi } from "./context";
import { PageView } from "./PageView";
import { PageConversation } from "./PageChat";
import { MissingPageRecovery } from "./MissingPageRecovery";
import { useProjects, type BotsState, type Rpc } from "./shared";

export function usePagesData(rpc: Rpc) {
  const [pages, setPages] = useState<PageMetaView[] | null>(null);
  const [bots] = useState<BotsState>({ available: false, reason: null, bots: [] });
  // The collection reports its own load errors; a failed refresh keeps the last list.
  const refetch = useCallback(() => {
    rpc.call("tree", {}).then((result) => setPages(result.pages), () => {});
  }, [rpc]);
  useEffect(() => { refetch(); }, [refetch]);
  return { pages, bots, refetch };
}

/** What the page's blocks and mentions need to open things, shared by every view of a page. */
export function usePagesUiValue(rpc: Rpc, pages: PageMetaView[] | null, bots: BotsState): PagesUi {
  const navigate = useBbNavigate();
  const openPage = useCallback((id: string) => openAppPath(`/plugins/${PLUGIN_ID}/pages/${id}`), []);
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
      linkPreview: (url) => rpc.call("linkPreview", { url }),
      studioItems: () => {
        // Every embed on a page asks; one request serves them all for a few seconds.
        if (!studioItems.current || Date.now() - studioItems.current.at > 5_000) {
          const items = rpc.call("studioItems", null).then((result) => result.items);
          studioItems.current = { at: Date.now(), items };
          items.catch(() => (studioItems.current = null));
        }
        return studioItems.current.items;
      },
      artifactView: (id) => rpc.call("artifactView", { id }).then((result) => result.view),
      table: (id) => rpc.call("tableGet", { id }).then((result) => result.table),
      tableApi: (id) => ({
        update: (meta) => rpc.call("tableUpdate", { id, ...meta }),
        patchRows: (patch) => rpc.call("tablePatchRows", { id, ...patch }),
      }),
      recording: (id) => rpc.call("recordingView", { id }).then((result) => result.recording),
      handOffChecklist: (pageId, blockId) => rpc.call("checklistHandOff", { id: pageId, blockId }),
      whiteboard: (id) => rpc.call("whiteboardGet", { id }).then((result) => result.whiteboard),
      saveWhiteboard: (input) => rpc.call("whiteboardSave", input).then((result) => result.whiteboard),
      // A new item must show in the next embed's lookup.
      createItem: (pageId, pluginId, kind) =>
        rpc.call("studioCreate", { pageId, pluginId, kind }).then((result) => {
          studioItems.current = null;
          return result.item;
        }),
      createTable: (input) =>
        rpc.call("tableCreate", input).then((result) => {
          studioItems.current = null;
          return result.table;
        }),
      compose: (prompt) => navigate.toCompose({ initialPrompt: prompt, focusPrompt: true }),
    }),
    [pages, bots.bots, openPage, navigate, rpc],
  );
}

/** The Pages collection at the panel root, and one page at `<page id>`. */
export function PagesPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const studioRpc = useRpc<StudioSchemas["provider"]>();
  const callStudio = useCallback<ProviderCall>((method, input) => studioRpc.call(method, input as never) as never, [studioRpc]);
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const projects = useProjects();
  // `<page id>/chat/<thread id>` opens the page with that chat's card showing.
  const [pageId = null, section, chatThreadId = null] = subPath.split("/").filter(Boolean);
  const { pages, bots, refetch } = usePagesData(rpc);

  const [pageMeta, setPageMeta] = useState<PageMetaView | null | undefined>(undefined);
  const pageRequest = useRef(0);
  const fetchPage = useCallback(() => {
    const request = ++pageRequest.current;
    if (!pageId) {
      setPageMeta(undefined);
      return;
    }
    rpc.call("get", { id: pageId }).then(
      (result) => request === pageRequest.current && setPageMeta(result.page),
      () => request === pageRequest.current && setPageMeta(null),
    );
  }, [rpc, pageId]);
  useEffect(() => {
    setPageMeta(undefined);
    fetchPage();
    return () => { pageRequest.current++; };
  }, [fetchPage]);
  const showMissingPage = useCallback(() => {
    pageRequest.current++;
    setPageMeta(null);
  }, []);

  // With Studio installed, the collection is Studio's.
  const toCollection = useCallback(
    (replace = false) => (studio ? openAppPath(studioPath("page"), { replace }) : navigate.toPluginPanel("pages", { subPath: "", replace })),
    [navigate, studio],
  );
  const [requestsVersion, setRequestsVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (event.type === "tree" || event.type === "deleted" || event.type === "page") refetch();
    if ((event.type === "page" && event.pageId === pageId) || event.type === "tree") fetchPage();
    if (event.type === "deleted" && pageId && event.pageIds.includes(pageId)) showMissingPage();
    if (event.type === "requests" && event.pageId === pageId) setRequestsVersion((version) => version + 1);
  });

  const ui = usePagesUiValue(rpc, pages, bots);
  const openPage = ui.openPage;

  const createPage = async (projectId: string | null, parentId: string | null = null) => {
    const result = await rpc.call("create", { projectId, parentId, title: "" });
    refetch();
    openPage(result.page.id);
  };

  return (
    <PagesUiContext.Provider value={ui}>
      {!pageId ? (
        <AddOnCollection pluginId="pages" title="Pages" kind="page" call={callStudio} refreshKey={pages} />
      ) : pageMeta && section === "compose" ? (
        <PageConversation key={pageId} page={pageMeta} rpc={rpc} />
      ) : pageMeta ? (
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
          backLabel={studio ? "Studio" : "Pages"}
          onBack={() => toCollection()}
        />
      ) : pageMeta === null ? (
        <MissingPageRecovery key={pageId} pageId={pageId} onRetryPage={fetchPage} onBack={() => toCollection()} backLabel={studio ? "Back to Studio" : "All pages"} />
      ) : null}
    </PagesUiContext.Provider>
  );
}
