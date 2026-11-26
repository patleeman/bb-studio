---
name: move-provider
description: "Use when you are asked to move threads, runners, automations or a Bot to another agent provider (for example from Claude Code to an ACP agent) with `bbs studio move-provider`: the inventory, dry run, canary, bulk move, verify and rollback runbook."
---

# Move threads to another provider

A move keeps the thread id and its history. Core clears the provider
session and swaps the provider and model in one step. Studio stores a
handoff (recent turns word for word, older turns as an outline, and the
full transcript as a file). The thread's next turn on the new provider gets
that handoff.

Every command here is non-interactive and has `--json`. Exit codes:
`0` all done, `2` something was skipped, deferred or failed (the JSON says
why), `1` bad input.

## Rules

- **Never move the thread you are running in.** The command skips it
  (`skipped: current-thread`). Run the migration from a worker thread. Move
  Main last, by id, from another thread.
- **Never widen a permission.** Without `--permission`, `full` steps down to
  `auto`, and `auto` becomes `accept-edits` on an ACP target. `--permission`
  can only narrow: `--permission full` works only for a thread that is `full`
  already (any other thread fails with `permission-widening`), and even then
  needs the user's explicit OK. An automation without a mode of its own keeps
  none and runs with its thread's.
- **Dry run first, and show it to the user.** Don't run the real move until
  the user has read the dry run and said yes.
- Model, permission and history size are flags. Don't assume values. Without
  `--model` the target's default model is used. History defaults to 150000
  tokens (`--history-tokens`).

## Commands

```sh
# Move (selectors combine: --from/--project list threads, --bot/--runners narrow or select)
bbs studio move-provider [<thread-id>…] [--from <provider>] [--project <id>] [--bot <id|name>] \
  [--include-archived] [--runners] [--exclude-main] --to <provider> [--model <model>] [--permission <mode>] \
  [--history-tokens <n>] [--automations] [--bot-defaults] [--router-rules] [--no-defer] [--dry-run] [--json]

bbs studio move-provider status [<thread-id>…] [--json]   # ledger + event log, as core counts it: pending until the new provider accepts a real request after the move, then rebuilt (started for a forced move)
bbs studio move-provider verify <thread-id>…|--all [--probe "<question>"] [--json]
bbs studio move-provider cancel <thread-id>…|--all-deferred [--json]   # the watcher won't move these
bbs studio bot set-model <bot> --provider <provider> [--model <model>] [--dry-run] [--json]
bbs studio runner move-provider <runner>…|--all [--bot <bot>] --to <provider> [--model …] [--dry-run] [--json]
bbs studio tool-delivery [<provider> default|all|defer|trio] [--json]
```

- `--automations` moves BB automations and Studio automations that target a
  moved thread onto the target (provider, model, a permission no wider than
  the automation's own). `--runners` selects runner threads and always
  patches their automations.
- `--bot-defaults` sets the default model of the Bot (`--bot`) or of every
  Bot whose default is on `--from`.
- `--router-rules` points router chain targets on `--from` at the target.
- A running thread is `deferred`. Studio moves it when it goes idle (a
  deferred Main waits until no other thread is deferred). If its provider or
  model changed in the meantime, it fails with `changed-since-deferred`
  instead. `cancel` drops a deferral; with `--no-defer` a running thread is
  `skipped` and any earlier deferral of it is dropped.
- `--history-tokens` is at least 1 (150000 by default). The whole handoff
  fits core's budget for a move turn (`historyTokens*4 + 8000` characters):
  the newest turns first, then as much outline as fits. The dry run shows
  that limit per thread (`handoffEstimate`).
- `--exclude-main` leaves every Bot's Main out unless you name it by id.

Per-thread results: `moved`, `already-moved`, `would-move` (dry run),
`deferred` (`running` or `busy`), `skipped` (`current-thread`, `running`),
`failed` (`permission-widening`, `model-unavailable`,
`provider-unavailable-on-machine`, `no-handoff-handler`, `handoff-failed`,
`core-unavailable`, …).

The ledger (KV `studio.moveProvider.ledger`) records each thread's outcome
and its failed automation patches; failed Bot default and router patches are
in KV `studio.moveProvider.patches`. `status` shows all of them and exits 2
while anything is failed, deferred or owed. Running a move to the same target
again is safe: moved threads come back `already-moved`, failed and deferred
ones are tried again, and owed patches are retried even when the selectors no
longer pick their threads. Patches that already match are `unchanged`, never
written twice.

## Runbook

1. **Preconditions.** The target provider is signed in on every machine that
   runs a selected thread: `bbs provider models <to> --machine …`. Decide the
   tool delivery for the target (`bbs studio tool-delivery <to> all|trio`);
   the default for a new provider is `trio`.
2. **Inventory and dry run.** Save the output where the user can read it:
   ```sh
   bbs studio move-provider --from claude-code --to <to> --model <model> \
     --automations --bot-defaults --dry-run --json > move-dry-run.json
   ```
   Check each thread's permission before → after, deferred and failed rows,
   and the automations. Ask the user to review it. Stop here until they say
   yes.
3. **Canary.** One low-risk conversation and one runner, by id:
   ```sh
   bbs studio move-provider <conversation-id> --to <to> --model <model> --json
   bbs studio runner move-provider <runner> --to <to> --model <model> --json
   ```
   Wait for each one's next turn (send it a message, or wait for the runner's
   next run). Then `bbs studio move-provider verify <ids> --json` must say
   `ok`. Optionally ask a question only its early history can answer:
   `verify <id> --probe "What was the first thing I asked you here?"`.
4. **The rest.** Run the step 2 command without `--dry-run` and with
   `--exclude-main`. Run it again until `bbs studio move-provider status`
   exits 0 (nothing failed, deferred or owed), or stop and report what is
   stuck and why.
5. **Main last,** from a worker, by id: `bbs studio move-provider <main-id> --to … --json`.
6. **Verify all.** `bbs studio move-provider verify --all --json`.
   `--all` never probes a Main; probe Main only by its id. Check
   `bbs studio move-provider status --json` and the permission columns.
7. **Report** the counts, anything failed and why, and anything that needs
   the user.

## Rollback

Move back with the same command and the old provider: `--to claude-code
--model <old model>` (with `--automations` and `--bot-defaults` if you used
them). History is kept either way; the thread gets a handoff on the old
provider too. This only works while the old provider is still signed in. It does **not**
restore lowered permissions: a thread that went from `auto` to
`accept-edits` stays there (moving back never widens). Raise it by hand if the
user wants it back.

## Don'ts

- No `--permission full` without the user's OK.
- Don't move a thread that is waiting on the user; it comes back `deferred`
  and moves once it is idle.
- Don't edit the ledger by hand. Run the command again instead.
