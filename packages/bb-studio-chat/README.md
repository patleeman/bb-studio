# Studio Chat upgrade bridge

Item chat, conversation selection, and quotes now ship with [Studio](../bb-studio).
This package (plugin ID `studio-chat`) is not in the marketplace. It stays only
for existing installs, and owns no chat UI or new conversation links.

## Upgrade

Update Studio first, then update the bridge and migrate:

```sh
bb plugin update studio --yes
bb plugin update studio-chat --yes
bb studio-chat migrate
```

Wait for **Migration complete** before removing the bridge. The migration
copies chosen conversations and explicit unlinks into Studio, keeps the
original records, and never replaces a newer Studio choice. Malformed records
are skipped and listed. A failed migration, such as Studio being disabled, can
be retried.

## What the bridge still does

- Forwards older native clients' chat calls to Studio.
- Resolves item mentions ("On screen") into a pointer to the Studio item.
- Redirects old chat bookmarks.

Keep it installed while old clients or bookmarks still need it. New clients call
Studio directly. Composer draft keys and the quote IndexedDB store keep their
original names, so unsent text, attachments, and quotes survive.

## Staged preview

![Studio item chat composing a quote about an image](assets/staged-preview.png)

The capture shows the chat that now ships in Studio, which this bridge forwards
to: a staged "Release diagram" image open in Studio, with its **Chat about
"Release diagram"** composer. The draft quotes a cropped area of
the image, adds a note and attaches `release-review.txt`. This package has no UI
of its own; Studio's captures and behavior tests cover chat.
