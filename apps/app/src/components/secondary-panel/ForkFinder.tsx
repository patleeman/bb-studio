import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { formatByteSize } from "@bb/shared-ui/lib/format-byte-size";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { SourceLoadingSkeleton } from "@/components/code/code-loading-skeletons";
import { appToast } from "@/components/ui/app-toast";
import type { MarkdownLocalFileContextMenuItem } from "@/components/ui/markdown-link-routing";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { localHostDaemonHostIdAtom } from "@/lib/system-config-atoms";
import { useAsyncAtomValue } from "@/lib/use-async-atom-value";
import {
  folderNotes,
  folderRows,
  forkFinder,
  LOCAL_HOST_ATTRIBUTE,
  resolveForkLocalPath,
  showInFinderFailureMessage,
  type ForkFolderEntry,
  type ForkFolderListResult,
  type ForkFolderRow,
} from "@/lib/fork-finder";
import {
  FILE_PREVIEW_WRAPPER_STYLE,
  FilePreviewHeaderFrame,
  FilePreviewPath,
} from "./FilePreviewChrome.js";

export interface ForkLocalPath {
  hostId: string;
  path: string;
}

const HEADER_ICON_BUTTON_CLASS =
  "h-5 w-5 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-state-hover hover:text-foreground [&_[data-icon-root]]:size-3 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_[data-icon-root]]:size-5";

const modifiedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function useDesktopLocalHostId(): string | null {
  return useAsyncAtomValue(localHostDaemonHostIdAtom, null);
}

function useNoLocalHostId(): string | null {
  return null;
}

const useForkLocalHostId =
  forkFinder() === null ? useNoLocalHostId : useDesktopLocalHostId;

export function useForkLocalPath(
  hostId: string | null | undefined,
  path: string,
  rootPath: string | null = null,
): ForkLocalPath | null {
  const localHostId = useForkLocalHostId();
  const resolved = resolveForkLocalPath({
    hasFinder: forkFinder() !== null,
    isLocal: localHostId !== null && hostId === localHostId,
    path,
    rootPath,
  });
  return resolved === null || !hostId ? null : { hostId, path: resolved };
}

export function showInFinder(path: string): void {
  const finder = forkFinder();
  if (finder === null) return;
  void finder.experimental_showInFinder(path).then((result) => {
    const message = showInFinderFailureMessage(result);
    if (message !== null) appToast.error(message);
  });
}

function finderLabel(): string {
  return forkFinder()?.experimental_finderLabel ?? "Show in Finder";
}

export function ForkShowInFinderButton({
  localPath,
  className,
}: {
  localPath: ForkLocalPath | null | undefined;
  className?: string;
}) {
  if (!localPath) return null;
  const label = finderLabel();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(HEADER_ICON_BUTTON_CLASS, className)}
          onClick={() => showInFinder(localPath.path)}
          aria-label={label}
        >
          <Icon name="FolderExport" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ForkShowInFinderMenuItem({
  localPath,
}: {
  localPath: ForkLocalPath | null | undefined;
}) {
  if (!localPath) return null;
  return (
    <DropdownMenuItem onSelect={() => showInFinder(localPath.path)}>
      <Icon name="FolderExport" aria-hidden /> {finderLabel()}
    </DropdownMenuItem>
  );
}

export function forkFinderLinkMenuItems(
  path: string,
  isLocal: boolean,
): MarkdownLocalFileContextMenuItem[] {
  if (!isLocal || forkFinder() === null) return [];
  return [
    {
      id: "show-in-finder",
      label: finderLabel(),
      onSelect: () => showInFinder(path),
    },
  ];
}

type FolderLoad =
  | { kind: "loading" }
  | { kind: "loaded"; result: ForkFolderListResult };

function useFolderListing(path: string | null, revision: number): FolderLoad {
  const [state, setState] = useState<{
    path: string;
    result: ForkFolderListResult;
  } | null>(null);
  const finder = forkFinder();
  useEffect(() => {
    const current = forkFinder();
    if (path === null || current === null) return;
    let live = true;
    current.experimental_listFolder(path).then(
      (result) => {
        if (live) setState({ path, result });
      },
      () => {
        if (live) setState({ path, result: { kind: "missing" } });
      },
    );
    return () => {
      live = false;
    };
  }, [path, revision]);
  if (path === null || finder === null) {
    return { kind: "loaded", result: { kind: "invalid" } };
  }
  if (state === null || state.path !== path) return { kind: "loading" };
  return { kind: "loaded", result: state.result };
}

const LISTED_KINDS = new Set<ForkFolderListResult["kind"]>([
  "folder",
  "unreadable",
  "package",
]);

export function ForkFolderFallback({
  localPath,
  failed,
  children,
}: {
  localPath: ForkLocalPath | null | undefined;
  failed: boolean;
  children: ReactNode;
}) {
  const probe = useFolderListing(
    failed && localPath ? localPath.path : null,
    0,
  );
  if (!localPath) return children;
  if (
    failed &&
    probe.kind === "loaded" &&
    LISTED_KINDS.has(probe.result.kind)
  ) {
    return (
      <ForkFolderListing
        key={localPath.path}
        hostId={localPath.hostId}
        path={localPath.path}
      />
    );
  }
  return (
    <div className="contents" {...{ [LOCAL_HOST_ATTRIBUTE]: "" }}>
      {children}
    </div>
  );
}

export function ForkFolderListing({
  hostId,
  path: initialPath,
}: {
  hostId: string;
  path: string;
}) {
  const navigation = useAppNavigationHost();
  const [path, setPath] = useState(initialPath);
  const [revision, setRevision] = useState(0);
  const load = useFolderListing(path, revision);
  const openRow = useCallback(
    (row: ForkFolderRow) => {
      if (row.kind === "parent") {
        setPath(row.path);
        return;
      }
      if (row.entry.kind === "directory") {
        setPath(row.entry.path);
        return;
      }
      if (row.entry.kind === "package") {
        showInFinder(row.entry.path);
        return;
      }
      navigation.openFilePreview({
        target: { kind: "host", hostId, path: row.entry.path },
        location: null,
      });
    },
    [hostId, navigation],
  );
  const label = finderLabel();

  return (
    <div
      className="@container/page min-h-full"
      style={FILE_PREVIEW_WRAPPER_STYLE}
      data-fork-folder-listing=""
    >
      <FilePreviewHeaderFrame>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon
            name="Folder"
            className="size-4 text-subtle-foreground"
            aria-hidden
          />
          <FilePreviewPath path={path} copyPath={path} />
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={HEADER_ICON_BUTTON_CLASS}
                  onClick={() => setRevision((value) => value + 1)}
                  aria-label="Refresh folder"
                >
                  <Icon name="RotateCcw" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh folder</TooltipContent>
            </Tooltip>
            <ForkShowInFinderButton localPath={{ hostId, path }} />
          </TooltipProvider>
        </div>
      </FilePreviewHeaderFrame>
      <FolderBody load={load} label={label} onOpenRow={openRow} />
    </div>
  );
}

function FolderMessage({
  message,
  path,
  parent,
  label,
  onOpenRow,
}: {
  message: string;
  path: string | null;
  parent: string | null;
  label: string;
  onOpenRow: (row: ForkFolderRow) => void;
}) {
  return (
    <div className="px-2 py-1">
      {parent === null ? null : (
        <table className="w-full table-fixed border-collapse text-sm">
          <tbody>
            <FolderRow
              row={{ kind: "parent", path: parent }}
              label={label}
              onOpen={onOpenRow}
            />
          </tbody>
        </table>
      )}
      <EmptyStatePanel role="alert" className="mx-2 mt-3 rounded-lg">
        <p>{message}</p>
        {path === null ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => showInFinder(path)}
          >
            <Icon name="FolderExport" aria-hidden /> {label}
          </Button>
        )}
      </EmptyStatePanel>
    </div>
  );
}

function FolderBody({
  load,
  label,
  onOpenRow,
}: {
  load: FolderLoad;
  label: string;
  onOpenRow: (row: ForkFolderRow) => void;
}) {
  if (load.kind === "loading") return <SourceLoadingSkeleton />;
  const { result } = load;
  if (result.kind === "unreadable") {
    return (
      <FolderMessage
        message="BB Studio can't read this folder"
        path={result.path}
        parent={result.parent}
        label={label}
        onOpenRow={onOpenRow}
      />
    );
  }
  if (result.kind === "package") {
    return (
      <FolderMessage
        message="Package"
        path={result.path}
        parent={null}
        label={label}
        onOpenRow={onOpenRow}
      />
    );
  }
  if (result.kind !== "folder") {
    return (
      <FolderMessage
        message={result.kind === "file" ? "Not a folder" : "Folder not found"}
        path={null}
        parent={null}
        label={label}
        onOpenRow={onOpenRow}
      />
    );
  }
  const rows = folderRows(result);
  const notes = folderNotes(result);
  return (
    <div className="px-2 py-1">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="px-2 py-1 font-normal">Name</th>
            <th className="w-24 px-2 py-1 text-right font-normal">Size</th>
            <th className="w-44 px-2 py-1 font-normal max-md:hidden">
              Modified
            </th>
            <th className="w-8" aria-label={label} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <FolderRow
              key={row.kind === "parent" ? ".." : row.entry.path}
              row={row}
              label={label}
              onOpen={onOpenRow}
            />
          ))}
        </tbody>
      </table>
      {result.totalCount === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Empty folder</p>
      ) : null}
      {notes.length === 0 ? null : (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          {notes.join(" · ")}
        </p>
      )}
    </div>
  );
}

function sizeLabel(entry: ForkFolderEntry): string {
  if (entry.kind === "directory") return "Folder";
  if (entry.kind === "package") return "Package";
  return entry.sizeBytes === null ? "" : formatByteSize(entry.sizeBytes);
}

function FolderRow({
  row,
  label,
  onOpen,
}: {
  row: ForkFolderRow;
  label: string;
  onOpen: (row: ForkFolderRow) => void;
}) {
  const icon =
    row.kind === "parent"
      ? "ArrowUp"
      : row.entry.kind === "directory"
        ? "Folder"
        : row.entry.kind === "package"
          ? "AppWindow"
          : "File";
  const name = row.kind === "parent" ? ".." : row.entry.name;
  return (
    <tr
      className="group cursor-pointer rounded-sm hover:bg-state-hover"
      data-row-kind={row.kind === "parent" ? "parent" : row.entry.kind}
      onClick={() => onOpen(row)}
    >
      <td className="truncate px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 max-w-full items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          <Icon
            name={icon}
            className="size-4 shrink-0 text-subtle-foreground"
            aria-hidden
          />
          <span className="truncate font-mono">{name}</span>
        </button>
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
        {row.kind === "parent" ? "" : sizeLabel(row.entry)}
      </td>
      <td className="truncate px-2 py-1 text-muted-foreground max-md:hidden">
        {row.kind === "parent" || row.entry.modifiedAtMs === null
          ? ""
          : modifiedFormat.format(row.entry.modifiedAtMs)}
      </td>
      <td className="px-1 py-1 text-right">
        {row.kind === "parent" ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              HEADER_ICON_BUTTON_CLASS,
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={(event) => {
              event.stopPropagation();
              showInFinder(row.entry.path);
            }}
            aria-label={`${label}: ${row.entry.name}`}
          >
            <Icon name="FolderExport" aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  );
}
