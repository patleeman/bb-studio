// A space's files, read-only: the worktree of one of its threads as a tree,
// and the open file's text beside it. It follows the thread you came from
// when that thread is in the space, else the space's newest thread.
import { Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import type { rpcContract, SpaceView } from "../contract";

type Worktree = { threadId: string; title: string; updatedAt: number; path: string };
type Folder = { name: string; path: string; folders: Map<string, Folder>; files: string[] };

/** The flat file list as nested folders. */
export function fileTree(files: readonly string[]): Folder {
  const root: Folder = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) {
        next = { name: part, path: folder.path ? `${folder.path}/${part}` : part, folders: new Map(), files: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  return root;
}

export function SpaceFiles({ space }: { space: SpaceView }) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [listing, setListing] = useState<{ threadId: string; files: string[]; truncated: boolean } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string | null; reason: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setWorktrees(null);
    rpc.call("spaceWorktrees", { id: space.id }).then(
      (result) => live && setWorktrees(result.worktrees),
      (cause) => live && (setWorktrees([]), setError(errorMessage(cause))),
    );
    return () => { live = false; };
  }, [rpc, space.id]);

  // Follow the thread you came from while it's in the space.
  const threadId = useMemo(() => {
    if (!worktrees?.length) return null;
    const has = (id: string | null | undefined) => (id && worktrees.some((each) => each.threadId === id) ? id : null);
    return has(picked) ?? has(context.threadId) ?? worktrees[0]!.threadId;
  }, [worktrees, picked, context.threadId]);

  useEffect(() => {
    if (!threadId) return;
    let live = true;
    setListing(null);
    setFile(null);
    setOpen(new Set());
    setError("");
    rpc.call("spaceFiles", { threadId }).then(
      (result) => live && setListing({ threadId, files: result.files, truncated: result.truncated }),
      (cause) => live && setError(errorMessage(cause)),
    );
    return () => { live = false; };
  }, [rpc, threadId]);

  useEffect(() => {
    if (!file || !threadId) return;
    let live = true;
    setText(null);
    rpc.call("spaceFile", { threadId, path: file }).then(
      (result) => live && setText(result),
      (cause) => live && setText({ text: null, reason: errorMessage(cause) }),
    );
    return () => { live = false; };
  }, [rpc, threadId, file]);

  const tree = useMemo(() => fileTree(listing?.files ?? []), [listing]);
  const current = worktrees?.find((each) => each.threadId === threadId);

  if (worktrees === null) return <p role="status" className="py-6 text-sm text-muted-foreground">Loading files…</p>;
  if (!worktrees.length) {
    return <p className="py-6 text-sm text-muted-foreground">{error || "No thread in this space has a worktree yet."}</p>;
  }

  const toggle = (path: string) => setOpen((was) => {
    const next = new Set(was);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const renderFolder = (folder: Folder, depth: number): React.ReactNode => (
    <>
      {[...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
        <div key={child.path}>
          <button type="button" aria-expanded={open.has(child.path)} onClick={() => toggle(child.path)} style={{ paddingLeft: `${depth * 12 + 8}px` }} className="flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm hover:bg-state-hover">
            <Icon name={open.has(child.path) ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" />
            <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{child.name}</span>
          </button>
          {open.has(child.path) ? renderFolder(child, depth + 1) : null}
        </div>
      ))}
      {folder.files.map((path) => (
        <button key={path} type="button" aria-current={file === path ? "true" : undefined} onClick={() => setFile(path)} style={{ paddingLeft: `${depth * 12 + 26}px` }} className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-sm hover:bg-state-hover ${file === path ? "bg-state-active font-medium" : ""}`}>
          <Icon name="File" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{path.split("/").at(-1)}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-80 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <label className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">Worktree of</span>
          <select aria-label="Thread worktree" value={threadId ?? ""} onChange={(event) => setPicked(event.target.value)} className="h-8 min-w-0 max-w-80 truncate rounded border border-border bg-background px-2">
            {worktrees.map((each) => (
              <option key={each.threadId} value={each.threadId}>{each.title}</option>
            ))}
          </select>
        </label>
        {current ? <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={current.path}>{current.path}</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <nav aria-label="Files" className="w-72 shrink-0 overflow-auto border-r border-border py-1">
          {error ? (
            <p role="alert" className="p-3 text-sm text-destructive">{error}</p>
          ) : listing === null ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : !listing.files.length ? (
            <p className="p-3 text-sm text-muted-foreground">This worktree is empty.</p>
          ) : (
            <>
              {renderFolder(tree, 0)}
              {listing.truncated ? <p className="p-3 text-xs text-muted-foreground">Showing the first {listing.files.length} files.</p> : null}
            </>
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto">
          {!file ? (
            <p className="p-4 text-sm text-muted-foreground">Pick a file to read it.</p>
          ) : text === null ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : text.text !== null ? (
            <>
              <p className="sticky top-0 border-b border-border bg-background px-4 py-2 font-mono text-xs text-muted-foreground">{file}</p>
              <pre className="min-w-max p-4 font-mono text-xs leading-relaxed">{text.text}</pre>
            </>
          ) : (
            <p role="alert" className="p-4 text-sm text-muted-foreground">{text.reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
