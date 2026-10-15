// "VS Code" in a file tab's "Open with" menu, and the default for these
// extensions (BB renders the first opener). VS Code is the editor: opening a
// code file sends it, at its lines, to the thread's VS Code tab, and this tab
// just says so, with BB's preview a click away. Files VS Code can't open
// (no thread, thread storage, a thread on another machine) show BB's preview.
// Settings → Files can pin BB's preview instead.
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate, useRpc, type PluginFileOpenerProps, type PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { CODE_TAB, type CodeContract } from "./shared";

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

type State = { kind: "opening" } | { kind: "opened" } | { kind: "shown" } | { kind: "error"; message: string };

/**
 * The open last sent to VS Code for each thread's file, by its line range
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
  const navigate = useBbNavigate();
  const threadId = shouldAutoOpen(source) ? source.threadId : null;
  const [state, setState] = useState<State>(() =>
    threadId && sent.get(`${threadId}\n${path}`) === experimental_lineRange ? { kind: "shown" } : { kind: "opening" });
  const [preview, setPreview] = useState(false);

  const open = useCallback(async () => {
    if (!threadId) return;
    setState({ kind: "opening" });
    try {
      const { workspace } = await rpc.call("forThread", { threadId });
      const startLine = experimental_lineRange?.startLineNumber ?? 1;
      // Held until the editor connects, so it lands once the tab loads.
      await rpc.call("reveal", { id: workspace.id, path, startLine, endLine: experimental_lineRange?.endLineNumber ?? startLine });
      if (!navigate.openThreadPanel({ actionId: CODE_TAB, title: "VS Code" })) throw new Error("There's no side panel here for VS Code.");
      setState({ kind: "opened" });
    } catch (cause) {
      setState({ kind: "error", message: errorMessage(cause) });
    }
  }, [rpc, navigate, threadId, path, experimental_lineRange]);

  // Each open goes to VS Code once (claimOpen), so StrictMode's second run
  // and a remount after VS Code closes leave it closed.
  useEffect(() => {
    if (threadId && claimOpen(threadId, path, experimental_lineRange)) void open();
  }, [threadId, path, experimental_lineRange, open]);

  if (!threadId) return <Original />;
  const showOriginal = state.kind === "error" || state.kind === "shown" || preview;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
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
