// "VS Code" in a file tab's "Open with" menu, and the default for these
// extensions (BB renders the first opener). Opening a file sends it, at its
// lines, to the thread's VS Code tab; the tab keeps BB's preview under a bar
// to open it again. Settings → Files can pin BB's preview instead.
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc, type PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { BAR_BUTTON, Icon } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { CODE_TAB, type CodeContract } from "./shared";

/** Text and code files worth editing in VS Code. Markdown stays in BB's preview, which renders it. */
export const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json", "jsonc", "yaml", "yml", "toml",
  "css", "scss", "less", "html", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h",
  "cc", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "sql", "graphql", "xml", "txt", "lua", "dart", "ex", "exs",
];

export function VsCodeFileOpener({ path, source, experimental_lineRange, Original }: PluginFileOpenerProps) {
  const rpc = useRpc<CodeContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadId = source.threadId;
  // Thread storage sits outside every workspace; host paths open when a workspace holds them.
  const openable = threadId !== null && source.kind !== "thread-storage";

  const open = async () => {
    if (!threadId) return;
    setBusy(true);
    setError("");
    try {
      const { workspace } = await rpc.call("forThread", { threadId });
      const startLine = experimental_lineRange?.startLineNumber ?? 1;
      // Held until the editor connects, so it lands once the tab loads.
      await rpc.call("reveal", { id: workspace.id, path, startLine, endLine: experimental_lineRange?.endLineNumber ?? startLine });
      navigate.openThreadPanel({ actionId: CODE_TAB, title: "VS Code", params: { workspaceId: workspace.id } });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  // Each open (a new line range object) goes to VS Code once.
  const sent = useRef<unknown>(NOT_SENT);
  useEffect(() => {
    if (!openable || sent.current === experimental_lineRange) return;
    sent.current = experimental_lineRange;
    void open();
  });

  return (
    <div className="flex h-full flex-col">
      {openable && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" className={BAR_BUTTON} disabled={busy} onClick={open}>
            <Icon name="Code" className="size-4" />
            Open in VS Code
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Original />
      </div>
    </div>
  );
}

const NOT_SENT = Symbol("not sent");
