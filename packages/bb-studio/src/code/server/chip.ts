const inside = (folder: string, path: string) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);

type Shareable = { id: string; folders: string[]; threadId: string | null; folderKey?: string | null; share: boolean; archived: boolean };

/**
 * The workspaces whose editor a thread may see: the one made for it or for
 * its folder (`folderKey`), and any whose folders hold the thread's folder. A thread working in a parent
 * folder (home, /) sees none, and a workspace with sharing off is never
 * shown to agents.
 */
export function relatedWorkspaces<T extends Shareable>(workspaces: T[], threadId: string, threadPath: string | null, folderKey: string | null = null): T[] {
  return workspaces.filter((workspace) =>
    !workspace.archived && workspace.share &&
    (workspace.threadId === threadId || (folderKey !== null && workspace.folderKey === folderKey) || (threadPath !== null && workspace.folders.some((folder) => inside(folder, threadPath)))));
}
