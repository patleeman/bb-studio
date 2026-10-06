// `::page{id="pg_…"}` in a reply: the page shown inline, read-only, under a
// header that opens it in the thread's workbench, beside the chat.
import { ItemDirectiveCard, remember } from "@bb-studio/kit/app";
import { untitled } from "@bb-studio/kit/format";
import { Markdown, useBbNavigate, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { rpcContract } from "../contract";
import { chatMarkdown } from "./page-preview";
import { usePanelPage } from "./PanelShell";
import { relativeTime } from "./shared";

/** The workbench tab's action id; reply cards open it with `{ pageId }`. */
export const PAGE_TAB = "page";

export const isPageId = (value: string) => /^pg_[\w-]+$/.test(value);

// A remounted card reuses the text the last one read for the same edit.
const markdowns = new Map<string, { updatedAt: number; markdown: string }>();

/** The page's Markdown, read again on each edit: undefined while loading, null if it can't be read. */
function usePageMarkdown(id: string | null, updatedAt: number | undefined): string | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [markdown, setMarkdown] = useState<string | null | undefined>(() => (id ? markdowns.get(id)?.markdown : undefined));
  useEffect(() => {
    if (!id || updatedAt === undefined) return;
    const cached = markdowns.get(id);
    if (cached?.updatedAt === updatedAt) {
      setMarkdown(cached.markdown);
      return;
    }
    let current = true;
    rpc.call("markdown", { id }).then(
      (result) => {
        const next = chatMarkdown(result.markdown);
        markdowns.set(id, { updatedAt, markdown: next });
        if (current) setMarkdown(next);
      },
      // Keeps what's shown when a reread fails.
      () => current && setMarkdown((shown) => shown ?? null),
    );
    return () => { current = false; };
  }, [rpc, id, updatedAt]);
  return markdown;
}

function PageBody({ markdown }: { markdown: string | null | undefined }) {
  if (markdown === undefined) return <div className="m-3 h-24 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />;
  if (markdown === null) return <p className="px-3 py-2 text-sm text-muted-foreground">This page couldn't be loaded.</p>;
  if (!markdown.trim()) return <p className="px-3 py-2 text-sm text-muted-foreground">This page is empty.</p>;
  return <div className="px-4 py-3 text-sm"><Markdown content={markdown} /></div>;
}

export function PageCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isPageId(id);
  const page = remember(`page:${id}`, usePanelPage(valid ? id : null).page);
  const markdown = usePageMarkdown(valid ? id : null, page?.updatedAt);
  if (!valid || page === null) return <ItemDirectiveCard state="deleted" kind="page" icon="pages/pages" />;
  if (!page) return <ItemDirectiveCard state="loading" kind="page" icon="pages/pages" />;
  const title = untitled(page.title);
  return (
    <ItemDirectiveCard
      state="ready"
      kind="page"
      icon="pages/pages"
      title={page.icon ? `${page.icon} ${title}` : title}
      details={`Page · edited ${relativeTime(page.updatedAt)}`}
      body={<PageBody markdown={markdown} />}
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: PAGE_TAB, title, params: { pageId: id } }))
          navigate.toPluginPanel("pages", { subPath: id });
      }}
    />
  );
}
