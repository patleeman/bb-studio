# Strand-sorting eval

Three synthetic conversations written from scratch (a made-up software team,
a made-up hobby app, made-up household chores; made-up ids, a made-up 2031
epoch), shaped like real ones: workers with plans and quiet progress
reports, relays from other threads, background tasks that finish with no
message, roundups, quoted replies, quick-reply buttons, asks, messages about
two strands, and strands that branch from another. Every message is labeled
with its strand (or `trunk` for the whole conversation, `none` for no work),
`also` for a second strand, `clears` for the asks it answers;
`strands[].parent` is what a strand branched from. `today` mimics the old
sorter's known failures (quiet and message-less reports unsorted, roundups
and pressed buttons filed with the turn before, branches folded into their
parent). The real conversations the eval was built on stay out of the repo.

- `score.ts`: the run's strands are matched to the labeled ones one to one,
  by the messages each measure scores, so lumping or splitting loses points.
  A message is right when its main strand is its label or one of its `also`.
  *sortable*: user messages and reports with a reply the user reads; *all*:
  every turn, quiet reports included; *lineage*: a parent or child counts.
- `replay.ts`: feeds a conversation to the real `StrandService` turn by turn.
- `run.ts`: `--today` scores today's filing; `--recorded <dir>` replays with
  recorded answers (what `eval.test.ts` does); `--record <dir>` replays with a
  stand-in for Jev and the small model and records them. The stand-in is
  Codex in ephemeral mode with the staged sign-in (`~/.bb-staged/codex`), a
  small fast model, not Jev. `--rich` turns on the Studio setting
  `strands_richSorting`. `--live-jev` sends Jev's questions to the running
  Studio's real Jev (`bb plugin rpc call studio decisions.systemOne.ask`; only
  with the user's OK, since it is their BB); nothing else reaches it, and
  `STRANDS_EVAL_JEV_MAX` (default 400) caps the calls across runs sharing
  `STRANDS_EVAL_JEV_LOG`.

The recordings in `recorded/` cover the default only (richer sorting off).
After changing what Jev or the small model is asked, re-record and update
`recorded/floor.json`:

```sh
cd plugins/packages/bb-studio
for n in team-lead side-project household; do
  npx tsx src/strands/eval/run.ts src/strands/eval/conversations/$n.json --record src/strands/eval/recorded --wrong
done
```
