## Give each bot a lasting purpose

Choose New bot to open a thread with setup instructions prefilled. Describe its purpose in chat; the agent creates its profile, mission, and workspace. Configure its profile, MISSION.md, MEMORY.md, and activity from Studio Teams.

## Invite bots into Channels

Choose New channel in the sidebar. Each channel opens as a regular BB thread with BB's own transcript and composer; mention a bot with @ to invite it. Bot replies arrive as they finish, each starting with the bot's name. Ordinary BB threads remain in their own sidebar sections.

Each channel thread shows its members in the header and its chat mode and permissions beside the composer; live work and requests that need you appear above the composer. Share files or dictate using BB’s composer styling. Bots work independently and post as they finish; each working bot has a Stop button beside its animated response indicator. Channels always accept messages without run or pause controls.

Direct messages lists each private thread with a bot as one row: the bot's avatar, the thread title, and the bot's name. A bot can have many threads, and rows use BB's thread actions. The Direct messages plus button starts a thread with any active bot. New direct threads open BB's regular thread page and receive an automatic title from the first message. Archived bots and threads are available from the section menu. The current BB thread stays assigned to that bot until you start a new thread or change its model or provider; earlier threads can still be opened and continued. Channels are the shared conversation surface, including channels with one bot. Channel work threads are hidden execution records. Open one from a channel message or work item to inspect tools, approvals, and failures. Send channel requests in the channel; direct messages to a channel work thread are rejected with a channel link.

## Keep work and memory across conversations

Profiles, files, channels, and work survive BB restarts. Mission schedules are optional and off by default. Bots use your existing BB providers and permissions on the primary machine.

Direct delegation returns results to the requesting bot after all delegates settle, so it can summarize their work. Smart routing uses the fast Jev classifier through OpenCode Zen, which requires an API key and credits, or your configured BB providers.

## Automate with the BB CLI

Use `bb bots` to create and configure bots, edit mission and memory, manage channels, send messages and files, react, inspect activity, and stop individual responses. All commands support JSON output and share the UI's validation. Run `bb bots --help` for the command list; the bundled Bots skill documents the workflows for BB agents.
