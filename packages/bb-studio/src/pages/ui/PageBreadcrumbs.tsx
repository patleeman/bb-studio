import { Fragment } from "react";
import { untitled } from "../../kit/format";
import { BarCrumb, BarSeparator, cn, openAppPath, useInTabRow } from "../../kit/app/index";
import type { PageMetaView } from "../contract";
import { pagePath } from "../constants";

const label = (page: PageMetaView) => `${page.icon ? `${page.icon} ` : ""}${untitled(page.title)}`;

export function PageBreadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  const inTabRow = useInTabRow();
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
          <BarCrumb onClick={() => openAppPath(pagePath(crumb.id))}>
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
              onClick={() => openAppPath(pagePath(crumb.id))}
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
