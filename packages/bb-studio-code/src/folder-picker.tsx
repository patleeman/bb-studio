// Pick a folder on the computer running BB. Browsers' own pickers never
// reveal a real path, and BB's native one isn't open to plugins, so this
// walks the server's folders instead.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, ICON_BUTTON, Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import type { z } from "zod";
import type { CodeContract } from "./shared";

type Listing = z.infer<CodeContract["browseFolders"]["output"]>;

export function FolderPicker({ onPick, onCancel, exclude }: { onPick(path: string): void; onCancel(): void; exclude: string[] }) {
  const rpc = useRpc<CodeContract>();
  // null: the server's home folder.
  const [path, setPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    rpc.call("browseFolders", { path, showHidden }).then(
      (result) => { if (live) setListing(result); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, path, showHidden]);

  const parts = listing ? listing.path.split("/").filter(Boolean) : [];
  const added = listing ? exclude.includes(listing.path) : false;
  return (
    <div role="dialog" aria-label="Choose a folder" className="space-y-2 rounded-md border border-border bg-background p-2">
      <div className="flex items-center gap-1">
        <button type="button" className={ICON_BUTTON} title="Up one folder" aria-label="Up one folder" disabled={!listing?.parent} onClick={() => listing?.parent && setPath(listing.parent)}>
          <Icon name="ArrowUp" className="size-4" />
        </button>
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 font-mono text-xs">
          <button type="button" className="rounded px-1 hover:bg-state-hover" onClick={() => setPath("/")}>/</button>
          {parts.map((part, index) => (
            <span key={index} className="flex items-center gap-0.5">
              {index > 0 && <span className="text-muted-foreground">/</span>}
              <button type="button" className="max-w-40 truncate rounded px-1 hover:bg-state-hover" onClick={() => setPath(`/${parts.slice(0, index + 1).join("/")}`)}>{part}</button>
            </span>
          ))}
        </nav>
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.currentTarget.checked)} />
          Show hidden
        </label>
      </div>
      <div className="max-h-64 overflow-auto rounded border border-border">
        {error ? (
          <p role="alert" className="p-2 text-xs text-destructive">{error}</p>
        ) : !listing ? (
          <p role="status" className="p-2 text-xs text-muted-foreground">Loading…</p>
        ) : !listing.folders.length ? (
          <p className="p-2 text-xs text-muted-foreground">No folders here.</p>
        ) : (
          <ul>
            {listing.folders.map((folder) => (
              <li key={folder.path}>
                <button type="button" className="flex min-h-8 w-full items-center gap-2 px-2 text-left text-sm hover:bg-state-hover" onClick={() => setPath(folder.path)}>
                  <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{folder.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        {listing && !listing.choosable && <span className="mr-auto text-xs text-muted-foreground">Open a folder inside this one.</span>}
        <button type="button" className={BAR_BUTTON} onClick={onCancel}>Cancel</button>
        <button type="button" className={BAR_BUTTON} disabled={!listing?.choosable || added} onClick={() => listing && onPick(listing.path)}>
          <Icon name="FolderPlus" className="size-4" /> {added ? "Already added" : "Add this folder"}
        </button>
      </div>
    </div>
  );
}
