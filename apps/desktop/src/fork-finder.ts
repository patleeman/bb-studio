import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import {
  BrowserWindow,
  clipboard,
  Menu,
  shell,
  type IpcMain,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import {
  FORK_FINDER_LINK_MENU_CHANNEL,
  FORK_FINDER_LIST_CHANNEL,
  FORK_FINDER_SHOW_CHANNEL,
  finderLabel,
  type ForkFileLinkMenuRequest,
  type ForkFinderShowResult,
  type ForkFolderEntry,
  type ForkFolderListResult,
} from "./fork-finder-ipc.js";
import { isForkWindowWebContents } from "./fork-windows.js";

export const FORK_FOLDER_LIST_LIMIT = 2000;
const MAX_PATH_LENGTH = 4096;
const MAX_TEXT_LENGTH = 16_384;
const MAX_POINT = 100_000;
const STAT_CONCURRENCY = 16;
const NETWORK_ROOTS = ["/net", "/network"];
const PACKAGE_EXTENSIONS = new Set([
  ".app",
  ".appex",
  ".bundle",
  ".component",
  ".framework",
  ".kext",
  ".key",
  ".mpkg",
  ".numbers",
  ".pages",
  ".photoslibrary",
  ".pkg",
  ".playground",
  ".plugin",
  ".prefpane",
  ".qlgenerator",
  ".rtfd",
  ".saver",
  ".scptd",
  ".sparsebundle",
  ".systemextension",
  ".workflow",
  ".xcarchive",
  ".xcodeproj",
  ".xcworkspace",
  ".xpc",
]);

export interface ForkFinderShell {
  showItemInFolder(fullPath: string): void;
  openPath(fullPath: string): Promise<string>;
}

export interface ForkFinderDirent {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface ForkFinderFs {
  realpath(target: string): Promise<string>;
  stat(target: string): Promise<Stats>;
  lstat(target: string): Promise<Stats>;
  readdir(target: string): Promise<ForkFinderDirent[]>;
}

const nodeFs: ForkFinderFs = {
  realpath: (target) => fs.realpath(target),
  stat: (target) => fs.stat(target),
  lstat: (target) => fs.lstat(target),
  readdir: (target) => fs.readdir(target, { withFileTypes: true }),
};

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function isNetworkPath(value: string): boolean {
  if (value.startsWith("//") || value.startsWith("\\\\")) return true;
  const lower = value.toLowerCase();
  return NETWORK_ROOTS.some(
    (root) => lower === root || lower.startsWith(`${root}/`),
  );
}

export function parseLocalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return null;
  if (value.includes("\0")) return null;
  if (isNetworkPath(value)) return null;
  if (!path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  return isNetworkPath(normalized) ? null : normalized;
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

function isPermissionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EPERM";
}

async function orNull<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function directoryKind(
  fsApi: ForkFinderFs,
  realPath: string,
): Promise<"plain" | "suffixed" | "package"> {
  const extension = path.extname(realPath).toLowerCase();
  if (PACKAGE_EXTENSIONS.has(extension)) return "package";
  const contents = path.join(realPath, "Contents");
  for (const marker of ["Info.plist", "PkgInfo"]) {
    if ((await orNull(fsApi.lstat(path.join(contents, marker)))) !== null) {
      return "package";
    }
  }
  return extension === "" ? "plain" : "suffixed";
}

async function resolveLocal(
  fsApi: ForkFinderFs,
  target: string,
): Promise<{ real: string; stat: Stats } | "missing" | "invalid"> {
  const real = await orNull(fsApi.realpath(target));
  if (real === null) return "missing";
  if (isNetworkPath(real)) return "invalid";
  const stat = await orNull(fsApi.stat(real));
  return stat === null ? "missing" : { real, stat };
}

export async function showInFinder(
  value: unknown,
  deps: { fs?: ForkFinderFs; shell?: ForkFinderShell } = {},
): Promise<ForkFinderShowResult> {
  const target = parseLocalPath(value);
  if (target === null) return "invalid";
  const fsApi = deps.fs ?? nodeFs;
  const shellApi = deps.shell ?? shell;
  const resolved = await resolveLocal(fsApi, target);
  if (typeof resolved === "string") return resolved;
  if (
    resolved.stat.isDirectory() &&
    (await directoryKind(fsApi, resolved.real)) === "plain"
  ) {
    const error = await shellApi.openPath(resolved.real);
    return error.length === 0 ? "opened" : "missing";
  }
  shellApi.showItemInFolder(target);
  return "shown";
}

function parentOf(target: string): string | null {
  const parent = path.dirname(target);
  return parent === target ? null : parent;
}

async function describeEntry(
  fsApi: ForkFinderFs,
  folder: string,
  name: string,
): Promise<ForkFolderEntry> {
  const entryPath = path.join(folder, name);
  const resolved = await resolveLocal(fsApi, entryPath);
  if (typeof resolved === "string") {
    const link = await orNull(fsApi.lstat(entryPath));
    return {
      name,
      path: entryPath,
      kind: "file",
      sizeBytes: null,
      modifiedAtMs: link === null ? null : finiteOrNull(link.mtimeMs),
    };
  }
  const { real, stat } = resolved;
  const isDirectory = stat.isDirectory();
  return {
    name,
    path: entryPath,
    kind: isDirectory
      ? (await directoryKind(fsApi, real)) === "package"
        ? "package"
        : "directory"
      : "file",
    sizeBytes: isDirectory ? null : stat.size,
    modifiedAtMs: finiteOrNull(stat.mtimeMs),
  };
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

async function isDirectoryEntry(
  fsApi: ForkFinderFs,
  folder: string,
  dirent: ForkFinderDirent,
): Promise<boolean> {
  if (!dirent.isSymbolicLink()) return dirent.isDirectory();
  const stat = await orNull(fsApi.stat(path.join(folder, dirent.name)));
  return stat?.isDirectory() ?? false;
}

export async function listFolder(
  value: unknown,
  deps: { fs?: ForkFinderFs; limit?: number } = {},
): Promise<ForkFolderListResult> {
  const target = parseLocalPath(value);
  if (target === null) return { kind: "invalid" };
  const fsApi = deps.fs ?? nodeFs;
  const limit = deps.limit ?? FORK_FOLDER_LIST_LIMIT;
  const resolved = await resolveLocal(fsApi, target);
  if (resolved === "invalid") return { kind: "invalid" };
  if (resolved === "missing") return { kind: "missing" };
  if (!resolved.stat.isDirectory()) return { kind: "file", path: target };
  if ((await directoryKind(fsApi, resolved.real)) === "package") {
    return { kind: "package", path: target };
  }
  let dirents: ForkFinderDirent[];
  try {
    dirents = await fsApi.readdir(resolved.real);
  } catch (error) {
    return isPermissionError(error)
      ? { kind: "unreadable", path: target, parent: parentOf(target) }
      : { kind: "missing" };
  }
  const visible = dirents.filter((dirent) => !dirent.name.startsWith("."));
  const kinds = await mapLimit(visible, STAT_CONCURRENCY, async (dirent) => ({
    name: dirent.name,
    isDirectory: await isDirectoryEntry(fsApi, resolved.real, dirent),
  }));
  kinds.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory)
      return left.isDirectory ? -1 : 1;
    return nameCollator.compare(left.name, right.name);
  });
  const entries = await mapLimit(
    kinds.slice(0, limit),
    STAT_CONCURRENCY,
    (item) => describeEntry(fsApi, target, item.name),
  );
  return {
    kind: "folder",
    path: target,
    parent: parentOf(target),
    entries,
    totalCount: visible.length,
    hiddenCount: dirents.length - visible.length,
  };
}

export function parseFileLinkMenuRequest(
  value: unknown,
): ForkFileLinkMenuRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const target = parseLocalPath(record.path);
  if (target === null) return null;
  const href = typeof record.href === "string" ? record.href : "";
  const selectionText =
    typeof record.selectionText === "string" ? record.selectionText : "";
  if (href.length > MAX_TEXT_LENGTH || selectionText.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return { path: target, href, selectionText, point: parsePoint(record.point) };
}

function parsePoint(value: unknown): ForkFileLinkMenuRequest["point"] {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  const inRange = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_POINT;
  return inRange(x) && inRange(y) ? { x, y } : null;
}

export function menuPopupPoint(
  point: ForkFileLinkMenuRequest["point"],
  zoomFactor: number,
): { x: number; y: number } | null {
  if (point === null) return null;
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
}

export async function fileLinkMenuTemplate(
  request: ForkFileLinkMenuRequest,
  deps: {
    fs?: ForkFinderFs;
    shell?: ForkFinderShell;
    platform?: NodeJS.Platform;
    writeText?: (text: string) => void;
  } = {},
): Promise<MenuItemConstructorOptions[]> {
  const fsApi = deps.fs ?? nodeFs;
  const platform = deps.platform ?? process.platform;
  const writeText =
    deps.writeText ?? ((text: string) => clipboard.writeText(text));
  const exists = (await orNull(fsApi.lstat(request.path))) !== null;
  const template: MenuItemConstructorOptions[] = [
    {
      label: finderLabel(platform),
      enabled: exists,
      click: () => {
        void showInFinder(request.path, deps);
      },
    },
    { type: "separator" },
  ];
  if (request.href.length > 0) {
    template.push({ label: "Copy Link", click: () => writeText(request.href) });
  }
  template.push({ label: "Copy Path", click: () => writeText(request.path) });
  if (request.selectionText.length > 0) {
    template.push({ type: "separator" }, { role: "copy" });
  }
  return template;
}

async function popFileLinkMenu(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<boolean> {
  const request = parseFileLinkMenuRequest(value);
  if (request === null) return false;
  const template = await fileLinkMenuTemplate(request);
  const window = BrowserWindow.fromWebContents(event.sender);
  const point = menuPopupPoint(request.point, event.sender.getZoomFactor());
  Menu.buildFromTemplate(template).popup({
    ...(window === null ? {} : { window }),
    ...(point ?? {}),
  });
  return true;
}

export interface ForkFinderSender {
  sender: { id: number; mainFrame: unknown };
  senderFrame: unknown;
}

export function isAppWindowSender(
  event: ForkFinderSender,
  appWindowIds: ReadonlySet<number>,
  isForkWindow: (webContentsId: number) => boolean = isForkWindowWebContents,
): boolean {
  if (event.senderFrame === null || event.senderFrame === undefined) {
    return false;
  }
  if (event.senderFrame !== event.sender.mainFrame) return false;
  return appWindowIds.has(event.sender.id) || isForkWindow(event.sender.id);
}

export function registerForkFinderIpc(
  ipcMain: IpcMain,
  appWindowIds: ReadonlySet<number>,
  isForkWindow: (webContentsId: number) => boolean = isForkWindowWebContents,
): void {
  const trusted = (event: IpcMainInvokeEvent) =>
    isAppWindowSender(event, appWindowIds, isForkWindow);
  ipcMain.handle(FORK_FINDER_SHOW_CHANNEL, (event, value: unknown) =>
    trusted(event) ? showInFinder(value) : "invalid",
  );
  ipcMain.handle(FORK_FINDER_LIST_CHANNEL, (event, value: unknown) =>
    trusted(event) ? listFolder(value) : { kind: "invalid" },
  );
  ipcMain.handle(FORK_FINDER_LINK_MENU_CHANNEL, (event, value: unknown) =>
    trusted(event) ? popFileLinkMenu(event, value) : false,
  );
}
