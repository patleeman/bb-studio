import { useEffect, useRef, useState, type RefObject } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { toast } from "sonner";
import { FileBrowser } from "./file-browser";
import { themeChanges, useThemeSync } from "./theme-sync";
import { CHANNEL, HIDDEN_RELEASE_MS, type CodeContract, type ServerStatus, type Workspace } from "./shared";

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

/** A workspace's VS Code, alone in the thread's tab with no bar. */
export function WorkspaceView({ id }: { id: string }) {
  const rpc = useRpc<CodeContract>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
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
  // Out of sight for a while, the frame lets go so VS Code's idle timer runs.
  const [released, setReleased] = useState(false);
  // A visible view opens the editor. Coming back to the view allows one more
  // try after a failure.
  const [retried, setRetried] = useState(false);
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown && !wasShown.current) setRetried(false);
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
    if (message?.type === "key") return;
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
    void rpc.call("open", { id }).then(
      (result) => setStatus(result.status),
      (error) => toast.error(errorMessage(error)),
    ).finally(() => { opening.current = false; });
  };
  useEffect(() => {
    if (!embed || !shown || !workspace?.folders.length) return;
    if (status?.state === "stopped") open();
    else if (status?.state === "failed" && !retried) { setRetried(true); open(); }
  }, [embed, shown, retried, workspace, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (changes: { share: boolean }) =>
    rpc.call("update", { id, ...changes }).then((result) => setWorkspace(result.workspace), (error) => toast.error(errorMessage(error)));

  if (!workspace)
    return (
      <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
        <p role={loadError ? "alert" : "status"} className={`p-6 text-sm ${loadError ? "text-destructive" : "text-muted-foreground"}`}>{loadError || "Loading workspace…"}</p>
      </div>
    );

  const url = status?.state === "running" ? status.url : null;
  // A visible view starts VS Code itself, so until it's up (or it failed for
  // good) it's on its way: a spinner, not a button.
  const waiting = !status || status.state === "installing" || status.state === "starting" || status.state === "running"
    || (embed && (status.state === "stopped" || (status.state === "failed" && !retried)));
  const password = status?.state === "running" ? status.password : null;
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* With no bar, sharing still has to be visible and easy to stop. */}
      {workspace.share ? (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <Icon name="Eye" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Agents can see your open file, selection and errors.</span>
          <button type="button" className="shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-state-hover" onClick={() => void update({ share: false })}>
            Stop sharing
          </button>
        </div>
      ) : null}
      <div ref={body} className="relative min-h-0 flex-1">
        {!embed ? (
          <FileBrowser workspace={workspace} />
        ) : url && password && !released ? (
          <EditorFrame key={`${url}#${frameLoad}`} id={id} url={url} password={password} label={`VS Code: ${workspace.title}`} />
        ) : workspace.folders.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {waiting ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" />
                {status?.state === "installing" ? STATUS_TEXT.installing : STATUS_TEXT.starting}
              </p>
            ) : (
              <p role={status?.state === "failed" ? "alert" : "status"} className="text-sm text-muted-foreground">{STATUS_TEXT[status?.state ?? "stopped"]}</p>
            )}
            {!waiting && status?.error && <pre className="max-w-xl whitespace-pre-wrap text-left text-xs text-destructive">{status.error}</pre>}
            {!waiting && (status?.state === "stopped" || status?.state === "failed") && (
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

/** VS Code in a frame, signed in with this run's password. */
function EditorFrame({ id, url, password, label }: { id: string; url: string; password: string; label: string }) {
  const [name] = useState(() => `studio-code-${Math.random().toString(36).slice(2)}`);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (frame.current) signIn(url, password, name);
  }, [url, password, name]);
  // A BB shortcut pressed in this editor: only the BB window whose frame has
  // the keyboard acts on it.
  useRealtime(CHANNEL, (event) => {
    const message = event as { type?: string; id?: string; key?: Parameters<typeof replayKey>[0] } | null;
    if (message?.type !== "key" || message.id !== id || !message.key) return;
    if (!document.hasFocus() || document.activeElement !== frame.current) return;
    replayKey(message.key, isMac());
  });
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
