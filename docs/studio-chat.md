# Studio Chat

Studio Chat takes Pages' "Work with this page…" bar out of Pages and puts
New in Float and Open in Float on every Studio item in its place. It knows
what's on screen: on a page it works on that page; on a drawing, that
drawing. Its threads open in [Float](float.md) tabs. Studio Chat used to have its own floating card; that became the
Float plugin, so anything can float, several things at once.

Plugin id `studio-chat`, display name "Studio Chat", in
`packages/bb-studio-chat`.

## What BB gives us

All of this is in the stable SDK 0.5.29:

| Need | SDK surface |
|---|---|
| The buttons on every screen | `app.slots.experimental_appOverlay`, mounted once per window, portalled into Float's bottom-right corner when Float runs |
| A new thread | `experimental_NewThreadComposer` |
| Recent threads and search for Open in Float | `useSdk().threads.list` and `threads.search` |
| Where threads show | Float's tabs, through the kit's `openFloat` |
| Tell the agent what's on screen | Our own mention provider (`bb.ui.registerMentionProvider`). BB resolves plugin pills in `threads.spawn` input |
| Find the item on screen | Studio's new `itemAt` RPC, which matches a path against every add-on's item `href`s |

## What it looks like

- **Closed:** two buttons, New in Float and Open in Float, in Float's
  bottom-right corner, right of a docked Float panel. They show on Studio
  items only. Without Float they read New thread and Open thread.
- **New in Float:** the new-thread composer. Sending starts a thread in the item's
  project, with the item's pill already in the message, and opens it in a
  Float tab (or BB's own thread view without Float).
- **Open in Float:** a picker listing the item's last chat, then your 30 most
  recent threads. Typing two or more letters searches all active threads.
  Arrow keys and Enter pick; Escape or clicking away closes it. The pick
  opens as a plain Float tab, without the item's tag, so moving on doesn't
  swap it out.

The plugin remembers the last thread used on each item, so reopening a page
brings its chat back as a tab behind the one showing. Those tabs carry a
tag, so moving to the next item swaps the tab instead of adding one per item,
unless you're looking at it.
The item→thread link lives in the plugin's server storage, so a phone could
find it too.

## Context awareness

1. **What's on screen.** The server asks Studio's `itemAt` which item the
   path opens. The result is the item and its kind. There's no per-kind
   code, so new add-ons work without changes. Threads, files and settings
   don't match and get no context.
2. **Telling the agent.** Sending from the composer puts a pill for the item at
   the start of the message (for pages, Pages' `work` adds its own context).
   BB resolves the pill through our provider into a short note: the item's
   kind, title, id and link, plus which tools read and edit it. The note is
   a pointer, not the content, since the add-on's own tools always read the
   latest version.
3. **Kind hints.** The tool names come from an optional `agentHint` on each
   kind in the bb-studio-kit contract (additive). Kinds without one get a
   generic hint to use `studio_list_items`.
4. **Following you.** A Float thread tab stays when you move to another
   item, and the "Viewing" chip Studio Chat adds to it updates. The chip's "Add to message" button would
   put the new item in the next message, but it's hidden for now (see
   Limits).

## Pages

- PageView renders its own `PageChat` box only while Studio Chat is absent,
  the same way add-on collections hand over to Studio.
- With Float present, opening a page chat (the Chats menu, the box, or the
  `/chat/<threadId>` route) opens it as a Float tab instead of Pages' card.
- Pages keeps its `work`, `chats` and `chatPage` RPCs unchanged, since
  mobile clients use them. Studio Chat starts page chats
  through `work` and reads `chats` for the item's last thread, so current
  page chats carry over.
- While the comments card is open on a wide screen, the page sets
  `--studio-float-right` so Float's docked panel and corner sit left of it.

## Limits

We work around BB's gaps rather than wait on BB features.

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
- **Where the buttons show.** Only on Studio items.
- **Labels.** The item header already has a New thread button that opens
  BB's full composer, so with Float the corner's buttons say where the
  thread goes: New in Float, Open in Float.
- **New and open, not one bar.** One "Work with this…" bar only started
  threads. New in Float and Open in Float also bring an existing thread into
  Float next to the item.
- **Pages without it.** Pages keeps its own chat bar only while Studio Chat
  isn't installed.
- **Windows.** Floating moved to the Float plugin; Studio Chat only adds the
  buttons, the item's chat and the Viewing chip.
