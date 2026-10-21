# Studio Code

Part of BB Studio. VS Code is the editor, inside BB. Each thread gets one VS Code, open to the thread's own worktree, in the thread's **VS Code** tab. There is no workspaces page and no folders to manage. The runtime is built into the `studio` plugin. Workspace item IDs keep the `studio-code` namespace.

## Use it

- **Beside a thread**, choose **VS Code** from the right panel's **+** menu. It opens the thread's own worktree, so you see the agent's changes, branch and diff. It's made the first time and reused. This works only when the thread runs on the computer running BB.
- **From a file tab**, code files open in the thread's VS Code tab, at their lines. The file tab says "Opened in VS Code beside this thread", with **Show BB's preview** to see BB's own view. Files VS Code can't open (no thread, thread storage, a thread on another machine, a file outside the worktree) show BB's preview. Markdown stays in BB's preview. **Settings → Files** can make BB's preview the default instead.
- **Sharing.** Agents see what you have open in the thread's VS Code. A bar at the top of the tab says so, with **Stop sharing**.
- **Start and stop.** The first open downloads code-server 4.140.0 (about 200 MB) into the plugin's data folder. Later opens start in a few seconds.

## Agent tools

The `studio-code` skill explains when to use them.

- `code_workspace_open` makes sure the thread has its VS Code, open to its worktree.
- `code_editor_state` reports what you have open right now.
- `code_show` opens a file in your editor, scrolls to the lines, and selects and highlights them ("BB showed you src/retry.ts:13").
- `code_edit` edits live: up to 20 replace-once edits per call. You watch the text typed into your editor behind a "BB" caret. It is one undo step and merges with your unsaved changes, and it leaves saving to you. With no editor open, it edits the file on disk.
- `code_comments` lists the open review comments you sent the agent.
- `code_comment_reply` answers a review comment in its thread, and can resolve it.

There are no CLI commands and no settings.

## Working with the agent

Every thread's VS Code runs the **BB Studio bridge**, a small VS Code extension that Studio Code installs. It reports the file you have open, the lines on screen, your selection, errors and warnings, and files with unsaved changes. Each agent turn in the thread starts knowing that, so "is this line right?" works without pasting. The agent is told not to edit files you have unsaved changes in.

With the same VS Code open in several tabs, the agent talks to the one you used last. If no editor is open, `code_show` jumps there when you open the thread's VS Code tab. **Copy for BB chat** in the editor's right-click menu copies the selection with its path and lines.

**Follow mode.** While a thread works, Studio Code shows what it's doing in any open editor whose folders hold the files: reads, shell reads such as `sed -n` and `cat`, file changes and live edits. The status bar says what it's on ("Fix the retry: editing retry.ts", then "changed 2 files"). Lines it reads get a soft highlight. Lines it changed get a tint and accent bar until its next turn. **Follow** (the eye in the status bar, on by default) moves your editor to where the agent works, but never within a few seconds of your own typing or clicking. Threads working in other folders don't touch your editor.

## Code review comments

Review code the way you would a pull request. Comment on any line or selection with VS Code's own comments: the **+** in the gutter, or **Comments: Add Comment on Current Selection**. Each comment is **Pending** and waits, with Edit and Delete, until you send them together. **Submit review** (in the status bar with a count, and in each comment thread's header) sends every pending comment to the agent in one message, with each comment's file, lines and code.

The review goes to the thread the VS Code belongs to. The agent answers in each comment thread (`code_comment_reply`) and resolves the ones it addressed. Its replies appear in every open editor as they're written, and a new answer opens its thread. Reply in a thread to keep talking: your reply is pending too, and goes with your next submit. Resolve and Reopen are in each thread's header. Comments follow their lines when code above them changes. They're kept in the plugin's database (`code_comments`), so they survive reloads.

## BB's shortcuts inside VS Code

While VS Code has the keyboard, BB's page never sees your keys. The bridge passes exactly these through:

| Keys | In BB |
|---|---|
| ⌘K | Search threads |
| ⇧⌘O | New thread |
| ⌘\ | Toggle the sidebar |
| ⌘J | Toggle the right panel |
| ⇧⌘C | Focus the chat composer |
| ⌘1 to ⌘9 | Jump to a thread |

Ctrl replaces ⌘ off macOS. Editing keys, VS Code's palettes (⌘P, ⇧⌘P), ⌘W and tab switching stay with VS Code. VS Code's ⌘K chords (such as ⌘K ⌘S) don't work, because ⌘K belongs to BB. Their commands are in ⇧⌘P.

## Phones and other computers

VS Code answers only on the computer running BB. When BB is opened from anywhere else, such as the iOS app or a browser on another machine, the VS Code tab shows a read-only file browser instead. You can walk the worktree and read text files up to 1 MB. Paths resolve through symlinks and must stay inside the worktree. No editor starts.

## How it works

Each thread's VS Code runs its own [code-server](https://github.com/coder/code-server) (MIT) on a loopback port. Internally it's a workspace with a `.code-workspace` file for the worktree, plus its own settings and state under `<dataDir>/plugins/studio/code/workspaces/<id>/`. Extensions are shared across threads and come from Open VSX. The layout turns off VS Code's tips and command center.

- **Layout.** VS Code is laid out for a pane inside BB: its side bar and activity bar are on the right, with no title bar, menu bar, minimap or breadcrumbs. The menu is the ≡ at the top of the activity bar. Each VS Code gets this layout once, so later changes you make stay.
- **Theme.** VS Code takes BB's colors, including custom and plugin themes, over Dark Modern or Light Modern to match BB's mode. Syntax colors stay VS Code's. Open editors reload when BB's colors change.
- **Idle shutdown.** A server stops after 30 minutes with no editor connected and reopens when you return. A view out of sight for 5 minutes lets go of its editor. Each server uses roughly 200 to 400 MB of memory.
- **Servers never outlive BB.** A small watchdog holds a pipe to BB and stops code-server when BB exits, even on a crash or `kill -9`. The plugin also stops leftover code-servers when it next loads.
- **Backup.** Nothing here is in `bb studio backup`. The files are the thread's worktree on disk, so back that up. See [Backup and restore](../../docs/backup.md).

Tested on macOS (arm64) and Linux (arm64, in Docker). There is no Windows support, because code-server has no Windows build.

## Security

- **Password per server.** code-server runs with password auth on a port the OS picks, with a new random password each start. The password is kept in a file only you can read, never on a command line. The panel signs the editor in with it, and each VS Code has its own session cookie. Other programs and web pages on the machine can't use an open editor without it. Any BB client can still get the password through BB's API, like everything else BB serves, so BB's own access controls are what protect the editor.
- **Checked download.** The code-server archive must match the SHA-256 pinned for its platform before it's unpacked. A partial install, or one made without the check, is replaced.
- **Workspace trust.** VS Code skips workspace trust for a thread's own worktree. Workspaces an agent made for folders it named, before this version, stay in Restricted Mode until you trust them in VS Code.
- **No secret folders.** VS Code can't open `/`, your home folder, or a folder that holds or sits inside `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, `~/.config/gh`, `~/.config/gcloud`, `~/Library/Keychains` and similar. The read-only file browser skips such folders even if they were added earlier, because it serves them to any BB client.
- **The bridge only talks to its extension.** Every process inside code-server (tasks, terminals, extensions) inherits the bridge socket's path. So each run also has a secret, kept in a mode 0600 file beside the socket, and every request must carry it. Keys passed to BB must be exactly the listed shortcuts. Code that runs as you can still read your files, that secret included. This stops casual and inherited use, not a deliberate attack.
- **What agents see.** Only the VS Code's own thread, or a thread working inside its worktree, gets what you have open. A thread in a parent folder (your home folder, `/`) gets nothing. **Stop sharing** in the tab turns sharing off. What agents get is marked as untrusted data, not instructions.
- **Edits that can't half-land.** A live edit that fails partway rolls the file back, unless you typed meanwhile (then press ⌘Z). Your typing during an edit gets its own undo step, and the file isn't saved for you. An edit that times out is reported and never repeated on disk. Edits on disk refuse files of 1 MB or more or that aren't plain UTF-8 text, and write the file the path really points at, inside the worktree.
- **Stop ends everything.** code-server runs in its own process group. Idle shutdown, or BB exiting, ends the whole group, including extension hosts and terminals.


See [the upgrade guide](../../../../docs/upgrade-studio-code.md) for bridge and recovery details.
