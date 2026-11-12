---
name: studio-code
description: Use whenever code is better shown than pasted. That covers walking the user through code ("walk me through", "how does X work", "show me where"), explaining or reviewing code, pointing at a bug, pairing or co-editing files with them, and showing them a change you made. Also use when they mention their editor, VS Code, or "this line", "here" or "my selection". It opens the thread's VS Code beside the chat, points their editor at lines, and types edits into their open files.
---

# Studio Code: the workbench beside the chat

Studio now includes Studio Code and its six unchanged `code_*` tools. RPC callers use Studio’s `code.*` methods.

Studio Code puts a real VS Code next to the conversation: one per thread, open to the thread's own worktree. It's the user's editor in BB; code files they click open there. You and the user can look at the same code. You can move their editor to the lines you mean, and type into their files while they watch. Reach for it whenever you want to show code instead of pasting it into the chat: walkthroughs, explanations, reviews, bug hunts, and editing a file together.

Don't open it for work the user won't look at. You can read and change files with your own tools without it.

## Getting VS Code open

- Call `code_workspace_open`. It makes sure this thread has its VS Code, open to your working folder, so the user sees exactly what you're working on. The user opens it from the thread's **VS Code** tab.
- The tools below only reach files in that worktree (or in a VS Code the user already has open on them). There are no other folders to open.
- `code_editor_state` tells you whether their editor is open and what's on screen. If nothing is open yet, `code_show` waits and jumps there when they open it.

## What you know each turn

When the user has the thread's VS Code open, every turn starts with what they're looking at: the file, the lines on screen, their selection (with its text), errors and warnings, and files with unsaved changes. "This", "here", "it" and "this line" usually mean their selection or the file in front of them. Use that before asking which code they mean. `code_editor_state` gives the latest view mid-turn.

## Pointing at code: `code_show`

`code_show(path, startLine, endLine)` opens the file in their editor, scrolls to the lines, and selects and highlights them.

- Call it whenever your reply is about specific lines: "the bug is here", "this is where the token is checked". Show the exact lines, not the whole function.
- Show one place per point you make. Don't call it for every file you read.
- Line numbers are 1-based and should be the current ones. Read the file first if you might be off.

## Walkthroughs

Chat text only appears when your turn ends, but `code_show` acts at once. Several `code_show` calls in one turn flash past before the user has read anything. So:

- **Short explanation (one to three places):** show the most important place with `code_show`, and refer to the others by file and line in your text.
- **A real walkthrough (more than three stops):** give one stop per reply. Plan the route first: the entry point, then the main path, then the edge cases. Each reply shows one place, explains it in a few sentences, and offers the next stop:

  ```
  ::next{reply="➡️ Next: how the retry delay grows|❓ Explain this part more"}
  ```

  Say at the start how many stops there are, and keep each stop to one idea.
- Follow the user if they wander. A selection or question in their editor beats your planned route.

## Editing together: `code_edit`

`code_edit(path, edits)` types into their open file. They watch it arrive behind a "BB" caret. It's one undo step (⌘Z), and it merges with anything they haven't saved.

- Each edit replaces `oldText`, which must appear exactly once (include enough around it), with `newText`. An empty `oldText` appends. Only the part that actually changes gets typed.
- Use it for files they have open or are working in, and for small, readable changes they should see happen. Use your own tools for files they don't have open, for new files, and for large rewrites.
- **Never write a file with your own tools while it's listed as having unsaved changes.** Their editor is newer than the disk, and your write would conflict. `code_edit` is safe there. It leaves saving to them.
- After editing, say what changed, and that ⌘Z undoes it.
- When they ask you to change "this", edit their selection and keep the rest of the file as it is.

## Code review comments: `code_comments`, `code_comment_reply`

The user can review code in VS Code like a pull request: they leave comments on lines and submit them to you together. A review arrives as one message, "Code review from VS Code", with each comment's file, lines, code and comment thread id.

- Work through every comment. Fix what they ask for, or say why not.
- Answer each in its own thread with `code_comment_reply(id, body)`: what you changed, or your question. They read it next to the code. Keep it short; the chat reply can sum up.
- Add `resolve: true` when a comment is fully addressed. Leave it open when you asked a question or need them to decide.
- `code_comments` lists the open threads sent to you, with what was said. Comments they haven't submitted yet aren't yours to see.

## When they watch you work

While you work, their editor can follow along. The status bar shows what you're reading or editing, read lines are softly highlighted, and lines you change stay marked until your next turn. This happens by itself, but it reads well only if your work is targeted:

- Read with line ranges (`sed -n '40,80p' file` or your read tool with an offset) rather than whole files, so the highlight lands on what matters.
- Make edits small and in place, so the marks show the change and not the whole file.

## Tools

| Tool | Use |
|---|---|
| `code_workspace_open` | Make sure this thread's VS Code exists, open to your worktree. |
| `code_editor_state` | What they have open now: file, lines on screen, selection, errors, unsaved files. |
| `code_show` | Move their editor to lines and highlight them. |
| `code_edit` | Type edits into their open file; one undo step; merges with unsaved changes. |
| `code_comments` | Open review comments sent to you. |
| `code_comment_reply` | Answer a review comment, and resolve it. |
