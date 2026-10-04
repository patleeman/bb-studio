// A space's page is its brief: what the space is for, the plan, and the
// decisions, kept current by its lead. It's an ordinary Pages page, made
// when the space is made or first opened. The space's live status is the
// status tab beside the lead, not this page.
import type { Space } from "./spaces";

export const PAGES_PLUGIN_ID = "pages";

export function pageHref(pageId: string): string {
  return `/plugins/${PAGES_PLUGIN_ID}/pages/${encodeURIComponent(pageId)}`;
}

/** The page a new space starts with. */
export function spacePageMarkdown(space: Space): string {
  return [space.description || "What this space is for.", "## Plan", "## Decisions"].join("\n\n");
}
