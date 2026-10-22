import { Fragment } from "react";
import { untitled } from "../../kit/format";
import { BarCrumb, BarSeparator, openAppPath } from "../../kit/app/index";
import type { PageMetaView } from "../contract";
import { pagePath } from "../constants";

export function PageBreadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  const trail: PageMetaView[] = [];
  let parent = page.parentId;
  while (parent && trail.length < 6) {
    const found = pages.find((candidate) => candidate.id === parent);
    if (!found) break;
    trail.unshift(found);
    parent = found.parentId;
  }
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
