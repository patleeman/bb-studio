import { studioTextReferences, type ReferenceOptions } from "@bb-studio/kit/contract";
import type { StudioLink, StudioRef } from "@bb-studio/kit/server";

/** Item mentions and local Studio links in a page's Markdown. */
export function outgoingStudioLinks(pageId: string, markdown: string, options: ReferenceOptions = {}): StudioLink[] {
  const from: StudioRef = { pluginId: "pages", id: pageId };
  const found = new Map<string, StudioLink>();
  const add = (pluginId: string, id: string, kind: StudioLink["kind"]) => {
    if (!pluginId || !id || pluginId === "studio") return;
    const link = { from, to: { pluginId, id }, kind, source: "pages" };
    found.set(`${pluginId}:${id}:${kind}`, link);
  };
  for (const { ref, kind } of studioTextReferences(markdown, options)) add(ref.pluginId, ref.id, kind === "mention" ? "mention" : "embed");
  return [...found.values()];
}
