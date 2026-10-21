// Compatibility for persisted studio-code/code tabs. SDK 0.6.37 has no scoped
// action aliases. The bridge owns no editor runtime: all calls wait for the
// acknowledged migration and forward to Studio.
import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { codeContract, CODE_TAB, CODE_ICON, type ServerStatus } from "@bb-studio/kit/code-contract";

function LegacyCodeTab({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof codeContract>();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const frameName = `legacy-code-${threadId}`;
  useEffect(() => {
    let live = true;
    setError(""); setStatus(null);
    void (async () => {
      const { workspace } = await rpc.call("forThread", { threadId });
      await rpc.call("viewedFrom", { id: workspace.id, threadId });
      const result = await rpc.call("open", { id: workspace.id });
      if (live) { setStatus(result.status); if (result.status.error) setError(result.status.error); }
    })().catch((cause) => { if (live) setError(String(cause)); });
    return () => { live = false; };
  }, [rpc, threadId, attempt]);
  useEffect(() => { if (status?.state === "running") form.current?.submit(); }, [status]);
  // As in Studio's editor, loopback code-server is reachable only on BB's host.
  if (!new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(location.hostname)) return <p>Open this editor on the computer running BB.</p>;
  if (error) return <div role="alert">{error}<button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>;
  if (!status?.url || !status.password) return <p role="status">Opening VS Code in Studio…</p>;
  const url = new URL(status.url);
  return <div style={{ height: "100%" }}>
    <form ref={form} action={`${url.origin}/login?to=${encodeURIComponent(url.pathname + url.search)}`} method="post" target={frameName} style={{ display: "none" }}>
      <input name="password" type="hidden" value={status.password} />
    </form>
    <iframe name={frameName} title="VS Code" src="about:blank" style={{ border: 0, width: "100%", height: "100%" }} allow="clipboard-read; clipboard-write" />
  </div>;
}
export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: CODE_TAB, title: "VS Code (saved tab)", icon: CODE_ICON, layout: "flush", component: LegacyCodeTab });
});
