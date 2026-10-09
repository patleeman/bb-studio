// What a thread's VS Code tab does: a workspace a reply card named opens as
// is and never touches the thread's worktree (looking that up makes a
// workspace for it); otherwise the tab opens the thread's own.
export type TabView =
  | { kind: "workspace"; id: string }
  | { kind: "error"; message: string }
  | { kind: "opening" };

/** Only a tab with no named workspace needs the thread's worktree workspace. */
export function needsWorktree(openId: string | null): boolean {
  return openId === null;
}

export function tabView(input: { openId: string | null; worktreeId: string | null; error: string }): TabView {
  const id = input.openId ?? input.worktreeId;
  if (id) return { kind: "workspace", id };
  if (input.error) return { kind: "error", message: input.error };
  return { kind: "opening" };
}
