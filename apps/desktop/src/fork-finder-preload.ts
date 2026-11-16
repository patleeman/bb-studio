import type { IpcRenderer } from "electron";
import {
  FORK_FINDER_LINK_MENU_CHANNEL,
  FORK_FINDER_LIST_CHANNEL,
  FORK_FINDER_SHOW_CHANNEL,
  finderLabel,
  type ForkFileLinkMenuRequest,
  type ForkFinderShowResult,
  type ForkFolderListResult,
} from "./fork-finder-ipc.js";

export function forkFinderApi(ipcRenderer: IpcRenderer): {
  experimental_finderLabel: string;
  experimental_showInFinder(path: string): Promise<ForkFinderShowResult>;
  experimental_listFolder(path: string): Promise<ForkFolderListResult>;
  experimental_fileLinkMenu(request: ForkFileLinkMenuRequest): Promise<boolean>;
} {
  return {
    experimental_finderLabel: finderLabel(process.platform),
    experimental_showInFinder: (path) =>
      ipcRenderer.invoke(FORK_FINDER_SHOW_CHANNEL, path),
    experimental_listFolder: (path) =>
      ipcRenderer.invoke(FORK_FINDER_LIST_CHANNEL, path),
    experimental_fileLinkMenu: (request) =>
      ipcRenderer.invoke(FORK_FINDER_LINK_MENU_CHANNEL, request),
  };
}
