// Where VS Code can't run (a phone, or another computer), the workspace's
// files read-only: folders to walk, and a file's text.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import type { CodeContract, Workspace } from "./shared";

type Entry = { name: string; path: string; dir: boolean };

export function FileBrowser({ workspace }: { workspace: Workspace }) {
  const rpc = useRpc<CodeContract>();
  // The trail of folders opened; empty is the workspace's own folders.
  const [trail, setTrail] = useState<Entry[]>([]);
  const [file, setFile] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [text, setText] = useState<{ text: string | null; reason: string | null } | null>(null);
  const [error, setError] = useState("");
  const folder = trail.at(-1)?.path ?? "";

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError("");
    rpc.call("listDir", { id: workspace.id, path: folder }).then(
      (result) => { if (live) setEntries(result.entries); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, workspace.id, workspace.folders, folder]);
  useEffect(() => {
    if (!file) return;
    let live = true;
    setText(null);
    rpc.call("readFile", { id: workspace.id, path: file.path }).then(
      (result) => { if (live) setText(result); },
      (cause) => { if (live) setText({ text: null, reason: errorMessage(cause) }); },
    );
    return () => { live = false; };
  }, [rpc, workspace.id, file]);

  const crumbs = (
    <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
      <button type="button" className="rounded px-1 hover:bg-state-hover" onClick={() => { setTrail([]); setFile(null); }}>{workspace.title || "Workspace"}</button>
      {trail.map((entry, index) => (
        <span key={entry.path} className="flex items-center gap-1">
          <Icon name="ChevronRight" className="size-3 text-muted-foreground" />
          <button type="button" className="max-w-40 truncate rounded px-1 hover:bg-state-hover" onClick={() => { setTrail(trail.slice(0, index + 1)); setFile(null); }}>{entry.name}</button>
        </span>
      ))}
      {file && (
        <span className="flex items-center gap-1">
          <Icon name="ChevronRight" className="size-3 text-muted-foreground" />
          <span className="max-w-48 truncate px-1 font-medium">{file.name}</span>
        </span>
      )}
    </nav>
  );

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Code" className="size-4 shrink-0" />
          VS Code runs on the computer running BB. Open this workspace there to edit; here you can read its files.
        </p>
        {crumbs}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {file ? (
          text === null ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : text.text !== null ? (
            <pre className="min-w-max p-4 font-mono text-xs leading-relaxed">{text.text}</pre>
          ) : (
            <p role="alert" className="p-4 text-sm text-muted-foreground">{text.reason}</p>
          )
        ) : error ? (
          <p role="alert" className="p-4 text-sm text-destructive">{error}</p>
        ) : entries === null ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : !entries.length ? (
          <p className="p-4 text-sm text-muted-foreground">{folder ? "This folder is empty." : "This workspace has no folders yet."}</p>
        ) : (
          <ul className="p-2">
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-state-hover"
                  onClick={() => (entry.dir ? setTrail([...trail, entry]) : setFile(entry))}
                >
                  <Icon name={entry.dir ? "Folder" : "File"} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
