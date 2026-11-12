import { openLinkFromAnywhere } from "../links/open";
import { howFor, parseLink, type LinkModifiers, type LinkOutcome } from "../links/router";

export interface LinkClick { modifiers: LinkModifiers }

interface LinkHandlerSlots {
  experimental_linkHandler?: (registration: { id: string; handle: (url: string, click?: LinkClick) => boolean }) => void;
}

export function handleStudioLink(url: string, click: LinkClick | undefined, origin: string, open: (link: string, options: { how: ReturnType<typeof howFor>; source: "transcript" }) => Promise<LinkOutcome>): boolean {
  const target = parseLink(url, origin);
  if (!target || target.type !== "entity") return false;
  void open(target.link, { how: howFor(click?.modifiers), source: "transcript" });
  return true;
}

export function registerStudioLinkHandler(slots: object): boolean {
  const target = slots as LinkHandlerSlots;
  if (typeof target.experimental_linkHandler !== "function") return false;
  target.experimental_linkHandler({
    id: "studio-items",
    handle: (url, click) => handleStudioLink(url, click, window.location.origin, (link, options) => openLinkFromAnywhere(link, options)),
  });
  return true;
}
