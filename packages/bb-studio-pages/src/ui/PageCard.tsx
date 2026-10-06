// `::page{id="pg_…"}` in a reply: a card that opens the page in the
// thread's workbench, beside the chat.
import { ItemDirectiveCard } from "@bb-studio/kit/app";
import { untitled } from "@bb-studio/kit/format";
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { usePanelPage } from "./PanelShell";
import { relativeTime } from "./shared";

/** The workbench tab's action id; reply cards open it with `{ pageId }`. */
export const PAGE_TAB = "page";

export const isPageId = (value: string) => /^pg_[\w-]+$/.test(value);

export function PageCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isPageId(id);
  const { page } = usePanelPage(valid ? id : null);
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
      onOpen={() => {
        // The workbench when there is one; the main area otherwise.
        if (!navigate.openThreadPanel({ actionId: PAGE_TAB, title, params: { pageId: id } }))
          navigate.toPluginPanel("pages", { subPath: id });
      }}
    />
  );
}
