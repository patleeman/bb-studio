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
