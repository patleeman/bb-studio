// The thread header's "VS Code" chip: which workspace it opens, if any. A
// thread gets one when there's a workspace for it (made for it, or holding
// its folder), or once it has edited files in its folder, when the chip
// opens its worktree. `working`: it's touching files right now.

type WorkspaceLike = { id: string; title: string; folders: string[]; threadId: string | null; archived: boolean };

const inside = (folder: string, path: string) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);

export function chipFor(input: {
  threadId: string;
  threadPath: string | null;
  workspaces: WorkspaceLike[];
  /** Set once the thread has edited files in its folder. */
  touched: { working: boolean } | null;
}): { workspaceId: string | null; title: string; working: boolean } | null {
  const live = input.workspaces.filter((workspace) => !workspace.archived);
  const working = input.touched?.working ?? false;
  const own = live.find((workspace) => workspace.threadId === input.threadId);
  if (own) return { workspaceId: own.id, title: own.title, working };
  const path = input.threadPath;
  const holding = path ? live.find((workspace) => workspace.folders.some((folder) => inside(folder, path))) : undefined;
  if (holding) return { workspaceId: holding.id, title: holding.title, working };
  if (input.touched && path) return { workspaceId: null, title: "This thread's worktree", working };
  return null;
}

type Shareable = { id: string; folders: string[]; threadId: string | null; share: boolean; archived: boolean };

/**
 * The workspaces whose editor a thread may see: the one made for it, and any
 * whose folders hold the thread's folder. A thread working in a parent
 * folder (home, /) sees none, and a workspace with sharing off is never
 * shown to agents.
 */
export function relatedWorkspaces<T extends Shareable>(workspaces: T[], threadId: string, threadPath: string | null): T[] {
  return workspaces.filter((workspace) =>
    !workspace.archived && workspace.share &&
    (workspace.threadId === threadId || (threadPath !== null && workspace.folders.some((folder) => inside(folder, threadPath)))));
}
