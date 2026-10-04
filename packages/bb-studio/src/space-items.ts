// Spaces as Studio items: the kind Studio itself provides, so a space lists,
// searches and opens as a tab like any add-on's item.
import { STUDIO_PLUGIN_ID } from "@bb-studio/kit/contract";
import { plural } from "@bb-studio/kit/format";
import type { HubItem } from "./hub";
import { pageHref } from "./space-page";
import { type Space } from "./spaces";
import { spaceViewHref } from "./ui/space/routes";

export const SPACE_KIND = "space";

export function spaceItem(space: Space): HubItem {
  const holds = [
    space.itemKeys.length ? plural(space.itemKeys.length, "item") : null,
    space.projectIds.length ? plural(space.projectIds.length, "project") : null,
    space.threadIds.length ? plural(space.threadIds.length, "thread") : null,
  ].filter(Boolean).join(", ") || "Empty";
  return {
    pluginId: STUDIO_PLUGIN_ID,
    id: space.id,
    kind: SPACE_KIND,
    title: space.name,
    icon: space.icon,
    projectId: null,
    parentId: null,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    updatedBy: "user",
    preview: space.description || null,
    facts: [{ id: "members", value: holds, sort: space.itemKeys.length + space.projectIds.length + space.threadIds.length }],
    badge: null,
    thumbnailUrl: null,
    // A space opens its page; one without a page yet opens Studio's, which makes it.
    href: space.pageId ? pageHref(space.pageId) : spaceViewHref(space.id),
    archived: false,
  };
}
