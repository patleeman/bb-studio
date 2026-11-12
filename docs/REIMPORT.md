# Re-importing from the old repositories

Until cutover, other work may still land in the old repositories. This file records what was imported and how to bring in newer commits. Both procedures only read the old repositories.

## What the first import took (12 Nov 2026)

| Source | Ref | Commit |
|---|---|---|
| Fork, `~/workingdir/bb` | `exp/studio-native` | `cb838ca09e0ccb92a45a49a2235e827eabaf4ae5` |
| Fork hand tip (below the 3 generated commits) | | `fda76d8cb0e2a78530dd80bf4a16cf789bea9d87` |
| Fork base on `get-bb/bb` | | `7c1353d80729983b86ea1555d18b42407f320406` |
| `upstream/main` at import | | `365d7c5237ae270be0555b5b44ea61020252713e` |
| Plugins, `~/workingdir/bb-studio` | `exp/studio-native` | `13eb99267d514f2029088425a1412e4d778682e8` |
| Plugins after `scripts/filter-plugins.sh` | | `927249aff48314e90aea73149459265330e19610` |

The `desktop` branch is the 43 hand commits replayed by `sync.mjs` onto the same base, plus `fork: monorepo paths and push rules`, plus the 3 regenerated commits; its first tip is `480f02877b8fada912a86198388a95b9e570dd41`. Each replayed commit has a `Fork-Source:` trailer naming the old commit. The tree of `cb838ca09e` plus the tooling commit equals the tree of `desktop` (the reproduction check said "tree is identical").

## What the second import took (12 Nov 2026)

| Source | Ref | Commit |
|---|---|---|
| Fork, `~/workingdir/bb` | `exp/studio-native` | `fb4afeec512d930d5d8bab49af5d16418e02109a` |
| Fork hand tip (below the 3 generated commits) | | `3fc20c484ed6511b2a15cc2c00d766080b60e3c2` |
| Fork base on `get-bb/bb` | | `7c1353d80729983b86ea1555d18b42407f320406` |
| `desktop` base (upstream) | | `030b1b729f` |
| Plugins, `~/workingdir/bb-studio` | `exp/studio-native` | `0fc1f2837293cc44dbb95f6639fe1e2625b3e7eb` |
| Plugins after `scripts/filter-plugins.sh` | | `af092d7f444cec4a54790e688c039ac534928d88` |

The old fork branch had been autosquash-rebased after the first import, so procedure (a) did not apply: `desktop` already carried an upstream sync and the removal of the `nav-hidden-pages` seam. The delta was taken from `git diff fda76d8cb 3fc20c484e` in the old fork: the one-line `PluginPanelRightPanelHost.tsx` mount went in as a fixup of `workbench: one tab row, …`, and `b09f1a3f82` (page workbench seam) and `3fc20c484e` (single-tab pop-out window) were cherry-picked as their own commits with `Fork-Source:` trailers. After `rebase -i --autosquash 030b1b729f` and regeneration, `desktop` is `f0e1b7fa6d91cd1c94b8964fbf4b7a0e17980819` (47 hand commits plus 3 generated), and `sync.mjs --onto 030b1b729f` said "tree is identical". The plugin history was not rewritten, so the filtered tip extends `927249aff` and was merged. `marketplace.json` did not change. For the next plugin import, use `af092d7f444cec4a54790e688c039ac534928d88` in the `--is-ancestor` line and `0fc1f2837293cc44dbb95f6639fe1e2625b3e7eb` as the last imported source commit.

## What the iOS import took (12 Nov 2026)

| Source | Ref | Commit |
|---|---|---|
| iOS app, `~/workingdir/bb-studio` `apps/ios` | `main` | `9aab9dd9f342ddc444edf77ff5ba230c08660c6c` |
| iOS after `scripts/filter-ios.sh` (610 commits, under `ios/`) | | `ddd7f8433ce5478df5b92620f503191bab0765e6` |

`main` held the most complete iOS history: every `apps/ios` commit on `exp/studio-native` is on `main`, and `main` adds one more (`1b792d89`). `main:ios` equals the source's `9aab9dd9:apps/ios` tree. After the merge, `plugins/scripts/gen-contracts.mjs` was pointed at `../ios` and `gen:contracts` was run once, so `ios/Shared/Generated/StudioContract.swift` differs from the imported file.

Uncommitted work in the old worktrees was not imported. Commit it there first.

## (a) A newer fork tip

The old branch keeps the same shape: hand commits on a base, three generated commits on top. Rebuild `desktop` from its hand commits plus the tooling commit, and let `sync.mjs` regenerate. This is only correct while nobody has committed on `desktop` itself; if someone has, cherry-pick those commits onto `desktop-work` too, after the tooling commit.

In the desktop worktree (`~/workingdir/bb-studio-app-desktop`, clean, branch `desktop`):

```sh
cd ~/workingdir/bb-studio-app-desktop
git status --short                                        # must be empty
git fetch --no-tags ~/workingdir/bb +exp/studio-native:refs/import/fork
base=$(git -C ~/workingdir/bb merge-base exp/studio-native upstream/main)
git cat-file -e "$base^{commit}"                          # the base is now present here
hand=$(git log -1 --format=%H --invert-grep --grep='^Fork-Generated:' refs/import/fork)
git log --oneline -4 refs/import/fork "^$hand"            # exactly the 3 generated commits
tooling=$(git log -1 --format=%H --grep='^fork: monorepo paths and push rules$' desktop)
git switch -c desktop-work "$hand"
git cherry-pick "$tooling"
node scripts/fork/check-core-diff.mjs --base "$base"      # no problems
node scripts/fork/sync.mjs --source desktop-work --onto "$base" --candidate desktop-candidate --checks quick
```

Expect "tree is identical to the source branch" and `Result: OK`. Then promote and import:

```sh
git switch desktop
git reset --hard desktop-candidate
git branch -D desktop-work
git update-ref -d refs/import/fork
cd ~/workingdir/bb-studio-app
node scripts/import-desktop.mjs
node scripts/import-desktop.mjs --check
```

If the old branch was synced onto a newer upstream, `$base` is newer than `desktop`'s base; the same commands work. Update the table above in the same commit as the import or right after it.

## (b) Newer plugin commits

`scripts/filter-plugins.sh` is deterministic: run on `13eb9926` it gives `927249aff` again, so a newer tip filters to the same old commits plus the new ones, and the merge only adds the new ones. This was tested on throwaway clones: a commit added on top of `13eb9926` (one change under `packages/`, one under `apps/`) filtered to a single commit on top of `927249aff` with the `apps/` change dropped, and merged into `main` cleanly.

On `main` (clean):

```sh
cd ~/workingdir/bb-studio-app
new=$(git -C ~/workingdir/bb-studio rev-parse exp/studio-native)
work=/tmp/bbs-import-$(echo "$new" | cut -c1-8)
scripts/filter-plugins.sh ~/workingdir/bb-studio "$new" "$work"
git fetch --no-tags "$work" import:plugins-import
git merge-base --is-ancestor 927249aff48314e90aea73149459265330e19610 plugins-import && echo extends
git merge --no-ff plugins-import -m "plugins: import bb-studio exp/studio-native $(echo "$new" | cut -c1-8)"
git branch -D plugins-import
rm -rf "$work"
git -C ~/workingdir/bb-studio show "$new:marketplace.json" | cmp - plugins/marketplace.json || echo "marketplace.json changed: copy it"
cd plugins && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
```

After a later import, use that import's filtered tip in the `--is-ancestor` line.

If `--is-ancestor` fails, the old branch was rewritten (rebased or amended) and a merge would duplicate history. Do not merge. Bring in the new commits as patches instead, from the last imported source commit:

```sh
cd ~/workingdir/bb-studio-app
old=13eb99267d514f2029088425a1412e4d778682e8               # last imported source commit
git -C ~/workingdir/bb-studio format-patch --stdout "$old..$new" -- . \
  ':!apps' ':!docs/ios' ':!docs/ui-redo' ':!docs/attention-router' \
  ':!marketplace.json' ':!.github' ':!.bb' ':!README.md' ':!LICENSE' > /tmp/bbs-plugins.mbox
git am --directory=plugins --empty=drop /tmp/bbs-plugins.mbox
```

`format-patch` skips merge commits; review `git log` afterwards. If the rewrite changed commits that were already imported, `$old..$new` misses them. Check with the fresh filter run from above: `git diff HEAD plugins-import -- plugins` must show only the files this repository changed on its own (such as `plugins/package.json` and `plugins/marketplace.json`).

## (c) Newer iOS commits

`scripts/filter-ios.sh` keeps only `apps/ios` and moves it to `ios/`. It is deterministic: run on `9aab9dd9` it gives `ddd7f843` again, so a newer tip filters to the same old commits plus the new ones. Take the commit from the branch that holds the iOS work (`main` at the first import).

On `main` (clean):

```sh
cd ~/workingdir/bb-studio-app
new=$(git -C ~/workingdir/bb-studio rev-parse main)
work=/tmp/bbs-ios-$(echo "$new" | cut -c1-8)
scripts/filter-ios.sh ~/workingdir/bb-studio "$new" "$work"
gitleaks git --redact --no-banner "$work"                 # no findings beyond the known test fixtures
git fetch --no-tags "$work" import:ios-import
git merge-base --is-ancestor ddd7f8433ce5478df5b92620f503191bab0765e6 ios-import && echo extends
git merge --no-ff ios-import -m "ios: import bb-studio main $(echo "$new" | cut -c1-8)"
git branch -D ios-import
rm -rf "$work"
cd plugins && pnpm -s check:contracts && pnpm -s check:native-payloads
```

gitleaks flags one known false positive in two files, `ios/Tests/NativePayloadContractTests.swift` and `ios/Tests/Fixtures/native-payloads.json`: a placeholder `key=` query value on a `contracts.invalid` host. If the merge conflicts in `ios/Shared/Generated/`, take either side and run `pnpm gen:contracts` in `plugins/`; the generated files follow the plugins here, not the old repository. If `check:contracts` reports stale files, run `gen:contracts` and commit the result on its own. After a later import, use that import's filtered tip in the `--is-ancestor` line.

If `--is-ancestor` fails, the old branch was rewritten. Do not merge. Bring in the new commits as patches from the last imported source commit:

```sh
old=9aab9dd9f342ddc444edf77ff5ba230c08660c6c               # last imported source commit
git -C ~/workingdir/bb-studio format-patch --stdout --relative=apps/ios "$old..$new" -- apps/ios > /tmp/bbs-ios.mbox
git am --directory=ios --empty=drop /tmp/bbs-ios.mbox
```

Commits that only exist on side branches (`bb/ios-*` thread branches) are not imported. Merge them in the old repository first, or cherry-pick them here with `git format-patch --relative=apps/ios` and `git am --directory=ios`.
