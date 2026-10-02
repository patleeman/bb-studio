---
name: bots
description: Manage persistent bot profiles and saved views of ordinary BB threads. Use owner-provided thread rosters to coordinate work and Studio Feed for scheduled reports.
---

# Bots and saved views

A bot is a profile with a mission and durable memory. Its work happens in an ordinary BB thread. A saved view combines owner messages and final replies from its explicit bot and thread members. Threads can appear in more than one view. Child threads appear beneath their parents.

Use `bb bots --help` to discover commands. `bb bots list --json` lists profiles and views; `bb bots show @handle --json` reads a profile. Select bots by ID, @handle, or an unambiguous name.

Create a bot conversationally with `bb bots create NAME --mission TEXT`. Choose a fitting name, avatar, description and model from the owner's request. Leave `--interval 0` unless the owner asks for a mission schedule. Creating a bot from another bot's thread waits for owner approval. Use `bb bots update`, `swap`, `retire` and `restore` to manage the profile.

Read and update your own MISSION.md and MEMORY.md with `bb bots mission|memory @handle`. Saves need the current `--version` hash; use `--text TEXT` or `--file PATH --machine HOST_ID`. A bot cannot read or administer another bot's private profile files. Existing idle threads can take a profile through the Work as bot composer control. `bb bots message @handle` opens the latest thread; `newConversation` creates a fresh thread through the Teams API.

Use `bots_views` or `bb bots view-read VIEW_ID` to inspect a saved view. `bots_view_create` creates an explicit collection of `{kind:"bot",id:BOT_ID}` and `{kind:"thread",id:THREAD_ID}` members. Owners address members from the view composer with @handle, @handle+new, explicit selections or Reply. Untagged input asks Studio Decisions to choose recipients; an uncertain decision leaves the draft for the owner to address.

A view message includes all addressed real thread IDs before any recipient starts. This roster authorizes you to read and message those threads for that request. Use `bb thread log THREAD_ID` and `bb thread tell THREAD_ID TEXT` to coordinate. Keep the work in ordinary threads and preserve attributed disagreements. Reply with your result in your own thread. If another addressed thread already covered your result, reply exactly `[PASS]`; views hide it. Do not dispatch new view messages as an agent.

Owner sends to busy threads follow global Smart Queue settings. `/steer`, `/followup` and `/fork` in the view composer override the mode for that send. Open the originating thread for tools, approvals, queued work, model choices and stopping a response.

Schedule work through the Automations plugin targeting a normal thread. Scheduled reports belong in Studio Feed. Use a stable story key and update existing stories; post nothing when nothing changed or the result is `[PASS]`. Ask the owner in the ordinary thread when a decision is needed. Do not recursively create schedules from scheduled work.
