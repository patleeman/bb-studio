import { useBbNavigate, useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { PageMetaView, rpcContract } from "../contract";

/** In the header of a thread started from "Work with this page", a way back to the page. */
export function ThreadPageLink({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [page, setPage] = useState<PageMetaView | null>(null);
  const load = useCallback(() => {
    rpc.call("chatPage", { threadId }).then((result) => setPage(result.page), () => setPage(null));
  }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (!page) return;
    if ((event.type === "page" && event.pageId === page.id) || (event.type === "deleted" && event.pageIds.includes(page.id)) || event.type === "tree") load();
  });

  if (!page) return null;
  const title = page.title || "Untitled";
  return (
    <button
      type="button"
      aria-label={`Open page ${title}`}
      title={`Open page ${title}`}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
        isCompactViewport ? "w-7 justify-center" : "max-w-56 px-2",
      )}
      onClick={() => navigate.toPluginPanel("pages", { subPath: `${page.id}/chat/${threadId}` })}
    >
      {page.icon ? <span className="shrink-0 text-base leading-none">{page.icon}</span> : <Icon name="FileText" className="size-4 shrink-0" />}
      {isCompactViewport ? null : <span className="truncate">{title}</span>}
    </button>
  );
}
