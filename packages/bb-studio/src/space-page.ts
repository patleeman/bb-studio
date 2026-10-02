// A space's home is a Pages page, made from this template when the space is
// made or first opened. Its widgets are Pages `space` embeds that show the
// space's recent items, threads, channels and projects, and buttons that make
// things in it; the user writes around them, moves them or removes them.
import type { Space } from "./spaces";

export const PAGES_PLUGIN_ID = "pages";

/** What each of a space page's widgets shows, as `<space id>/<section>`. */
export const SPACE_WIDGETS = ["actions", "recent", "threads", "channels", "projects"] as const;
export type SpaceWidget = (typeof SPACE_WIDGETS)[number];

/**
 * The template's version. A widget added to the template later gets the next
 * version in WIDGET_SINCE, so pages made from an older template gain it once.
 */
export const SPACE_TEMPLATE_VERSION = 1;
const WIDGET_SINCE: Record<SpaceWidget, number> = { actions: 1, recent: 1, threads: 1, channels: 1, projects: 1 };
const WIDGET_HEADINGS: Record<SpaceWidget, string | null> = {
  actions: null,
  recent: "Recent",
  threads: "Threads",
  channels: "Bot threads",
  projects: "Projects",
};

export function pageHref(pageId: string): string {
  return `/plugins/${PAGES_PLUGIN_ID}/pages/${encodeURIComponent(pageId)}`;
}

const widget = (space: Space, section: SpaceWidget) => ["```embed", JSON.stringify({ kind: "space", target: `${space.id}/${section}` }), "```"].join("\n");

/** Each widget, under its heading, as page Markdown. */
export function widgetsMarkdown(space: Space, sections: readonly SpaceWidget[]): string {
  return sections.flatMap((section) => [...(WIDGET_HEADINGS[section] ? [`## ${WIDGET_HEADINGS[section]}`] : []), widget(space, section)]).join("\n\n");
}

/** The page a new space starts with. */
export function spacePageMarkdown(space: Space): string {
  return [space.description || "What this space is for. Write anything here, link what matters, and move or remove the widgets below.", widgetsMarkdown(space, SPACE_WIDGETS)].join("\n\n");
}

/** The space's widgets that the page's Markdown holds. */
export function pageWidgets(markdown: string, spaceId: string): Set<SpaceWidget> {
  const found = new Set<SpaceWidget>();
  for (const match of markdown.matchAll(/"target"\s*:\s*"([^"]+)"/g)) {
    const [id, section] = match[1]!.split("/");
    if (id === spaceId && (SPACE_WIDGETS as readonly string[]).includes(section ?? "")) found.add(section as SpaceWidget);
  }
  return found;
}

/** Widgets the template gained after `version`. */
export function widgetsSince(version: number): SpaceWidget[] {
  return SPACE_WIDGETS.filter((section) => WIDGET_SINCE[section] > version);
}
