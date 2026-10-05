# Studio Chat

Studio items share one **Chat** action in their header. It opens the item's
linked conversation, or a new-conversation composer when there is no link.
The menu offers **New conversation**, **Choose conversation…**, and **Unlink**.
Chat keeps the same label whether Float is installed or absent.

Plugin id `studio-chat`, display name "Studio Chat", in
`packages/bb-studio-chat`.

## Item identity and context

Each action carries the item's plugin ID and item ID. The `subject` RPC
resolves its title, kind, project, and link through Studio's `itemAt`. A
composer or picker stays bound to that item when the main pane navigates
elsewhere. Actions inside Float therefore target their own item.

The `viewing` RPC separately resolves the main pane's route for the
**Viewing** chip. That label describes what is visible; it does not change
the item attached to an open composer or add context to a message. Kinds that
provide their own conversation UI set `hasOwnChat: true` to skip item-chat
discovery and background chat tabs.

Sending from a new composer adds the item's mention pill. BB resolves it
into a pointer with its title, ID, link, and the kind's `agentHint` tools.
Kinds without a hint use `studio_list_items`. The agent reads fresh content
with those tools. [Studio references](studio-references.md) covers the kit
helpers that turn mentions and links back into a plugin ID and item ID. Page conversations go through Pages' `work` RPC, which
keeps existing page-chat records and mobile integration intact.

## Linked conversations

The home conversation is the newest explicit link or page-chat record.
Without one, the newest live thread recorded as creating the item stands in.
**Unlink** stores an empty link so that fallback does not return.
A thread can be linked to several items.

Quotes from item views use that link and queue behind an active turn.
Without a link, Chat opens the item's composer with the quote. A missing or
archived item produces an error rather than borrowing the main pane's item.
Choosing a conversation changes the item's link; starting another changes
it only after successful submission.

When revisiting an item, its linked thread can return as an unopened Float
tab behind the active one. Pinned or previously opened tabs stay protected.
Explicit Chat focuses the existing thread tab. Without Float, it opens BB's
main thread view. New-conversation composers use the same retained companion
tabs as conversations and item views. Each item has a canonical draft route
and keeps its existing `studio-chat:<plugin>:<id>` native draft key. Separate
quotes have independent draft IDs; their context, including cropped images,
is stored in IndexedDB before opening a companion. A successful submission
replaces its originating tab with the new thread and refreshes the item's
home link. Failed submissions retain the native draft and quote.
Quote context remains stored after submission because a pinned companion or
its Back history may still refer to that draft route.

The Chat navigation panel offers a plain new-conversation composer. The
conversation picker still uses Float's corner portal. Without Float, item
composers use the compact overlay. If local quote storage is unavailable,
Chat reports that failure and keeps the quote in the overlay for submission.

## Stable SDK integration

| Responsibility | Surface |
| --- | --- |
| Chat button and options | Shared kit `ItemHeader` and item-chat host |
| Shared controller | `experimental_appOverlay` |
| Conversation creation | `experimental_NewThreadComposer` in retained `FloatPanels` |
| Conversation picker | `threads.list`, `threads.search`, `threads.get` |
| Thread presentation | Kit `openCompanion`, then `navigate.toThread` fallback |
| Sent context | Registered item mention provider |
| Main-pane discovery | Kit `usePathname` and Studio `itemAt` |

## Pages and host work still pending

Pages renders its separate `PageChat` only when Studio Chat is absent.
Its `work`, `chats`, and `chatPage` contracts remain unchanged. Existing
page chats and linked conversations carry over. Standalone Pages chat and
its comment-related chat controller still need migration to the shared
companion system.

Stable SDK 0.5.29 does not scope `useComposer()` inside a plugin's `ThreadChat`
to the embedded thread. **Add to message** stays hidden unless the composer
scope matches that exact thread. Typing `@` in the thread can add Studio
items. BB's native right-workbench integration and state-preserving moves
between main, docked, and floating presentations remain part of the active
[full-suite delivery goal](unified-workbench.md).
