import type { CodeContract } from "./contract";
// "VS Code" in a file tab's "Open with" menu, and the default for these
// extensions (BB renders the first opener). VS Code is the editor: opening a
// code file sends it, at its lines, to the VS Code tab of the thread's folder.
// Files VS Code can't open (no thread, thread storage, a thread on another
// machine) show BB's preview. Settings → Files can pin BB's preview instead.
//
// Where BB asks the opener first (`experimental_handleOpen`), the file goes
// to VS Code and BB opens no file tab. A BB without that opens a file tab
// regardless, so there this tab sends the file on and just says so, with
// BB's preview a click away.
import { useCallback, useEffect, useState } from "react";
import { useRpc, type PluginFileOpenerProps, type PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, Icon } from "../kit/app/index";
import { errorMessage } from "../kit/format";
import { CODE_TAB, tabParamsOfKey, type Workspace } from "./shared";
import { requestThreadTab, useOpenThreadTab, type ThreadTabOpen } from "../kit/app/thread-panel";
import { wantsBbPreview } from "./bb-preview";

/** Text and code files worth editing in VS Code. Markdown stays in BB's preview, which renders it. */
export const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json", "jsonc", "yaml", "yml", "toml",
  "css", "scss", "less", "html", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h",
  "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "graphql", "xml", "txt", "lua", "dart", "ex", "exs",
];

/** Whether opening the file goes straight to the thread's VS Code: thread storage sits outside every worktree. */
export function shouldAutoOpen(source: Pick<PluginFileOpenerSource, "kind" | "threadId">): source is { kind: "host" | "workspace"; threadId: string } {
  return source.threadId !== null && source.kind !== "thread-storage";
}

type LineRange = { startLineNumber: number; endLineNumber: number };

/**
 * The tab that shows a workspace: the thread's VS Code tab. `shared` asks for
 * the folder's own tab, fixed in every workbench; Studio no longer opens it
 * so: it keeps no fixed tabs (src/ui/bot/retire-fixed-tabs.tsx closes old ones).
 */
export function codeTabFor(workspace: Pick<Workspace, "folderKey" | "title">, shared: boolean = false): ThreadTabOpen {
  const params = shared ? tabParamsOfKey(workspace.folderKey) : null;
  return params ? { actionId: CODE_TAB, title: workspace.title, params, global: true } : { actionId: CODE_TAB, title: "VS Code" };
}

type Call = (method: "code.forThread" | "code.reveal", input: never) => Promise<unknown>;

/**
 * Opens a file in VS Code, at its lines: the one way the app does it, for
 * BB's file opener, and so for file links and the diff's "Open in editor",
 * which reach the opener. The lines are held until the editor connects, so
 * they land once the tab loads. Throws when VS Code can't open it.
 */
export async function openInVsCode(
  call: Call,
  openTab: (open: ThreadTabOpen) => boolean | Promise<boolean>,
  file: { threadId: string; path: string; lineRange?: LineRange | null },
): Promise<void> {
  const { workspace } = await call("code.forThread", { threadId: file.threadId } as never) as { workspace: Workspace };
  const startLine = file.lineRange?.startLineNumber ?? 1;
  await call("code.reveal", { id: workspace.id, path: file.path, startLine, endLine: file.lineRange?.endLineNumber ?? startLine } as never);
  if (!(await openTab(codeTabFor(workspace)))) throw new Error("There's no side panel here for VS Code.");
}

/** A plugin RPC from outside a component, as BB's own client calls it. */
export async function post(method: string, input: unknown): Promise<unknown> {
  const response = await fetch(`/api/v1/plugins/studio/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; error?: { message?: string } } | null;
  if (!body?.ok) throw new Error(body?.error?.message ?? "Studio couldn't do that.");
  return body.result;
}

/** Whether this BB asks the opener before it opens a file tab: known once it has. */
let asked = false;
export const hostAsksFirst = () => asked;

/**
 * `experimental_handleOpen`: BB asks before it opens a file tab for this
 * opener. True once VS Code has the file, at its lines, and its tab is in
 * front; BB then opens no file tab. False (or a throw) leaves BB to open its
 * tab, which shows BB's preview.
 */
export async function handleOpen(
  { path, source, lineRange }: { path: string; source: Pick<PluginFileOpenerSource, "kind" | "threadId">; lineRange: LineRange | null },
  deps: { call: Call; openTab(threadId: string, open: ThreadTabOpen): Promise<boolean> } = { call: post, openTab: requestThreadTab },
): Promise<boolean> {
  asked = true;
  if (!shouldAutoOpen(source) || wantsBbPreview(path)) return false;
  const { threadId } = source;
  await openInVsCode(deps.call, (open) => deps.openTab(threadId, open), { threadId, path, lineRange });
  return true;
}

/** The opener's extra field for a BB that takes it; a BB without it ignores the field. */
export const HANDLE_OPEN: object = { experimental_handleOpen: handleOpen };

type State = { kind: "opening" } | { kind: "opened" } | { kind: "shown" } | { kind: "error"; message: string };

/**
 * For a BB that doesn't ask first. The open last sent to VS Code for each
 * thread's file, by its line range
 * object (a new click gives a new one). It outlives the file tab's component:
 * closing VS Code shows the file tab again, which remounts this opener, and
 * that must not open VS Code again.
 */
const sent = new Map<string, unknown>();

/** Whether this open (a file and its line range, by identity) still has to go to VS Code; records it when it does. */
export function claimOpen(threadId: string, path: string, range: unknown): boolean {
  const key = `${threadId}\n${path}`;
  if (sent.has(key) && sent.get(key) === range) return false;
  sent.set(key, range);
  return true;
}

export function VsCodeFileOpener({ path, source, experimental_lineRange, Original }: PluginFileOpenerProps) {
  const rpc = useRpc<CodeContract>();
  const openTab = useOpenThreadTab();
  const threadId = shouldAutoOpen(source) ? source.threadId : null;
  // This tab is BB's preview when BB asked the opener first and still opened
  // it, or when the editor asked for BB's preview ("Show in BB").
  const previewOnly = () => asked || wantsBbPreview(path);
  const [state, setState] = useState<State>(() =>
    threadId && (previewOnly() || sent.get(`${threadId}\n${path}`) === experimental_lineRange) ? { kind: "shown" } : { kind: "opening" });
  const [preview, setPreview] = useState(false);

  const open = useCallback(async () => {
    if (!threadId) return;
    setState({ kind: "opening" });
    try {
      await openInVsCode((method, input) => rpc.call(method, input), openTab, { threadId, path, lineRange: experimental_lineRange });
      setState({ kind: "opened" });
    } catch (cause) {
      setState({ kind: "error", message: errorMessage(cause) });
    }
  }, [rpc, openTab, threadId, path, experimental_lineRange]);

  // A BB that doesn't ask first: each open goes to VS Code once (claimOpen),
  // so StrictMode's second run and a remount after VS Code closes leave it closed.
  useEffect(() => {
    if (!threadId) return;
    if (asked || wantsBbPreview(path)) { setState({ kind: "shown" }); return; }
    if (claimOpen(threadId, path, experimental_lineRange)) void open();
  }, [threadId, path, experimental_lineRange, open]);

  if (!threadId) return <Original />;
  const showOriginal = state.kind === "error" || state.kind === "shown" || preview;
  return (
    <div className="flex h-full flex-col">
      <div data-studio-rule="" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
        <Icon name={state.kind === "opening" ? "Loading" : "Code"} className={`size-4 shrink-0 ${state.kind === "opening" ? "animate-spin motion-reduce:animate-none" : ""}`} />
        <span role={state.kind === "error" ? "alert" : "status"} className="min-w-0 flex-1 truncate">
          {state.kind === "error" ? state.message : state.kind === "opening" ? "Opening in VS Code…" : state.kind === "shown" ? "BB's preview" : "Opened in VS Code beside this thread"}
        </span>
        {state.kind === "error" || state.kind === "shown" ? (
          <button type="button" className={BAR_BUTTON} onClick={() => void open()}>{state.kind === "error" ? "Try again" : "Open in VS Code"}</button>
        ) : (
          <button type="button" className={BAR_BUTTON} aria-pressed={preview} onClick={() => setPreview((value) => !value)}>
            {preview ? "Hide BB's preview" : "Show BB's preview"}
          </button>
        )}
      </div>
      {showOriginal && (
        <div className="min-h-0 flex-1">
          <Original />
        </div>
      )}
    </div>
  );
}
