import type { StudioLink, StudioRef } from "@bb-studio/kit/server";

/** Item mentions and local Studio links in a page's Markdown. */
export function outgoingStudioLinks(pageId: string, markdown: string): StudioLink[] {
  const from: StudioRef = { pluginId: "pages", id: pageId };
  const found = new Map<string, StudioLink>();
  const add = (pluginId: string, id: string, kind: StudioLink["kind"]) => {
    if (!pluginId || !id || pluginId === "studio") return;
    const link = { from, to: { pluginId, id }, kind, source: "pages" };
    found.set(`${pluginId}:${id}:${kind}`, link);
  };
  for (const match of markdown.matchAll(/\]\(item:([a-z0-9-]+):([A-Za-z0-9_-]+)\)/g)) add(match[1]!, match[2]!, "mention");
  for (const match of markdown.matchAll(/(?:https?:\/\/[^\s)]+)?\/plugins\/([a-z0-9-]+)\/[a-z0-9-]+\/([A-Za-z0-9_-]+)/g)) add(match[1]!, match[2]!, "embed");
  return [...found.values()];
}
