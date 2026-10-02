# Studio Teams

Studio Teams adds persistent bot profiles and saved views to BB Studio. Bots keep a mission and durable memory; their work happens in ordinary BB threads.

## Use

Create a bot from **Teams → New bot**. Describe its purpose in the prefilled conversation; the agent chooses sensible profile settings and creates it. The bot's page lets you edit its profile, mission and memory, and open every thread working as it. **Work as bot** beside a thread's composer attaches a profile to an idle thread. The thread keeps its own project and model selection. The profile’s **Chat** action resumes its direct conversation; **Chat → New conversation** starts another. Conversations open in the shared companion tabs, preferring the right workbench when supported and Float otherwise. Without Float, they open in the main view.

Open **Studio → New → View** and select bots or existing threads. Views are Studio items: find them in the collection, add tags or spaces, and open them as tabs under **Studio** in the sidebar. A view combines owner input and final replies from its members, including replies sent directly in a member thread. It hides tools, inter-agent input, unfinished output and `[PASS]`. Spawned child threads are folded beneath their parents. A thread can belong to several views; deleting a view leaves its threads intact. Bot profiles and saved views also open as companion tabs. A saved view keeps its own composer and title controls, and opening a member thread leaves the view’s draft in place.

The composer is BB's own prompt box, so it has the same editor, file attachments, voice dictation, and saved drafts as a thread. @-mention a bot, pick recipients from the menu under the box, or choose **Reply** on a message. Attachments go to every recipient. The approval menu beside it sets the approval mode for everyone or per member; **Each bot's own** leaves every thread's mode as it is. A bot continues its latest thread in this view. `@handle+new` or **New bot threads** creates a fresh one. All recipients receive the same addressed thread roster and recent context, with real thread IDs allocated before delivery. Untagged input asks Studio Decisions to choose recipients; if it is uncertain, the draft stays in the composer for you to address. Retry preserves successful deliveries when another recipient failed.

Busy messages use your global Smart Queue settings. Prefix a message with `/steer`, `/followup` or `/fork` to choose explicitly. Open a member thread for tools, approvals, queues, stopping work and model controls. The iOS app uses the same views and composer behavior.

## Missions and schedules

Mission and memory editors reject stale saves. A profile can configure a fallback model for managed mission work; a provider failure retries the mission once in a fresh thread. Ordinary threads keep BB's model and retry controls. Archiving a bot stops managed work and turns off its mission interval; its ordinary threads and history remain available.

Use BB Automations to schedule work in a normal thread. Scheduled findings go to Studio Feed with stable story keys. Legacy channel automations retain their triggers and enabled state while moving to normal profile threads. Legacy single-bot channel links open a fresh profile thread; multi-bot links open a saved view. Old channel messages remain in storage and are not replayed or displayed.

## CLI and tools

`bb bots --help` lists profile, mission, memory and saved view commands. Use `--json` for structured output. Agent tools provide `bots_views`, `bots_view_read`, `bots_view_create` and `bots_create`. Coordination uses `bb thread log` and `bb thread tell` with the owner's addressed roster.

The public RPC contract is [client-contract.ts](client-contract.ts); saved view schemas are [view-contract.ts](view-contract.ts). Bot and historical storage schemas remain in [contract.ts](contract.ts). The channel provider, channel orchestration, chat modes and channel tools have been removed.

## Staged preview

![A saved view over Atlas and Scribe's ordinary threads](assets/staged-preview.png)

Captured from an isolated stable BB installed from the pushed Git revision. The Launch work view shows deterministic ORBIT-42 replies from Atlas and Scribe, laid out like a regular BB thread: your messages on the right, each bot's reply under its name (which links to its ordinary thread), and BB's prompt box with recipient and approval menus beneath it.

The [compact preview](assets/staged-preview-mobile.png) shows the same live view at 390 pixels wide, with its latest reply and composer visible. The [bot profile](assets/bot-profile.png) and [sidebar](assets/studio-sidebar.png) show profile settings and a saved view open under Studio.
