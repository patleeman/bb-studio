# Studio Chat

Studio Chat takes Pages' "Work with this page…" card out of Pages and makes
it a plugin of its own. It floats over any screen, and it can hold any
thread: a new one, or one you pick from the sidebar. It also knows what it's
floating over. On a page it works on that page; on a drawing, that drawing.

Plugin id `studio-chat`, display name "Studio Chat", in
`packages/bb-studio-chat`.

## What BB gives us

All of this is in the stable SDK 0.5.29:

| Need | SDK surface |
|---|---|
| A card over every screen | `app.slots.experimental_appOverlay`, mounted once per window. The plugin places it |
| The chat itself | `ThreadChat` (`variant: "compact"`), `ThreadTitle`, and `experimental_NewThreadComposer` for a new thread |
| Pick a sidebar thread | `experimental_useSidebarThreads()` for the list (it works outside the sidebar); `experimental_useSidebarThreadActions().open(id, { split })` to jump to one |
| Float the current thread | `app.slots.experimental_threadHeaderAction`, one control per visible thread header |
| Float from the sidebar | Studio Sidebar's own row menu, through the `bb-studio:chat:float` window event |
| Keyboard and palette | `app.commands.register({ id, title, defaultShortcut, run })` |
| Tell the agent what's on screen | Our own mention provider (`bb.ui.registerMentionProvider`). BB resolves plugin pills in `threads.spawn` input |
| Find the item on screen | Studio's new `itemAt` RPC, which matches a path against every add-on's item `href`s |

## What it looks like

It looks the same as Pages' card did, bottom right:

- **Closed:** a slim bar. On a Studio item it reads "Work with this page…"
  or "…this drawing…", and so on by kind. Anywhere else there's no bar until
  you float a thread.
- **Compose:** the new-thread composer. Sending starts a thread in the item's
  project, with the item's pill already in the message.
- **Thread:** the conversation in a card, with a header of minimize, title,
  the ⋯ menu, and close.
- **Minimized:** just the header.

The ⋯ menu lists sidebar threads with a filter box, then "New chat", "Open
thread" and "Open in split". The card hides while the thread's own view is
on screen. Drag its top-left corner to resize it; double-click the corner to
reset. The size is kept across windows and reloads.

State is per window, in session storage: the thread and the mode. The card
also remembers the last thread used on each item, so reopening a page brings
its chat back, minimized. That item→thread link lives in the plugin's server
storage, so a phone could find it too.

## Context awareness

1. **What's on screen.** The server asks Studio's `itemAt` which item the
   path opens. The result is the item and its kind. There's no per-kind
   code, so new add-ons work without changes. Threads, files and settings
   don't match and get no context.
2. **Telling the agent.** Sending from the card puts a pill for the item at
   the start of the message (for pages, Pages' `work` adds its own context).
   BB resolves the pill through our provider into a short note: the item's
   kind, title, id and link, plus which tools read and edit it. The note is
   a pointer, not the content, since the add-on's own tools always read the
   latest version.
3. **Kind hints.** The tool names come from an optional `agentHint` on each
   kind in the bb-studio-kit contract (additive). Kinds without one get a
   generic hint to use `studio_list_items`.
4. **Following you.** A floated thread stays when you move to another item,
   and the "Viewing" chip updates. The chip's "Add to message" button would
   put the new item in the next message, but it's hidden for now (see
   Limits).

## Pages

- PageView renders its own `PageChat` only while Studio Chat is absent, the
  same way add-on collections hand over to Studio.
- With Studio Chat present, opening a page chat (the Chats menu, or the
  `/chat/<threadId>` route) dispatches `bb-studio:chat:float` to float it.
- Pages keeps its `work`, `chats` and `chatPage` RPCs unchanged, since
  mobile clients use them. Studio Chat starts page chats
  through `work` and reads `chats` for the item's last thread, so current
  page chats carry over.
- While the comments card is open on a wide screen, the page sets
  `--studio-chat-right` so the card sits left of it. Neither plugin imports
  the other.

## Limits

We work around BB's gaps rather than wait on BB features.

- **Sidebar row menu.** BB has no slot in its own row menu, but Studio
  Sidebar (Thread List Plus) draws its own. It adds "Float in Studio Chat"
  after "Open in split" while Studio Chat is installed, and dispatches
  `bb-studio:chat:float`, so neither plugin imports the other.
- **The current route.** Overlays get no route from BB. The kit's
  `usePathname()` (`packages/bb-studio-kit/src/app/route.ts`) follows the
  Navigation API's `currententrychange` and `popstate`, and polls
  `location.pathname` every 400ms as a fallback. The thread on screen comes
  from matching `/thr_…/` in the path.
- **Adding the item to a floated chat.** In SDK 0.5.29, `useComposer()` inside
  `ThreadChat`'s `leadingContent` reports `scope.kind === "new-thread"`, not
  the chat's thread, so `insertMention` would write to the wrong draft. The
  Viewing chip therefore only names the item; typing `@` in the chat finds
  Studio items. The chip's button shows by itself if a later BB scopes the
  composer to the chat's thread.

## Decisions

- **Name.** "Studio Chat" (`studio-chat`), part of the suite.
- **Where the bar shows.** Only on Studio items.
- **Pages without it.** Pages keeps its own chat bar only while Studio Chat
  isn't installed.
