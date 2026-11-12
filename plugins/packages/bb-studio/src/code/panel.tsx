import type { CodeContract } from "./contract";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, Icon } from "../kit/app/index";
import { errorMessage } from "../kit/format";
import { toast } from "sonner";
import { FileBrowser } from "./file-browser";
import { themeChanges, useThemeSync } from "./theme-sync";
import { CHANNEL, HIDDEN_RELEASE_MS, type EditorOpen, type ServerStatus, type Workspace } from "./shared";
import { showBbPreview } from "./bb-preview";
import { useStudioOpen } from "../ui/studio-open";
import { CHOOSE_PATH, noteWorkspaceTitle } from "./page-title";

/**
 * VS Code answers on the computer running BB, at 127.0.0.1. Only a BB page
 * served from that computer can reach it; phones and other computers get the
 * read-only browser instead.
 */
export function canEmbedEditor(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function editorFrameAllow(url: string): string {
  const { origin } = new URL(url);
  return `clipboard-read ${origin}; clipboard-write ${origin}`;
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

/** How often a view on screen rechecks its server, to notice one that died quietly. */
const STATUS_RECHECK_MS = 15_000;
const STATUS_RECHECK_HIDDEN_MS = 60_000;

const STATUS_TEXT: Record<ServerStatus["state"], string> = {
  stopped: "VS Code isn't running.",
  installing: "Downloading code-server (about 200 MB, once)…",
  starting: "Starting VS Code…",
  running: "",
  failed: "VS Code couldn't start.",
};

/** What a workspace's view shows. It is never blank: every state has something to read, and a way on when it's stuck. */
export type EditorView =
  /** The workspace is being read. */
  | "loading"
  /** It couldn't be read, or is gone: say so, with Retry and another workspace. */
  | "missing"
  /** Not the computer running BB: the read-only file browser. */
  | "browser"
  /** A workspace with no folder: nothing VS Code could open. */
  | "no-folder"
  | "installing"
  | "starting"
  /** VS Code is up: its frame. */
  | "editor"
  /** It didn't start: why, with Retry and another workspace. */
  | "failed";

/**
 * Which of those to show. `openError`: asking the server to start VS Code
 * failed outright (the folder is gone, say). A stopped server counts as
 * starting, since a view on screen starts it itself; so does the first
 * failure, which gets one more try (`retried`).
 */
export function editorView({ embed, workspace, loadError, status, openError, retried, released }: {
  embed: boolean;
  workspace: Pick<Workspace, "folders"> | null;
  loadError: string;
  status: ServerStatus | null;
  openError: string;
  retried: boolean;
  released: boolean;
}): EditorView {
  if (!workspace) return loadError ? "missing" : "loading";
  if (!embed) return "browser";
  if (!workspace.folders.length) return "no-folder";
  if (openError) return "failed";
  if (!status) return "starting";
  if (status.state === "running") return status.url && status.password && !released ? "editor" : "starting";
  if (status.state === "installing") return "installing";
  if (status.state === "failed") return retried ? "failed" : "starting";
  return "starting";
}

/** Whether a frame shows nothing: no document yet, or the empty one a frame goes back to when the page moves it. */
export function frameIsBlank(frame: Pick<HTMLIFrameElement, "contentWindow"> | null): boolean {
  if (!frame?.contentWindow) return true;
  try {
    return frame.contentWindow.location.href === "about:blank";
  } catch {
    // Another origin's page: the editor (or the browser's own error page) is in it.
    return false;
  }
}

/** A frame with no page after this long says so, with a way to load it again. */
export const FRAME_SLOW_MS = 20_000;
/** How many times a frame found blank signs in again by itself. */
const FRAME_RESTORES = 3;

/**
 * A workspace's VS Code, with no bar of its own: alone in the thread's tab,
 * or under the page's bar in the main view (route.tsx). `onChoose` is "Choose
 * another workspace"; left out, it opens the picker in the main view.
 */
export function WorkspaceView({ id, onWorkspace, onChoose: chooseFrom }: { id: string; onWorkspace?(workspace: Workspace | null): void; onChoose?(): void }) {
  const openStudio = useStudioOpen();
  const onChoose = chooseFrom ?? (() => openStudio({ href: CHOOSE_PATH, title: "VS Code" }, { target: "main" }));
  const rpc = useRpc<CodeContract>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  /** Why the server refused to start VS Code at all (code.open failed). */
  const [openError, setOpenError] = useState("");
  const [version, setVersion] = useState(0);
  const embed = canEmbedEditor(window.location.hostname);
  useThemeSync(embed);
  // An open editor restyles in place. One too old to reloads, keeping its open files.
  const [frameLoad, setFrameLoad] = useState(0);
  useEffect(() => {
    const reload = () => setFrameLoad((n) => n + 1);
    themeChanges.addEventListener("change", reload);
    return () => themeChanges.removeEventListener("change", reload);
  }, []);
  const body = useRef<HTMLDivElement>(null);
  const shown = useShown(body);
  // Out of sight for a while, the frame lets go so VS Code's idle timer runs.
  const [released, setReleased] = useState(false);
  // A visible view opens the editor. Coming back to the view allows one more
  // try after a failure.
  const [retried, setRetried] = useState(false);
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown && !wasShown.current) { setRetried(false); setOpenError(""); }
    wasShown.current = shown;
  }, [shown]);
  useEffect(() => {
    if (shown) { setReleased(false); return; }
    const timer = setTimeout(() => setReleased(true), HIDDEN_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  // "*": the plugin restarted, and every server with it.
  useRealtime(CHANNEL, (event) => {
    const message = event as { id?: string; type?: string } | null;
    // Keys and opens are for the frame with the keyboard (EditorFrame).
    if (message?.type) return;
    if (message?.id === id || message?.id === "*") setVersion((n) => n + 1);
  });
  // A server can stop without a word reaching this view (a plugin update, say),
  // so recheck now and then, on screen or not: a frame left on a dead server
  // keeps flashing VS Code's "reconnecting" screen.
  useEffect(() => {
    const timer = setInterval(() => setVersion((n) => n + 1), shown ? STATUS_RECHECK_MS : STATUS_RECHECK_HIDDEN_MS);
    return () => clearInterval(timer);
  }, [shown]);
  useEffect(() => {
    let live = true;
    rpc.call("code.get", { id }).then(
      (result) => { if (!live) return; setWorkspace(result.workspace); setStatus(result.status); setLoadError(result.workspace ? "" : "Workspace not found."); },
      (error) => { if (live) setLoadError(errorMessage(error)); },
    );
    return () => { live = false; };
  }, [rpc, id, version]);
  // The page around this view (its bar and menu) and BB's title show the workspace too.
  useEffect(() => {
    if (workspace) noteWorkspaceTitle(workspace.id, workspace.title);
    onWorkspace?.(workspace);
  }, [workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  const opening = useRef(false);
  const open = () => {
    if (opening.current) return;
    opening.current = true;
    // A start the server refuses (its folder is gone) is a failure to show, not a toast over a spinner.
    setOpenError("");
    void rpc.call("code.open", { id }).then(
      (result) => setStatus(result.status),
      (error) => setOpenError(errorMessage(error)),
    ).finally(() => { opening.current = false; });
  };
  useEffect(() => {
    if (!embed || !shown || !workspace?.folders.length || openError) return;
    if (status?.state === "stopped") open();
    else if (status?.state === "failed" && !retried) { setRetried(true); open(); }
  }, [embed, shown, retried, workspace, status, openError]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = editorView({ embed, workspace, loadError, status, openError, retried, released });
  const choose = (
    <button type="button" className={BAR_BUTTON} onClick={() => onChoose()}>
      <Icon name="FolderOpen" className="size-4" /> Choose another workspace
    </button>
  );
  const retry = (run: () => void) => (
    <button type="button" className={BAR_BUTTON} onClick={run}>
      <Icon name="RotateCw" className="size-4" /> Retry
    </button>
  );
  const centered = "flex h-full flex-col items-center justify-center gap-3 p-6 text-center";
  const waiting = (text: string) => (
    <div className={centered}>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" />
        {text}
      </p>
    </div>
  );
  const stuck = (message: string, detail: string | null, again: (() => void) | null) => (
    <div className={centered}>
      <p role="alert" className="text-sm text-foreground">{message}</p>
      {detail ? <pre className="max-w-xl whitespace-pre-wrap text-left text-xs text-destructive">{detail}</pre> : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {again ? retry(again) : null}
        {choose}
      </div>
    </div>
  );
  const url = status?.state === "running" ? status.url : null;
  const password = status?.state === "running" ? status.password : null;
  return (
    <div data-studio-code-view={view} className="studio-root flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <div ref={body} className="relative min-h-0 flex-1">
        {view === "loading" ? waiting("Loading workspace…")
          : view === "missing" ? stuck("VS Code couldn't open this workspace.", loadError, () => { setLoadError(""); setVersion((n) => n + 1); })
          : view === "browser" ? <FileBrowser workspace={workspace!} />
          : view === "no-folder" ? stuck("This workspace has no folder to open.", null, null)
          : view === "editor" ? <EditorFrame key={`${url}#${frameLoad}`} id={id} url={url!} password={password!} label={`VS Code: ${workspace!.title}`} onReload={() => setFrameLoad((n) => n + 1)} onChoose={onChoose} />
          : view === "failed" ? stuck(STATUS_TEXT.failed, openError || status?.error || null, () => { setRetried(true); open(); })
          : waiting(view === "installing" ? STATUS_TEXT.installing : STATUS_TEXT.starting)}
      </div>
    </div>
  );
}

/** Whether keys should be replayed as ⌘ (macOS) or Ctrl, like BB's own shortcuts. */
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Replays one of BB's shortcuts on BB's page. Inside VS Code the frame has
 * the keyboard, so BB never sees the key; the bridge extension catches it and
 * sends it here (src/server/bridge-extension.ts, PASSED_KEYS).
 */
export function replayKey(key: { key: string; code: string; mod: boolean; shift: boolean; alt: boolean }, mac: boolean, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: key.key,
    code: key.code,
    metaKey: key.mod && mac,
    ctrlKey: key.mod && !mac,
    shiftKey: key.shift,
    altKey: key.alt,
    bubbles: true,
    cancelable: true,
  }));
}

/**
 * Opens in BB what the editor asked for: a thread ("New Thread from
 * Selection"), or BB's own preview of a file at a line ("Show in BB"). False
 * on a BB that can't.
 */
export function openFromEditor(navigate: { toThread(threadId: string): void }, open: EditorOpen): boolean {
  if (open.kind === "thread") { navigate.toThread(open.threadId); return true; }
  const preview = (navigate as { experimental_openFilePreview?: unknown }).experimental_openFilePreview;
  if (typeof preview !== "function") return false;
  // VS Code is these files' opener: this open is for BB's preview instead.
  showBbPreview(open.target.path);
  return preview.call(navigate, { target: open.target, location: { kind: "line", line: open.line, column: null } }) === true;
}

/**
 * VS Code in a frame, signed in with this run's password. Until its page
 * loads, "Opening VS Code…" covers the frame. A frame found blank after it
 * showed the editor (the page moved it: a view kept across routes is
 * re-parented, and a frame that moves starts over empty) signs in again. One with no page
 * after FRAME_SLOW_MS shows the frame as it is under a bar with Reload.
 */
export function EditorFrame({ id, url, password, label, onReload, onChoose }: { id: string; url: string; password: string; label: string; onReload(): void; onChoose(): void }) {
  const [name] = useState(() => `studio-code-${Math.random().toString(36).slice(2)}`);
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The editor's page has been in the frame: blank after that means the frame started over. */
  const hadPage = useRef(false);
  const restores = useRef(0);
  const submit = useCallback(() => {
    if (frame.current) signIn(url, password, name);
  }, [url, password, name]);
  useEffect(() => submit(), [submit]);
  useEffect(() => {
    if (loaded) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), FRAME_SLOW_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
  const onLoad = () => {
    if (!frameIsBlank(frame.current)) { hadPage.current = true; setLoaded(true); return; }
    // The empty document every frame starts with; the sign-in under way replaces it.
    if (!hadPage.current) return;
    setLoaded(false);
    if (restores.current++ < FRAME_RESTORES) submit();
    else setSlow(true);
  };
  const navigate = useBbNavigate();
  // A BB shortcut pressed in this editor, or something it asks BB to open:
  // only the BB window whose frame has the keyboard acts on it.
  useRealtime(CHANNEL, (event) => {
    const message = event as { type?: string; id?: string; key?: Parameters<typeof replayKey>[0]; open?: EditorOpen } | null;
    if (!message || message.id !== id) return;
    if (!document.hasFocus() || document.activeElement !== frame.current) return;
    if (message.type === "key" && message.key) replayKey(message.key, isMac());
    if (message.type === "open" && message.open && !openFromEditor(navigate, message.open)) toast.error("BB can't show that here.");
  });
  return (
    <>
      <iframe
        ref={frame}
        name={name}
        // aria-label, not title: a title shows as a tooltip over the whole editor.
        aria-label={label}
        className="absolute inset-0 size-full border-0"
        allow={editorFrameAllow(url)}
        onLoad={onLoad}
      />
      {loaded || dismissed ? null : slow ? (
        // Shown over the top of the frame, not instead of it: whatever did load stays in view.
        <div role="alert" className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-1.5 text-sm text-foreground">
          <span className="min-w-0 flex-1">VS Code hasn't loaded.</span>
          <button type="button" className={BAR_BUTTON} onClick={onReload}><Icon name="RotateCw" className="size-4" /> Retry</button>
          <button type="button" className={BAR_BUTTON} onClick={onChoose}><Icon name="FolderOpen" className="size-4" /> Choose another workspace</button>
          <button type="button" aria-label="Dismiss" title="Dismiss" className={BAR_BUTTON} onClick={() => setDismissed(true)}><Icon name="X" className="size-4" /></button>
        </div>
      ) : (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" />
            Opening VS Code…
          </p>
        </div>
      )}
    </>
  );
}
