// VS Code's nav panel, `studio/vscode` ("VS Code" in BB's rail):
// - `/plugins/studio/vscode`: the workspace used last whose folder is still
//   there, else the picker; it replaces itself with that page's address, so
//   back never lands on it;
// - `/plugins/studio/vscode/<workspace id>`: that workspace's VS Code
//   (src/code/route.tsx), kept alive across trips away (retainPanel);
// - `/plugins/studio/vscode/choose`: the picker of workspaces and projects.
// The old addresses under the Library, `/plugins/studio/studio/workspaces/…`,
// go to the same pages here.
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense, useEffect } from "react";
import { retainPanel } from "../kit/app/retained";
import { usePathname } from "../kit/app/route";
import { StudioContainerProvider } from "../ui/studio-open";
import type { CodeContract } from "./contract";
import { CHOOSE_ID, codePageAt, VSCODE_PANEL } from "./page-title";

const WorkspaceRoute = lazy(() => import("./route"));

/** What can follow the panel's root: a workspace id, or `choose`. */
export const isCodePageId = (id: string) => /^cws_[a-zA-Z0-9]+$/.test(id) || id === CHOOSE_ID;

/** Where the panel's root goes: the last workspace, else the picker (also when the server can't say). */
export async function landingPage(call: (method: "code.recent", input: null) => Promise<{ workspace: { id: string } | null }>): Promise<string> {
  const recent = await call("code.recent", null).then((result) => result.workspace, () => null);
  return recent ? recent.id : CHOOSE_ID;
}

function Landing() {
  const rpc = useRpc<CodeContract>();
  const navigate = useBbNavigate();
  useEffect(() => {
    let live = true;
    void landingPage((method, input) => rpc.call(method, input)).then((subPath) => { if (live) navigate.toPluginPanel(VSCODE_PANEL, { subPath, replace: true }); });
    return () => { live = false; };
  }, [rpc, navigate]);
  return <div className="studio-root flex h-full min-h-0 flex-1 bg-background" />;
}

function CodePage({ subPath }: { subPath: string }) {
  const id = codePageAt(subPath);
  if (!id || !isCodePageId(id)) return <Landing />;
  return <StudioContainerProvider value={{ kind: "studio" }}><Suspense fallback={null}><WorkspaceRoute id={id} /></Suspense></StudioContainerProvider>;
}

const RetainedCodePage = retainPanel(VSCODE_PANEL, CodePage);

/** The nav panel's component. Only a workspace or the picker is retained; the root lands anew each time. */
export function VsCodePanel({ subPath }: { subPath: string }) {
  return codePageAt(subPath) ? <RetainedCodePage subPath={subPath} /> : <Landing />;
}

/** What the retained views render, from Studio's overlay (app.tsx). */
export function VsCodeRetainedView({ subPath }: { subPath: string }) {
  return <CodePage subPath={subPath} />;
}

/**
 * An old address under the Library (`workspaces/<id>`): goes to the same page
 * in VS Code's panel. The Library's views are retained, so it checks each
 * time its address is shown again.
 */
export function OldCodeAddress({ id }: { id: string }) {
  const navigate = useBbNavigate();
  const here = /\/workspaces\/[^/]+\/?$/.test(usePathname());
  useEffect(() => { if (here) navigate.toPluginPanel(VSCODE_PANEL, { subPath: id, replace: true }); }, [here, id, navigate]);
  return null;
}
