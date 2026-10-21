// A thread's workspace is made for its worktree. If the worktree moves, the
// workspace follows it instead of opening a folder that is gone.
import { resolve } from "node:path";

/** The workspace's folders once they include the thread's current worktree; the same array when they already do. */
export function followWorktree(folders: readonly string[], current: string): string[] {
  const path = resolve(current);
  if (folders.some((folder) => resolve(folder) === path)) return [...folders];
  // A workspace of just the old worktree moves with it; one with other folders keeps them.
  return folders.length <= 1 ? [path] : [...folders, path];
}

export function missingWorktreeMessage(path: string): string {
  return `This thread's worktree is gone: ${path} no longer exists on this machine.`;
}
