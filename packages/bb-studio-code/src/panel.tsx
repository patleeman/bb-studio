import { useEffect, useRef, useState, type RefObject } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { AddOnPanel, BAR_BUTTON, BarTitle, ICON_BUTTON, Icon, ItemHeader, ItemMenu } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { toast } from "sonner";
import { FileBrowser } from "./file-browser";
import { themeChanges, useThemeSync } from "./theme-sync";
import { CHANNEL, HIDDEN_RELEASE_MS, KIND_ID, PANEL_PATH, PLUGIN_ID, isWorkspaceId, workspaceHref, type CodeContract, type ServerStatus, type Workspace } from "./shared";

export function CodePanel({ subPath }: { subPath: string }) {
  return (
    <AddOnPanel
      subPath={subPath}
      pluginId={PLUGIN_ID}
      title="Workspaces"
      kind={KIND_ID}
      panelPath={PANEL_PATH}
      channel={CHANNEL}
      isItemId={isWorkspaceId}
      renderItem={(id, { backLabel, onBack }) => <WorkspaceView key={id} id={id} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

/**
 * VS Code answers on the computer running BB, at 127.0.0.1. Only a BB page
 * served from that computer can reach it; phones and other computers get the
 * read-only browser instead.
 */
export function canEmbedEditor(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** Whether the element is on screen: laid out, and its window visible. */
function useShown(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    // Retained panels stay mounted but hidden, so poll layout as well.
    const check = () => setShown(document.visibilityState === "visible" && (ref.current?.getClientRects().length ?? 0) > 0);
    check();
    const timer = setInterval(check, 5000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [ref]);
  return shown;
}

/**
 * Signs an editor in: posts this run's password to code-server's /login,
 * into the frame or window named `target`. code-server sets its session
 * cookie and redirects to the workspace.
 */
export function signIn(url: string, password: string, target: string): void {
  const address = new URL(url);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${address.origin}/login?to=${encodeURIComponent(`${address.pathname}${address.search}`)}`;
  form.target = target;
  form.style.display = "none";
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "password";
  field.value = password;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

const STATUS_TEXT: Record<ServerStatus["state"], string> = {
  stopped: "VS Code isn't running.",
  installing: "Downloading code-server (about 200 MB, once)…",
  starting: "Starting VS Code…",
  running: "",
  failed: "VS Code couldn't start.",
};

export function WorkspaceView({ id, backLabel, onBack, compact = false }: {
  id: string;
  backLabel: string;
  onBack(): void;
  /** A thread's narrow side panel: no item chat. */
  compact?: boolean;
}) {
  const rpc = useRpc<CodeContract>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const embed = canEmbedEditor(window.location.hostname);
  useThemeSync(embed);
  // VS Code takes new colors on load; reloading keeps its open files.
  const [frameLoad, setFrameLoad] = useState(0);
  useEffect(() => {
    const reload = () => setFrameLoad((n) => n + 1);
    themeChanges.addEventListener("change", reload);
    return () => themeChanges.removeEventListener("change", reload);
  }, []);
  const body = useRef<HTMLDivElement>(null);
  const shown = useShown(body);
  // After Stop, the user starts it again; otherwise a visible view opens it.
  const [userStopped, setUserStopped] = useState(false);
  // Out of sight for a while, the frame lets go so VS Code's idle timer runs.
  const [released, setReleased] = useState(false);
  useEffect(() => {
    if (shown) { setReleased(false); return; }
    const timer = setTimeout(() => setReleased(true), HIDDEN_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useRealtime(CHANNEL, (event) => {
    if ((event as { id?: string } | null)?.id === id) setVersion((n) => n + 1);
  });
  useEffect(() => {
    let live = true;
    rpc.call("get", { id }).then(
      (result) => { if (!live) return; setWorkspace(result.workspace); setStatus(result.status); setLoadError(result.workspace ? "" : "Workspace not found."); },
      (error) => { if (live) setLoadError(errorMessage(error)); },
    );
    return () => { live = false; };
  }, [rpc, id, version]);

  const opening = useRef(false);
  const open = () => {
    if (opening.current) return;
    opening.current = true;
    setUserStopped(false);
    void rpc.call("open", { id }).then(
      (result) => setStatus(result.status),
      (error) => toast.error(errorMessage(error)),
    ).finally(() => { opening.current = false; });
  };
  const stop = () => {
    setUserStopped(true);
    void rpc.call("stop", { id }).then((result) => setStatus(result.status), (error) => toast.error(errorMessage(error)));
  };
  useEffect(() => {
    if (embed && shown && !userStopped && workspace?.folders.length && status?.state === "stopped") open();
  }, [embed, shown, userStopped, workspace, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (changes: { title?: string; folders?: string[] }) =>
    rpc.call("update", { id, ...changes }).then(
      (result) => { setWorkspace(result.workspace); return true; },
      (error) => { toast.error(errorMessage(error)); return false; },
    );

  if (!workspace)
    return (
      <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
        <ItemHeader backLabel={backLabel} onBack={onBack} />
        <p role={loadError ? "alert" : "status"} className={`p-6 text-sm ${loadError ? "text-destructive" : "text-muted-foreground"}`}>{loadError || "Loading workspace…"}</p>
      </div>
    );

  const url = status?.state === "running" ? status.url : null;
  const password = status?.state === "running" ? status.password : null;
  const showFolders = embed && (editing || !workspace.folders.length);
  const reference = { title: workspace.title, href: workspaceHref(id) };
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      <ItemHeader
        backLabel={backLabel}
        onBack={onBack}
        leading={<BarTitle title={workspace.title} label="Workspace name" placeholder="Untitled workspace" onRename={(title) => { if (title) void update({ title }); }} />}
        item={reference}
        chatAction={compact ? null : undefined}
        trailing={
          <>
            {embed && (
              <button type="button" className={ICON_BUTTON} title="Folders in this workspace" aria-label="Folders" aria-pressed={showFolders} onClick={() => setEditing((value) => !value)}>
                <Icon name="FolderEdit" className="size-4" />
              </button>
            )}
            {url ? (
              <>
                <button type="button" className={ICON_BUTTON} title="Open VS Code in a browser window" aria-label="Open in browser" onClick={() => { if (password) signIn(url, password, "_blank"); }}>
                  <Icon name="ExternalLink" className="size-4" />
                </button>
                <button type="button" className={ICON_BUTTON} title="Stop VS Code" aria-label="Stop" onClick={stop}>
                  <Icon name="Square" className="size-4" />
                </button>
              </>
            ) : null}
            <ItemMenu reference={reference} item={{ pluginId: PLUGIN_ID, id }} projectId={workspace.projectId} onMoved={() => setVersion((n) => n + 1)} />
          </>
        }
      />
      {showFolders && <FolderEditor folders={workspace.folders} onChange={(folders) => update({ folders })} />}
      <div ref={body} className="relative min-h-0 flex-1">
        {!embed ? (
          <FileBrowser workspace={workspace} />
        ) : url && password && !released ? (
          <EditorFrame key={`${url}#${frameLoad}`} url={url} password={password} label={`VS Code: ${workspace.title}`} />
        ) : workspace.folders.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p role={status?.state === "failed" ? "alert" : "status"} className="text-sm text-muted-foreground">{STATUS_TEXT[status?.state ?? "stopped"]}</p>
            {status?.error && <pre className="max-w-xl whitespace-pre-wrap text-left text-xs text-destructive">{status.error}</pre>}
            {(status?.state === "stopped" || status?.state === "failed") && (
              <button type="button" className={BAR_BUTTON} onClick={open}>
                <Icon name="Play" className="size-4" /> Open in VS Code
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** VS Code in a frame, signed in with this run's password. */
function EditorFrame({ url, password, label }: { url: string; password: string; label: string }) {
  const [name] = useState(() => `studio-code-${Math.random().toString(36).slice(2)}`);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (frame.current) signIn(url, password, name);
  }, [url, password, name]);
  return (
    <iframe
      ref={frame}
      name={name}
      // aria-label, not title: a title shows as a tooltip over the whole editor.
      aria-label={label}
      className="absolute inset-0 size-full border-0"
      allow="clipboard-read; clipboard-write"
    />
  );
}

function FolderEditor({ folders, onChange }: { folders: string[]; onChange(folders: string[]): Promise<boolean> }) {
  const rpc = useRpc<CodeContract>();
  const [projects, setProjects] = useState<{ id: string; name: string; path: string }[]>([]);
  const [path, setPath] = useState("");
  useEffect(() => {
    void rpc.call("projects", null).then((result) => setProjects(result.projects), () => undefined);
  }, [rpc]);
  const add = async (folder: string) => {
    if (folder.trim() && (await onChange([...folders, folder.trim()]))) setPath("");
  };
  const unused = projects.filter((project) => !folders.includes(project.path));
  return (
    <section aria-label="Folders" className="space-y-3 border-b border-border px-4 py-3 text-sm">
      {folders.length ? (
        <ul className="space-y-1">
          {folders.map((folder) => (
            <li key={folder} className="flex items-center gap-2">
              <Icon name="Folder" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={folder}>{folder}</span>
              <button type="button" className={ICON_BUTTON} title="Remove from workspace" aria-label={`Remove ${folder}`} onClick={() => void onChange(folders.filter((other) => other !== folder))}>
                <Icon name="X" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Add the folders this workspace opens. VS Code shows them side by side.</p>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void add(path); }}>
        <input
          aria-label="Folder path"
          value={path}
          onChange={(event) => setPath(event.currentTarget.value)}
          placeholder="/full/path/to/folder or ~/folder"
          className="h-8 min-w-60 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs"
        />
        <button type="submit" className={BAR_BUTTON} disabled={!path.trim()}>
          <Icon name="FolderPlus" className="size-4" /> Add
        </button>
        {unused.length > 0 && (
          <select
            aria-label="Add a project's folder"
            value=""
            onChange={(event) => { if (event.currentTarget.value) void add(event.currentTarget.value); }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">Add a project…</option>
            {unused.map((project) => <option key={project.id} value={project.path}>{project.name}</option>)}
          </select>
        )}
      </form>
    </section>
  );
}
