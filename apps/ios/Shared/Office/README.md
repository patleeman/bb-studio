# Office data layer

All stores are `@Observable @MainActor`. Construct Space-specific stores anew
when `SpacesStore.currentSpaceId` changes. Each exposes `load()` and `refresh()`
(async), `isLoading`, and `error: String?`. Refresh preserves the last good value
on failure and ignores superseded responses.

- `SpacesStore(client:)`: `spaces`, `currentSpace`, `currentSpaceId`, `select(_:)`.
  Selection is stored in app-group defaults at `office.currentSpaceId`. A removed
  selection falls back to the default Space, then the first Space.
- `WorkStore(spaceId:client:)`: `tree`, `folders`. Feed the existing inbox/thread
  list's `[ThreadEntry]` to `mergeThreadList(_:)` when it changes. Only existing
  tree threads receive newer status/title timestamps; it never adds bot threads.
- `HomeStore(spaceId:client:)`: `home`, `needsYou`, `working`, `reports`, `recent`.
- `TeamStore(spaceId:client:)`: `bots`, `conversations`.

`BBClient+Office.swift` wraps the live Space/folder contract. The generator merges
`src/office/contract.ts` into the Studio schema and generated Swift methods.
`OfficeProvisionalAPI.swift` currently follows the web office model for Home,
Team, Talk, and bot desks. These methods are pending backend stages 4–6, are
explicitly recorded as dynamic calls in the native inventory, and must be
reconciled with the generated contract when it lands.

`OfficeModels.swift` uses seconds/milliseconds exactly as sent by the server;
its timestamp fields are raw `Double` values. Do not infer dates without checking
the owning RPC's units. Work items use `pluginId:itemId` as list identity; their
wire id remains available as `itemId`.

The stores accept fetch closures for isolated tests and preview fixtures. Native
payload fixtures validate both request and response schemas; `OfficeStoreTests`
asserts actual client transport bytes, decoding, and store state transitions.

`InboxStore(client:)` loads all spaces. `events` includes per-event `isPending`;
`counts` contains per-space request/unread-report counts. `act(key:actionId:text:)`,
`done(keys:)`, and `read(keys:)` return whether the action succeeded. They apply
optimistic overlays, reject duplicate pending actions, and roll back failures.
`loadMore()` follows `nextCursor` (the wire field is `cursor`).

Call `startObserving(_:)` with the app's existing `BBRealtime` when binding the
store and `stopObserving()` on teardown. It listens for reconnects, thread changes,
Studio source signals, and validated pushes. It does not own the shared socket.
`OfficePush.receive` validates server identity before announcing a refresh.
Notifications with `inboxKey` route approve/deny/text-answer through `inbox_act`;
unsupported forms open the app. The coordinator owns their Inbox navigation.
Legacy notifications without an Inbox key retain their existing action path.
