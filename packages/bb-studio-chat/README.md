# Studio Chat

> **Studio Chat** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, tracking tasks, running bot teams, and keeping what your agents make: [Studio](../bb-studio), [Studio Pages](../bb-studio-pages), [Studio Talk](../bb-studio-talk), [Studio Draw](../bb-studio-draw), [Studio Artifacts](../bb-studio-artifacts), [Studio Tasks](../bb-studio-tasks), Studio Chat, and [Studio Teams](../bb-studio-teams).

One **Chat** action in a Studio item's header opens its linked conversation
or a new composer. Its menu lets you start another conversation, choose an
existing one, or unlink it. Chat and quotes target the chosen item, including
items inside [Float](../bb-studio-float) tabs while the main pane shows
something else.

## Staged preview

![Live BB screenshot of Studio Chat on a drawing](assets/staged-preview.png)

Captured from stable BB with the suite installed from a pushed commit:
"Checkout flow" has one Chat action, and its chosen "Draft the ORBIT-42
release notes" conversation opens in Float. The live capture also checks
unlinked composers, companion-item targeting, preserved context during main
navigation, conversation selection, and focusing an existing thread.

## What you get

- **Chat.** Continue the item's linked conversation or start one in its
  project. New messages carry an item pill that tells the agent which tools
  read and edit it.
- **Conversation options.** Choose a thread from recent conversations or
  search. Start another without changing the current link until you send.
  Unlink prevents the thread that created the item from standing in.
- **Quotes.** Selected artifact text or an image area goes to the linked
  conversation and waits behind its active turn. Without a link, the item's
  composer opens with the quote.
- **Correct context across panes.** A composer or picker stays bound to its
  item when you navigate. It uses that item's title, project, and link.
- **Existing conversations.** Page chats still go through Pages and remain
  in its Chats menu. Threads that created other items can serve as their
  linked conversation until you choose one.
- **Viewing chip.** Float thread tabs name the Studio item in the main pane.
  That label does not add it to the conversation automatically.
- **Saved views.** Teams views contain their own chat. Chat leaves their
  composer unobstructed and does not discover another item conversation.

## Limits

The native right workbench and moving live state between main and companion
presentations remain in the [full-suite delivery work](../../docs/unified-workbench.md).
Threads currently open in Float, or in BB's main view without Float.
Pages keeps its standalone chat fallback until that migration is complete.

On stable SDK 0.5.29, embedded `ThreadChat` does not scope `useComposer()` to
its thread. The Viewing chip only offers **Add to message** when the scope
matches. Type `@` in the thread to mention an item. Main-pane discovery
follows BB navigation and polls every 400ms as a fallback.

More in [docs/studio-chat.md](../../docs/studio-chat.md).

## Develop

```sh
pnpm install
pnpm --filter @bb-studio/studio-chat test
pnpm --filter @bb-studio/studio-chat typecheck
bb plugin build packages/bb-studio-chat
node scripts/staged-bb.mjs start --plugin studio-chat
```

Requires [Studio](../bb-studio) to resolve item context. The item header and
shared host live in [the kit](../bb-studio-kit/src/app/item-chat.ts).
