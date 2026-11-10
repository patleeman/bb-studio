# Daily fork sync: brief for the agent

You keep the BB Studio fork in step with upstream bb. Work in `~/workingdir/bb-studio-native`. Read `AGENTS.fork.md` first.

## Hard limits

- Never push, never open a pull request or an issue, never post anything on GitHub.
- Never check out, move, reset or rebase `exp/studio-native`. The only ref you may move is the local branch `exp/studio-native-candidate`, and only through `sync.mjs`.
- Work only inside the throwaway worktree that `sync.mjs` creates under `../.bb-studio-fork-sync/`. Do not start or restart any running bb instance.

## Steps

1. Run `node scripts/fork/sync.mjs --fetch`. It replays the hand commits onto `upstream/main`, checks the core diff against the ledger, regenerates the generated commits, runs typecheck, build and tests, and moves the candidate branch. If it prints `Result: OK`, you are done: say nothing.
2. If it stops on a conflict, resolve it in the worktree it names:
   - For each conflicted file, read its entry in `scripts/fork/core-edits.json`. The `intent` says what the fork needs from that file; `seam` names the section of `STUDIO_FORK.md` that explains it.
   - Take upstream's version of the surrounding code and put the fork's hook back so the intent still holds. Keep the edit as small as it was. If upstream renamed or moved what the hook calls, follow the rename. If the hook no longer fits, move behavior into the fork-owned file instead of growing the core edit.
   - A conflict in a file that is not in the ledger means a rule was broken earlier. Resolve it the same way and add the entry.
   - If upstream changed lines that `scripts/fork/patches/unregister.patch` edits, the strip step reports `NOT APPLIED`. Apply the patch with `git apply --3way`, fix the result, and write the new diff of those files back to the patch (see `STUDIO_FORK.md`).
   - Conflicts that only touch import lines are already resolved by `sync.mjs` (it keeps upstream's imports and adds the ones the fork commit added); check them, and let typecheck be the safety net.
   - Then read `git status --short`, `git add` each file you fixed (never `git add -A` without reading the status first), run `git cherry-pick --continue` and the `Fork-Source` amend that `sync.mjs` printed, and rerun `sync.mjs --continue <worktree>`.
   - git rerere is OFF for the sync (`sync.mjs` sets `rerere.enabled=false` in its worktree and on every pick). Do not turn it on: a resolution recorded in a trial or another worktree would be replayed without anyone looking at it. Any trial replay you run by hand uses `git -c rerere.enabled=false`.
3. If a check fails after the replay, read the log path it printed. Fix what the fork broke with a new commit in the worktree, below the generated commits (the fork's own code first; a test the fork breaks on purpose goes in `scripts/fork/skipped-tests.json`). Rerun with `--continue`.

## When to report

Report only when you could not resolve a conflict or could not make the checks pass. Say which commit and files, what upstream changed, what you tried, and the worktree path. Count the conflicts and say how hard each was (trivial: context moved; small: a renamed symbol or moved block; hard: upstream rewrote what the hook relies on). Do not give time estimates. When everything passed, do not report.
