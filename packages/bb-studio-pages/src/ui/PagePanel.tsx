import { untitled } from "@bb-studio/kit/format";
import { useBbNavigate, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { ThreadItemsPanel } from "@bb-studio/kit/app";
import { Icon } from "@bb-studio/kit/ui";
import { PLUGIN_ID, REALTIME_CHANNEL } from "../constants";
import type { rpcContract } from "../contract";
import { OpenInPages, PanelShell, usePanelPage } from "./PanelShell";
import { MissingPageRecovery } from "./MissingPageRecovery";
import { relativeTime } from "./shared";

/** What the `page` thread panel tab is opened with: a page. */
export type PagePanelParams = { pageId: string };

function pageIdFrom(params: PluginThreadPanelProps["params"]): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const { pageId } = params as Record<string, unknown>;
  return typeof pageId === "string" && pageId ? pageId : null;
}

/**
 * Pages in a thread's workbench: the thread's pages and recent ones, and New
 * makes one linked to the thread. Opened with a page, as a reply's card does,
 * it shows that page in the same live editor as the Pages view, with a way
 * back to the list.
 */
export function PagePanel({ threadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [chatPageId, setChatPageId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("chatPage", { threadId }).then(
      (result) => live && setChatPageId(result.page?.id ?? null),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [rpc, threadId]);
  const linkedIds = useMemo(() => (chatPageId ? [chatPageId] : []), [chatPageId]);
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="page"
      channel={REALTIME_CHANNEL}
      initialId={pageIdFrom(params)}
      linkedIds={linkedIds}
      renderItem={(id, { backLabel, onBack }) => <PageTab key={id} pageId={id} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

function PageTab({ pageId, backLabel, onBack }: { pageId: string; backLabel?: string; onBack?(): void }) {
  const navigate = useBbNavigate();
  const { page, refetch } = usePanelPage(pageId);

  if (page === null) return <MissingPageRecovery key={pageId} pageId={pageId} onRetryPage={refetch} onBack={onBack} backLabel={backLabel ? `Back to ${backLabel}` : undefined} />;
  if (!page) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <PanelShell
      page={page}
      header={
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          {onBack ? (
            <button
              type="button"
              className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              title={`Back to ${backLabel}`}
              aria-label={`Back to ${backLabel}`}
              onClick={onBack}
            >
              <Icon name="ArrowLeft" className="size-4" />
            </button>
          ) : null}
          {page.icon ? <span className="shrink-0 text-base leading-none">{page.icon}</span> : <Icon name="pages/pages" fallback="FileText" className="size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{untitled(page.title)}</div>
            <div className="truncate text-[11px] text-muted-foreground">Edited {relativeTime(page.updatedAt)}</div>
          </div>
          <OpenInPages onOpen={() => navigate.toPluginPanel("pages", { subPath: page.id })} />
        </header>
      }
    />
  );
}
