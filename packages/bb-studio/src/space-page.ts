// A space's home is a Pages page, made from this template when the space is
// made or first opened. Its widgets are Pages `space` embeds that show the
// space's recent items, threads, channels and projects, and buttons that make
// things in it; the user writes around them, moves them or removes them.
import type { Space } from "./spaces";

export const PAGES_PLUGIN_ID = "pages";

/** What each of a space page's widgets shows, as `<space id>/<section>`. */
export const SPACE_WIDGETS = ["actions", "recent", "threads", "channels", "projects"] as const;

export function pageHref(pageId: string): string {
  return `/plugins/${PAGES_PLUGIN_ID}/pages/${encodeURIComponent(pageId)}`;
}

const widget = (space: Space, section: (typeof SPACE_WIDGETS)[number]) => ["```embed", JSON.stringify({ kind: "space", target: `${space.id}/${section}` }), "```"].join("\n");

/** The page a new space starts with. */
export function spacePageMarkdown(space: Space): string {
  return [
    space.description || "What this space is for. Write anything here, link what matters, and move or remove the widgets below.",
    widget(space, "actions"),
    "## Recent",
    widget(space, "recent"),
    "## Threads",
    widget(space, "threads"),
    "## Channels and messages",
    widget(space, "channels"),
    "## Projects",
    widget(space, "projects"),
  ].join("\n\n");
}
