import type { CodeContract } from "./contract";
// VS Code as a page in BB's main view: /plugins/studio/vscode/<id>, VS
// Code's nav panel (src/code/vscode-panel.tsx), or a link. `choose` is the
// picker, shown when there is nothing to open.
//
// Like every Studio item page it fills the panel's header with its own bar:
// the VS Code icon, "VS Code · <workspace or project name>", and a ··· menu
// (sharing with agents, another workspace). Loaded on demand.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { StudioBar } from "../kit/app/item-header";
import { BAR_BUTTON, ICON_BUTTON, useProjects } from "../kit/app/pieces";
import { errorMessage } from "../kit/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../kit/ui/dropdown-menu";
import { Icon } from "../kit/ui/icon";
import { useStudioOpen } from "../ui/studio-open";
import { CHOOSE_ID, CHOOSE_PATH, codePageLabel, workspacePath } from "./page-title";
import { WorkspaceView } from "./panel";
import { CODE_ICON, type Workspace } from "./shared";

export default function WorkspaceRoute({ id }: { id: string }) {
  return id === CHOOSE_ID ? <WorkspacePicker /> : <WorkspacePage key={id} id={id} />;
}

/** Shows one of VS Code's pages in the main view: a workspace, or the picker. */
function useCodePages() {
  const open = useStudioOpen();
  return {
    workspace: (workspace: Pick<Workspace, "id" | "title">) => open({ href: workspacePath(workspace.id), ...(workspace.title ? { title: workspace.title } : {}) }, { target: "main" }),
    choose: () => open({ href: CHOOSE_PATH, title: "VS Code" }, { target: "main" }),
  };
}

/** The page's bar, in BB's header where the panel lends it: the VS Code icon and "VS Code · <name>", then the page's menu. */
function CodeBar({ title, menu }: { title: string; menu?: React.ReactNode }) {
  const label = codePageLabel(title);
  return (
    <StudioBar>
      <span aria-current="page" data-studio-code-title="" title={label} className="flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-sm font-medium text-foreground">
        <Icon name={CODE_ICON} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
      {menu}
    </StudioBar>
  );
}

/** The ··· menu: whether agents see what is open in this editor (on unless turned off here), and the way to another workspace. */
export function CodeMenu({ share, onShare, onChoose }: { share: boolean; onShare(share: boolean): void; onChoose(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" title="More" className={ICON_BUTTON}><Icon name="MoreHorizontal" className="size-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuItem role="menuitemcheckbox" aria-checked={share} onSelect={() => onShare(!share)}>
          <Icon name="Check" className={`size-4 ${share ? "" : "opacity-0"}`} />
          <span className="min-w-0 flex-1">Share editor context with agents</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onChoose}>
          <Icon name="FolderOpen" className="size-4" /> Choose another workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One workspace's VS Code under the page's bar. */
function WorkspacePage({ id }: { id: string }) {
  const rpc = useRpc<CodeContract>();
  const { choose } = useCodePages();
  // What the view below loaded; it reads it again whenever the workspace changes.
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const setShare = (share: boolean) => {
    void rpc.call("code.update", { id, share }).then(
      (result) => { setWorkspace(result.workspace); toast(share ? "Agents can see what you have open in this VS Code." : "Agents no longer see what you have open in this VS Code."); },
      (error) => toast.error(errorMessage(error)),
    );
  };
  return (
    <div className="studio-root flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <CodeBar title={workspace?.title ?? ""} menu={workspace ? <CodeMenu share={workspace.share} onShare={setShare} onChoose={choose} /> : null} />
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkspaceView id={id} onWorkspace={setWorkspace} onChoose={choose} />
      </div>
    </div>
  );
}

type Listed = Workspace & { missing: boolean };
const ROW = "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/**
 * What VS Code can open, when the panel has no last workspace to go by (or the one shown failed): the workspaces used before, then every
 * project's own folder.
 */
function WorkspacePicker() {
  const rpc = useRpc<CodeContract>();
  const pages = useCodePages();
  const projects = useProjects();
  const [workspaces, setWorkspaces] = useState<Listed[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError("");
    rpc.call("code.list", null).then(
      (result) => { if (live) setWorkspaces(result.workspaces); },
      (cause) => { if (live) setError(errorMessage(cause)); },
    );
    return () => { live = false; };
  }, [rpc, attempt]);
  const openProject = (projectId: string) => {
    setOpening(projectId);
    void rpc.call("code.forFolder", { projectId }).then(
      ({ workspace }) => pages.workspace(workspace),
      (cause) => toast.error(errorMessage(cause)),
    ).finally(() => setOpening(null));
  };
  // A project whose folder already has a workspace is in the first list.
  const listed = new Set((workspaces ?? []).map((workspace) => workspace.folderKey));
  const others = projects.filter((project) => !listed.has(`project:${project.id}`));
  return (
    <div className="studio-root flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <CodeBar title="" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-6">
          <h1 className="text-lg font-semibold">Open a folder in VS Code</h1>
          {error ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">{error}</p>
              <button type="button" className={BAR_BUTTON} onClick={() => setAttempt((n) => n + 1)}><Icon name="RotateCw" className="size-4" /> Retry</button>
            </div>
          ) : workspaces === null ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" /> Loading workspaces…</p>
          ) : null}
          {workspaces?.length ? (
            <section aria-label="Recent workspaces">
              <h2 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">Recent</h2>
              <ul>
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <button type="button" className={ROW} disabled={workspace.missing} onClick={() => pages.workspace(workspace)}>
                      <Icon name={workspace.folderKey?.startsWith("env:") ? "GitBranch" : "Folder"} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{workspace.title || "Untitled workspace"}</span>
                        <span className="truncate text-xs text-muted-foreground">{workspace.missing ? "Its folder is gone from this computer" : workspace.folders[0] ?? "No folder"}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {others.length ? (
            <section aria-label="Projects">
              <h2 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">Projects</h2>
              <ul>
                {others.map((project) => (
                  <li key={project.id}>
                    <button type="button" className={ROW} disabled={opening !== null} onClick={() => openProject(project.id)}>
                      <Icon name={opening === project.id ? "Loading" : "Folder"} className={`size-4 shrink-0 text-muted-foreground ${opening === project.id ? "animate-spin motion-reduce:animate-none" : ""}`} />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {workspaces && !workspaces.length && !others.length ? (
            <p className="text-sm text-muted-foreground">Nothing to open</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
