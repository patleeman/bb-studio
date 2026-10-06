# Studio Code

Part of BB Studio. A **workspace** is a Studio item that opens one or more
folders in VS Code, inside BB. Like any Studio item, it belongs to a project
and so to a Space. A Space can hold as many workspaces as you like, each open
to different folders.

## Use it

- **In Studio**, choose **New → Workspace**. The workspace starts with its
  project's folder, which is the Space's own folder when you create it inside a
  Space. With no Space chosen, it starts empty and asks for folders.
- **Beside a thread**, open the **VS Code** tab in the right panel. It opens
  the thread's own worktree, so you see the agent's changes, its branch and
  its diff. The workspace is made the first time and reused after that.
  **Back** lists the thread's other workspaces.
- **From a reply**, a `::workspace{id="cws_…"}` card opens the workspace in
  that tab.
- **In a composer**, type `@` and a workspace's name to give the agent its
  folders.
- Use the folder button in the header to add or remove folders. You can type a
  full path (or `~/…`) or pick a BB project. VS Code shows every folder in one
  multi-root window. Changing folders while VS Code is open updates it live.
- The first open downloads code-server 4.140.0 (about 200 MB) into the plugin's
  data folder. Later opens start in a few seconds.
- **Stop** ends the workspace's server. **Open in browser** opens the same
  editor in its own window.

Agents get three tools and the `studio-code` skill:

- `code_workspace_open` opens the thread's worktree, or new folders, and
  prints the reply card.
- `code_workspaces_list` lists workspaces.
- `code_workspace_set_folders` changes a workspace's folders.

## Phones and other computers

VS Code answers only on the computer running BB. When BB is opened from
anywhere else, such as the iOS app or a browser on another machine, the
workspace shows its files read-only instead: you can walk its folders and read
text files up to 1 MB. Paths are resolved through symlinks and must stay inside
the workspace's folders. No editor starts for these views.

## How it works

Each open workspace runs its own [code-server](https://github.com/coder/code-server)
(MIT) process on a free loopback port. That process gets a
`.code-workspace` file listing the folders, plus its own VS Code settings and
state under `<dataDir>/plugins/studio-code/workspaces/<id>/`. code-server's
own data and config folders live there too, not in your home folder.
Extensions are shared across workspaces and come from Open VSX. New workspaces
turn off Restricted Mode, the welcome page and VS Code's own AI chat.

**Layout for BB.** VS Code is laid out for a pane inside BB: the editor sits
against BB's own sidebar, and VS Code's side bar and activity bar are on the
right. There's no title bar, menu bar, command center, layout buttons,
breadcrumbs, minimap or tips. The menu is the ≡ at the top of the activity
bar, and ⇧⌘P opens the command palette. Each workspace gets this layout once
(a `layout-version` file beside it records which), so changes you make in
VS Code afterwards stay.

**BB's theme.** VS Code takes BB's colors, whatever theme BB uses, including
custom and plugin themes. While a workspace is on screen, the app reads BB's
palette from the page, converts it to hex, and the server writes it into every
workspace's settings as `workbench.colorCustomizations` over VS Code's Dark
Modern or Light Modern, matching BB's mode. Syntax colors stay VS Code's. When
BB's colors or mode change, open editors reload to pick them up, keeping
their open files; code-server reads settings on load but doesn't watch them.
A settings file you edited with comments isn't plain JSON, so it is left
alone.

**Idle shutdown.** A server stops after 30 minutes with no editor connected,
and reopens when you come back to the workspace. A view that has been out of
sight for 5 minutes lets go of its editor, so a tab left open in the
background doesn't keep VS Code running forever. Each server uses roughly
200–400 MB of memory.

**Servers never outlive BB.** Each code-server runs under a small watchdog
that holds a pipe to BB. When BB exits for any reason, even a crash or
`kill -9`, the pipe closes and the watchdog stops code-server. As a backup,
the plugin stops any code-server left in its install folder when it next
loads.

Tested on macOS (arm64) and Linux (arm64, in Docker).

## Limits

- **No authentication.** code-server runs with `--auth none` on loopback, so
  other programs on this machine can reach an open editor.
- While VS Code has focus, it takes the keyboard, so BB's shortcuts don't
  work until you click outside it.
- A thread's worktree tab works only when the thread runs on the computer
  running BB.
- The download is pinned by version and served from GitHub over HTTPS, but its
  checksum isn't verified.
- No Windows support; code-server has no Windows build.

## Staged preview

![A Studio Code workspace open in BB](assets/staged-preview.png)

Captured by `scripts/capture/captures/bb-studio-code.mjs` from a staged stable
BB 0.45. It creates a workspace the way Studio's New does, for the seeded
Orbit project, and opens it. VS Code's Explorer shows the project's `src`
folder and `README.md`, with `src/retry.ts` open and syntax-highlighted, and
the Git branch in the status bar.
