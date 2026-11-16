import type { BbDesktopApi } from "@bb/desktop-contract";
import { resolveAbsoluteFilePath } from "@bb/shared-ui/lib/absolute-file-path";
import { parseLocalFileHref } from "@/components/ui/markdown-local-file-link";
import { isMentionHref } from "@/components/ui/markdown-mention-links.fork";
import { getBbDesktopInfo } from "./bb-desktop";
import { resolveRouteHref } from "./route-paths";

type FinderDesktopApi = Required<
  Pick<
    BbDesktopApi,
    | "experimental_finderLabel"
    | "experimental_showInFinder"
    | "experimental_listFolder"
    | "experimental_fileLinkMenu"
  >
>;

export type ForkFolderListResult = Awaited<
  ReturnType<FinderDesktopApi["experimental_listFolder"]>
>;
export type ForkFolderListing = Extract<
  ForkFolderListResult,
  { kind: "folder" }
>;
export type ForkFolderEntry = ForkFolderListing["entries"][number];

export type ForkFolderRow =
  | { kind: "parent"; path: string }
  | { kind: "entry"; entry: ForkFolderEntry };

const MARKDOWN_ROOT_SELECTOR = "[data-markdown-preview]";
export const LOCAL_HOST_ATTRIBUTE = "data-fork-local-host";
const LOCAL_HOST_SELECTOR = `[${LOCAL_HOST_ATTRIBUTE}]`;
const NETWORK_ROOTS = ["/net", "/network"];

export function isNetworkPath(value: string): boolean {
  if (value.startsWith("//") || value.startsWith("\\\\")) return true;
  const lower = value.toLowerCase();
  return NETWORK_ROOTS.some(
    (root) => lower === root || lower.startsWith(`${root}/`),
  );
}

export function forkFinder(
  desktop: BbDesktopApi | null = getBbDesktopInfo(),
): FinderDesktopApi | null {
  if (
    desktop === null ||
    desktop.experimental_showInFinder === undefined ||
    desktop.experimental_listFolder === undefined ||
    desktop.experimental_fileLinkMenu === undefined
  ) {
    return null;
  }
  return {
    experimental_finderLabel:
      desktop.experimental_finderLabel ?? "Show in Finder",
    experimental_showInFinder: desktop.experimental_showInFinder,
    experimental_listFolder: desktop.experimental_listFolder,
    experimental_fileLinkMenu: desktop.experimental_fileLinkMenu,
  };
}

export function resolveForkLocalPath({
  hasFinder,
  isLocal,
  path,
  rootPath,
}: {
  hasFinder: boolean;
  isLocal: boolean;
  path: string;
  rootPath: string | null;
}): string | null {
  if (!hasFinder || !isLocal) return null;
  const resolved = resolveAbsoluteFilePath({ path, rootPath });
  return resolved === null || isNetworkPath(resolved) ? null : resolved;
}

const folderNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortFolderEntries(
  entries: readonly ForkFolderEntry[],
): ForkFolderEntry[] {
  return [...entries].sort((left, right) => {
    const leftGroup = left.kind === "file" ? 1 : 0;
    const rightGroup = right.kind === "file" ? 1 : 0;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    return folderNameCollator.compare(left.name, right.name);
  });
}

export function folderRows(listing: ForkFolderListing): ForkFolderRow[] {
  const rows: ForkFolderRow[] = sortFolderEntries(listing.entries).map(
    (entry) => ({ kind: "entry", entry }),
  );
  return listing.parent === null
    ? rows
    : [{ kind: "parent", path: listing.parent }, ...rows];
}

const countFormat = new Intl.NumberFormat("en-US");

export function folderNotes(listing: ForkFolderListing): string[] {
  const notes: string[] = [];
  if (listing.entries.length < listing.totalCount) {
    notes.push(
      `Showing ${countFormat.format(listing.entries.length)} of ${countFormat.format(listing.totalCount)}`,
    );
  }
  if (listing.hiddenCount > 0) {
    notes.push(`${countFormat.format(listing.hiddenCount)} hidden`);
  }
  return notes;
}

export function showInFinderFailureMessage(
  result: Awaited<ReturnType<FinderDesktopApi["experimental_showInFinder"]>>,
): string | null {
  if (result === "missing") return "Not found on this Mac";
  if (result === "invalid") return "Not a local path";
  return null;
}

export function fileLinkPathOf(
  anchor: HTMLAnchorElement,
  origin: string,
): string | null {
  if (anchor.closest(MARKDOWN_ROOT_SELECTOR) === null) return null;
  if (anchor.closest(LOCAL_HOST_SELECTOR) === null) return null;
  const href = anchor.getAttribute("href");
  if (href === null || href.length === 0 || isMentionHref(href)) return null;
  if (!href.startsWith("file:") && !href.startsWith("/")) return null;
  if (resolveRouteHref({ currentOrigin: origin, href }) !== null) return null;
  const path =
    parseLocalFileHref({
      absoluteLinks: { kind: "contained", rootPath: "/" },
      href,
    })?.path ?? null;
  return path === null || isNetworkPath(path) ? null : path;
}

export function handleFileLinkContextMenu(
  event: MouseEvent,
  finder: FinderDesktopApi | null = forkFinder(),
  origin: string = window.location.origin,
): boolean {
  if (finder === null || event.defaultPrevented) return false;
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
  if (anchor === null) return false;
  const path = fileLinkPathOf(anchor, origin);
  if (path === null) return false;
  event.preventDefault();
  void finder.experimental_fileLinkMenu({
    path,
    href: anchor.getAttribute("href") ?? "",
    selectionText:
      anchor.ownerDocument.defaultView?.getSelection()?.toString() ?? "",
    point: { x: event.clientX, y: event.clientY },
  });
  return true;
}

export function installFileLinkContextMenu(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
): () => void {
  const listener = (event: Event) => {
    if (event instanceof MouseEvent) handleFileLinkContextMenu(event);
  };
  target.addEventListener("contextmenu", listener);
  return () => target.removeEventListener("contextmenu", listener);
}

if (
  typeof window !== "undefined" &&
  window.bbDesktop?.experimental_fileLinkMenu !== undefined
) {
  installFileLinkContextMenu(document);
}
