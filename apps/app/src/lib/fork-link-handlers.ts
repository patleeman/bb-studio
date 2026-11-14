import type { ExperimentalLinkClick } from "@get-bb/plugin-sdk";
import { getPluginSlotSnapshot } from "./plugin-slots";
import { resolveRouteHref } from "./route-paths";
import { isMentionHref } from "@/components/ui/markdown-mention-links.fork";

const CONTENT_ROOT_SELECTOR = "[data-markdown-preview]";

export function openUrlWithPlugin(
  url: string,
  click?: ExperimentalLinkClick,
): boolean {
  const handlers = [...getPluginSlotSnapshot().linkHandlers].sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId),
  );
  for (const handler of handlers) {
    try {
      if (handler.handle(url, click) === true) return true;
    } catch (error) {
      console.warn(
        `[plugin:${handler.pluginId}] link handler "${handler.id}" failed`,
        error,
      );
    }
  }
  return false;
}

export function linkClickOf(event: MouseEvent): ExperimentalLinkClick {
  return {
    modifiers: {
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
    },
  };
}

function asksForClick(
  anchor: HTMLAnchorElement,
  click: ExperimentalLinkClick,
  origin: string,
): boolean {
  const { meta, ctrl, shift } = click.modifiers;
  if (meta || ctrl || shift) return true;
  if (anchor.closest(CONTENT_ROOT_SELECTOR) === null) return false;
  return (
    resolveRouteHref({
      currentOrigin: origin,
      href: anchor.getAttribute("href") ?? "",
    }) !== null
  );
}

function claimMentionClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
  openWithPlugin: typeof openUrlWithPlugin,
): boolean {
  const href = anchor.getAttribute("href");
  if (!isMentionHref(href)) return false;
  openWithPlugin(href ?? "", linkClickOf(event));
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function handleLinkClick(
  event: MouseEvent,
  openWithPlugin: typeof openUrlWithPlugin = openUrlWithPlugin,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]:not([download])")
      : null;
  if (anchor === null) return false;
  if (claimMentionClick(event, anchor, openWithPlugin)) return true;
  if (getPluginSlotSnapshot().linkHandlers.length === 0) return false;
  const click = linkClickOf(event);
  if (!asksForClick(anchor, click, window.location.origin)) return false;
  if (!openWithPlugin(anchor.href, click)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function installLinkClickCapture(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
  isTrusted: (event: MouseEvent) => boolean = (event) => event.isTrusted,
): () => void {
  const listener = (event: Event) => {
    if (event instanceof MouseEvent && isTrusted(event)) handleLinkClick(event);
  };
  target.addEventListener("click", listener, true);
  return () => target.removeEventListener("click", listener, true);
}

if (typeof document !== "undefined") {
  installLinkClickCapture(document);
}
