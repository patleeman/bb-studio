---
name: bots
description: Manage persistent bot profiles that ordinary BB threads work as. Use owner-provided thread rosters to coordinate work.
---

# Bots

A bot is a profile with a mission and durable memory that a thread wears. Its work happens in ordinary BB threads that show the bot's avatar and name. Outside agents run in plain threads.

The owner can talk to every thread in a Studio Space at once from the Space's Command view (`/plugins/bot-teams/command/SPACE_ID`, opened from the Space's ⋯ menu in the sidebar). A message goes to the Space's lead unless the owner picks or @-mentions other threads; `@all` reaches every thread. Layouts are Merged final replies, Grid native transcripts, Active working threads, and Focus on one thread.

Use `bb bots --help` to discover commands. `bb bots list --json` lists profiles; `bb bots show @handle --json` reads a profile. Select bots by ID, @handle, or an unambiguous name.

Create a bot conversationally with `bb bots create NAME --mission TEXT`. Choose a fitting name, avatar, description and model from the owner's request. Leave `--interval 0` unless the owner asks for a mission schedule. Creating a bot from another bot's thread waits for owner approval. Use `bb bots update`, `swap`, `retire` and `restore` to manage the profile.

Read and update your own MISSION.md and MEMORY.md with `bb bots mission|memory @handle`. Saves need the current `--version` hash; use `--text TEXT` or `--file PATH --machine HOST_ID`. A bot cannot read or administer another bot's private profile files. Existing idle threads can take a profile through the Work as bot composer control. `bb bots message @handle` opens the latest thread; `newConversation` creates a fresh thread through the Teams API.

A Command view message includes all addressed real thread IDs as agent-only context. This roster authorizes you to read and message those threads for that request. Use `bb thread log THREAD_ID` and `bb thread tell THREAD_ID TEXT` to coordinate. Keep the work in ordinary threads and preserve attributed disagreements. Reply with your result in your own thread. If another addressed thread already covered your result, finish without a final assistant message; empty successful turns stay quiet. Do not send Command view messages as an agent.

Owner sends to busy threads follow global Smart Queue settings. `/steer`, `/followup` and `/fork` in the Command view composer override the mode for that send. Open the originating thread for tools, approvals, queued work, model choices and stopping a response.

Schedule work through the Automations plugin targeting a normal thread. Report a scheduled run's result as the final reply in its thread; when nothing changed, finish without a final assistant message. Ask the owner in the ordinary thread when a decision is needed. Do not recursively create schedules from scheduled work.
