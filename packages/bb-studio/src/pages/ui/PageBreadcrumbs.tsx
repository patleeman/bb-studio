import { Fragment } from "react";
import { untitled } from "../../kit/format";
import { BarCrumb, BarSeparator, cn, useInTabRow, wantsAlternate } from "../../kit/app/index";
import { useStudioOpen } from "../../ui/studio-open";
import type { PageMetaView } from "../contract";
import { pagePath } from "../constants";

const label = (page: PageMetaView) => `${page.icon ? `${page.icon} ` : ""}${untitled(page.title)}`;

/** A parent page, opened by Studio's rule (src/ui/studio-open.tsx); Mod-click in the other place. */
function useOpenCrumb() {
  const open = useStudioOpen();
  return (crumb: PageMetaView, event: { metaKey?: boolean; ctrlKey?: boolean }) => open({ href: pagePath(crumb.id), title: untitled(crumb.title) }, { alternate: wantsAlternate(event) });
}

export function PageBreadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  const inTabRow = useInTabRow();
  const openCrumb = useOpenCrumb();
  const trail: PageMetaView[] = [];
  let parent = page.parentId;
  while (parent && trail.length < 6) {
    const found = pages.find((candidate) => candidate.id === parent);
    if (!found) break;
    trail.unshift(found);
    parent = found.parentId;
  }
  if (inTabRow) return <TabRowParents page={page} trail={trail} />;
  return (
    <>
      {trail.map((crumb) => (
        <Fragment key={crumb.id}>
          <BarCrumb onClick={(event) => openCrumb(crumb, event)}>
            <span className="truncate max-md:max-w-24">{crumb.icon} {untitled(crumb.title)}</span>
          </BarCrumb>
          <BarSeparator />
        </Fragment>
      ))}
      <BarCrumb current><span className="truncate">{page.icon} {untitled(page.title)}</span></BarCrumb>
    </>
  );
}

/**
 * Beside the workspace tabs, which already name the page: only its parents.
 * Past two, the middle ones fold into "…"; each name truncates, the first
 * before the nearest; the full path is the tooltip.
 */
function TabRowParents({ page, trail }: { page: PageMetaView; trail: PageMetaView[] }) {
  const openCrumb = useOpenCrumb();
  if (!trail.length) return null;
  const shown = trail.length > 2 ? [trail[0]!, null, trail[trail.length - 1]!] : trail;
  return (
    <span data-page-parents="" title={[...trail, page].map(label).join(" / ")} className="flex min-w-0 items-center gap-0.5 text-[13px] text-muted-foreground">
      {shown.map((crumb, index) => (
        <Fragment key={crumb?.id ?? "folded"}>
          {index > 0 ? <span aria-hidden className="shrink-0 text-muted-foreground/50">/</span> : null}
          {crumb ? (
            <button
              type="button"
              className={cn(
                "flex h-7 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                // The nearest parent keeps its name longest; a squeezed one keeps its icon.
                index === shown.length - 1 ? "shrink" : "shrink-[3]",
                crumb.icon ? "min-w-7" : "min-w-10",
              )}
              onClick={(event) => openCrumb(crumb, event)}
            >
              {crumb.icon ? <span aria-hidden className="shrink-0 text-xs leading-none">{crumb.icon}</span> : null}
              <span className="truncate">{untitled(crumb.title)}</span>
            </button>
          ) : (
            <span aria-label={`${trail.length - 2} more`} className="shrink-0 px-0.5">…</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
