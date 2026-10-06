---
name: studio-code
description: Open VS Code workspaces in BB Studio, including this thread's own worktree, so the user can read and edit code beside the chat.
---

# Studio Code

A workspace is a Studio item that opens one or more folders in VS Code inside BB. It runs on the computer running BB, so its folders are full paths on that machine.

- To let the user review or edit your changes, call `code_workspace_open` with no folders. It opens this thread's worktree, making the workspace the first time and reusing it after that.
- To open other folders, call `code_workspace_open` with `folders` (and a `title`). Use `code_workspaces_list` to find an existing workspace, and `code_workspace_set_folders` to change one. VS Code updates its open window without a reload.
- The tools print a card line. Put it on its own line in your reply, once per workspace, so the user can open the workspace beside the chat:

```
::workspace{id="<workspace-id>"}
```

Link to a workspace as `/plugins/studio-code/workspaces/<workspace-id>`.

Only open a workspace when the user would want to look at or edit the code. You don't need one to read or change files yourself.

## Working alongside the user's editor

When the user has a workspace open, each turn starts with what they're looking at: the file, the lines on screen, their selection, errors, and files with unsaved changes. "This", "here" and "it" usually mean their selection or that file. `code_editor_state` gives the latest view mid-turn.

- Files listed as having unsaved changes are newer in their editor than on disk. Don't edit them without asking; your edit would conflict with theirs.
- When you talk about specific code, call `code_show` with the path and lines so their editor jumps there and highlights it: "the bug is here" lands on the actual lines. Use it once per place you point at, not for every file you read.
