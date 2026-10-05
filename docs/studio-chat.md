# Studio Chat

Studio items share one **Chat** action in their header. It opens the item's
linked conversation, or a new-conversation composer when there is no link.
The menu offers **New conversation**, **Choose conversation…**, and **Unlink**.
Conversations open in the main view, where the sidebar lists them, or in a
split when you ⌘-click.

Item chat ships in plugin `studio`, in `packages/bb-studio/src/chat`.
RPC methods use the `chat.` prefix. The retired `studio-chat` package is an
upgrade bridge for saved links, older clients and bookmarks.

## Item identity and context

Each action carries the item's plugin ID and item ID. The `subject` RPC
resolves its title, kind, project, and link through Studio's `itemAt`. A
composer or picker stays bound to that item when the main pane navigates
elsewhere, and an action from a split targets the split's item.

The `viewing` RPC separately resolves the main pane's route, so Studio Chat
knows the home thread of the item on screen for its header chip. Kinds that
provide their own conversation UI set `hasOwnChat: true` to skip item-chat
discovery.

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

**Chat** opens the linked thread in BB's main thread view. Without a link,
it opens a compact new-conversation composer in the bottom-right corner, so
the item stays on screen while you write. A successful submission opens the
new thread and refreshes the item's home link. Failed submissions keep the
draft and quote. The Chat navigation panel also has a new-conversation
composer at a route per item (`/plugins/studio/chats/item/…`), keeping the
`studio-chat:<plugin>:<id>` draft key. Quote routes saved before Float was
removed still open from their IndexedDB copy.

## Stable SDK integration

| Responsibility | Surface |
| --- | --- |
| Chat button and options | Shared kit `ItemHeader` and item-chat host |
| Shared controller | `experimental_appOverlay` |
| Conversation creation | `experimental_NewThreadComposer`, in the corner or a retained `RetainedPanels` route |
| Conversation picker | `threads.list`, `threads.search`, `threads.get` |
| Thread presentation | `navigate.toThread` |
| Sent context | Registered item mention provider |
| Main-pane discovery | Kit `usePathname` and Studio `itemAt` |

## Pages

Pages renders its separate `PageChat` only when Studio is absent. Its
`work`, `chats`, and `chatPage` contracts remain unchanged. Existing page
chats and linked conversations carry over.
