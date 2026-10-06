# Studio Code

Part of BB Studio. A **workspace** is a Studio item that opens one or more
folders in VS Code, inside BB. Like any Studio item, it belongs to a project
and so to a Space. A Space can hold as many workspaces as you like, each open
to different folders.

## Use it

- In Studio, choose **New → Workspace**. The workspace starts with its
  project's folder, which is the Space's own folder when you create it inside a
  Space.
- Use the folder button in the header to add or remove folders. You can type a
  full path (or `~/…`) or pick a BB project. VS Code shows every folder in one
  multi-root window. Changing folders while VS Code is open updates it live.
- The first open downloads code-server 4.140.0 (about 200 MB) into the plugin's
  data folder. Later opens start in a few seconds.
- **Stop** ends the workspace's server. **Open in browser** opens the same
  editor in its own window.

## How it works

Each open workspace runs its own [code-server](https://github.com/coder/code-server)
(MIT) process on a free loopback port. That process gets a
`.code-workspace` file listing the folders, plus its own VS Code settings and
state under `<dataDir>/plugins/studio-code/workspaces/<id>/`. Extensions are
shared across workspaces and come from Open VSX. New workspaces turn off
Restricted Mode, the welcome page and VS Code's own AI chat, and follow the
system's light or dark theme.

Servers never outlive BB. Each code-server runs under a small watchdog that
holds a pipe to BB; when BB exits for any reason, even a crash or `kill -9`,
the pipe closes and the watchdog stops code-server. As a backup, the plugin
stops any code-server left in its folder when it next loads.

## Limits of this spike

- **Local only.** The editor is reached at `http://127.0.0.1:<port>`, so it
  works in the desktop app and in a browser on the same machine, but not from
  another device or the iOS app.
- **No authentication.** code-server runs with `--auth none` on loopback.
  Other programs on this machine can reach the editor while it runs.
- The download is pinned by version and served from GitHub over HTTPS, but its
  checksum isn't verified.
- macOS and Linux only; code-server has no Windows build.

## Staged preview

![A Studio Code workspace open in BB](assets/staged-preview.png)

This is a staged stable BB 0.45 with Studio and Studio Code installed. The
"Orbit" workspace is open from the Workspaces panel. It shows two folders,
`orbit` (a demo Git project) and `orbit-docs`, side by side in VS Code's
Explorer, with `src/retry.ts` open with syntax highlighting and the Git
branch in the status bar.
