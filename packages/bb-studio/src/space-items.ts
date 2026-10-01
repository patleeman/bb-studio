// Spaces as Studio items: the kind Studio itself provides, so a space lists,
// searches and opens as a tab like any add-on's item.
import { STUDIO_PLUGIN_ID, type StudioKind } from "@bb-studio/kit/contract";
import { plural } from "@bb-studio/kit/format";
import type { HubItem } from "./hub";
import { NEW_SPACE_EVENT } from "./ids";
import { pageHref } from "./space-page";
import { spacePath, type Space } from "./spaces";

export const SPACE_KIND = "space";

export const spaceKind: StudioKind = {
  id: SPACE_KIND,
  label: "Space",
  plural: "Spaces",
  icon: "Layers",
  columns: [{ id: "members", label: "Holds" }],
  actions: [],
  create: { mode: "event", event: NEW_SPACE_EVENT },
  canArchive: false,
  capabilities: { create: true, move: false, archive: false, delete: true, rename: false, duplicate: false, export: false, comments: false, versions: false, links: false },
  mentionProviderId: null,
  blurb: "A home for a piece of work: its documents, projects, threads and channels.",
};

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
    href: space.pageId ? pageHref(space.pageId) : spacePath(space.id),
    archived: false,
  };
}
