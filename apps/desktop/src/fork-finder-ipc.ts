import type { BbDesktopApi } from "@bb/desktop-contract";

export const FORK_FINDER_SHOW_CHANNEL = "bb-desktop:fork-finder-show";
export const FORK_FINDER_LIST_CHANNEL = "bb-desktop:fork-finder-list";
export const FORK_FINDER_LINK_MENU_CHANNEL = "bb-desktop:fork-finder-link-menu";

type FinderApi = Required<
  Pick<
    BbDesktopApi,
    | "experimental_showInFinder"
    | "experimental_listFolder"
    | "experimental_fileLinkMenu"
  >
>;

export type ForkFinderShowResult = Awaited<
  ReturnType<FinderApi["experimental_showInFinder"]>
>;
export type ForkFolderListResult = Awaited<
  ReturnType<FinderApi["experimental_listFolder"]>
>;
export type ForkFolderEntry = Extract<
  ForkFolderListResult,
  { kind: "folder" }
>["entries"][number];
export type ForkFileLinkMenuRequest = Parameters<
  FinderApi["experimental_fileLinkMenu"]
>[0];

export function finderLabel(platform: string): string {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Show in Folder";
}
