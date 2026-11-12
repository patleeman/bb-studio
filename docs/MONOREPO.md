# The monorepo

## Shape

- **`desktop` branch.** The fork stack, as before the move: bb-root-relative paths, a descendant of `upstream/main`, rewritten by each sync. Stack order is tooling and notes, seams, features, then the three `Fork-Generated:` commits at the tip. The ledger (`scripts/fork/core-edits.json`), `check-core-diff.mjs` and the reproduction check work there unchanged.
- **`main`.** The monorepo. `main:desktop/` is a tree snapshot of the `desktop` branch, brought in by a merge commit (`merge -s ours` plus `read-tree --prefix=desktop/`). The merge's second parent is that day's stack tip, so every past stack stays reachable from `main`.
- **`plugins/`.** The old plugin repository's root, moved under `plugins/` with `git filter-repo` and merged once with unrelated histories. It keeps its own pnpm workspace and lockfile. `git log --follow` reaches the old commits.
- **Invariant:** `git rev-parse main:desktop` equals `git rev-parse 'desktop^{tree}'`. `node scripts/import-desktop.mjs --check` tests it.

## Why this shape

| Option for `desktop/` | Result |
|---|---|
| `git subtree add` / `subtree merge` of the fork | The stack is rebased every sync. A 3-way subtree merge of a rebased stack raises again every conflict the sync already resolved. |
| `filter-repo --to-subdirectory-filter desktop` on the fork | Rewrites every bb commit. Hashes no longer match `get-bb/bb`, so `merge-base desktop upstream/main` is empty and `sync.mjs` and `check-core-diff.mjs` break. |
| Fork as root history plus one rename commit into `desktop/` | Every cherry-pick onto upstream crosses a rename of the whole tree. |

Plugins stay out of desktop's pnpm workspace because desktop's `pnpm-workspace.yaml` and lockfile are upstream files: joining would be a core edit that conflicts on most syncs.

## Worktrees and remotes

| Path | Branch |
|---|---|
| `~/workingdir/bb-studio-app` | `main` |
| `~/workingdir/bb-studio-app-desktop` | `desktop` |
| `~/workingdir/.bb-studio-fork-sync/<stamp>` | throwaway sync worktrees and reports (override with `BB_STUDIO_SYNC_DIR`) |

- `origin` is `patleeman/bb-studio` (public). `archive` is `patleeman/bb-studio-app`, the private history before the move, read-only. `upstream` is `get-bb/bb`, fetch only: its push URL is `DISABLED`, only `main` is fetched, and tags are not fetched, so `v*` tags are BB Studio's own.
- `core.hooksPath` points at `scripts/git-hooks`. `pre-commit` refuses a newly added image or video file outside an `assets/`, `public/`, `brand/`, `icons/`, `textures/` or `fonts/` folder or an `.xcassets` catalog; on `main` it skips `desktop/`, which is an import. `pre-push` refuses any remote but `patleeman/bb-studio` and any ref but `main`, `desktop` and `v*` tags. When `main` is pushed, it also runs `pnpm check:contracts` in `plugins/` on the working tree (under a second), which fails when `ios/Shared/Generated` or `plugins/contracts` is stale or `ios/` is missing.
- GitHub Actions runs `main`'s workflows ("CI and the stable branch"). The `desktop` branch has upstream's workflows at its root: scheduled ones run only from the default branch, and of the push-triggered ones only `version-lockstep.yml` matches a push to `desktop`.

## Daily flows

**Plugin change.** Edit under `plugins/packages/*` on `main`. `cd plugins && pnpm typecheck && pnpm test`. Build bundles with `node scripts/fork/build-plugins.mjs` in the desktop worktree (with no arguments and no `~/.bb-studio-import.json` it builds every package under `bb-studio-app/plugins/packages`). Quit and reopen BB Studio.

**Desktop change.** In the desktop worktree, commit below the three generated commits (see `AGENTS.fork.md` there), run `node scripts/fork/check-core-diff.mjs`, regenerate the generated commits with `sync.mjs` (`docs/REIMPORT.md` has the commands), then on `main` run `node scripts/import-desktop.mjs`.

**Upstream sync.**

1. In the desktop worktree: `node scripts/fork/sync.mjs --fetch`. It replays the hand commits onto `upstream/main` in a throwaway worktree and moves only `desktop-candidate`. Conflicts are resolved as `scripts/fork/sync-agent.md` says.
2. Promote: `git -C ~/workingdir/bb-studio-app-desktop reset --hard desktop-candidate` (clean tree required).
3. On `main`: `node scripts/import-desktop.mjs`.
4. `git push origin main && git push --force-with-lease origin desktop`.

**Desktop release.** BB Studio has its own version line (1.0.0 and up, in `apps/desktop/studio-release.fork.json` on `desktop`), and About and Updates show it with the bb base ("based on bb 0.49.0 @ 030b1b7"). In the desktop worktree, with `CSC_NAME` set and the `bbstudio-notary` notarytool profile in the keychain:

1. `node scripts/fork/release-desktop.mjs --bump patch` writes the next version into `desktop-candidate` and prints the promote, import and push commands. Run them.
2. `node scripts/fork/release-desktop.mjs --no-bump --notes-only` drafts the notes from the commits since the last `v*` Studio tag; edit the file it names.
3. `node scripts/fork/release-desktop.mjs --no-bump --notes <file>` builds, signs, notarizes and staples, makes the DMG, the zip, their blockmaps, `latest-mac.yml` and `desktop-version.json`, tags `v<version>` on `origin/main`, pushes the tag to the remote for `--repo` (default `patleeman/bb-studio`) and creates a DRAFT release there with all of them. `--dry-run` prints the plan; `--from sign|publish` resumes. The 1.0.0 draft is on this repository (`--repo patleeman/bb-studio-app`).

Installed copies update from the GitHub releases of the public repository `patleeman/bb-studio` (electron-updater's GitHub provider, no token), which is to hold this monorepo. They see a release only when one with the update files is published there by hand; until then their checks fail quietly (logged; Settings, Updates says it couldn't check). `STUDIO_FORK.md` on `desktop` has the details and the local end-to-end test (`scripts/fork/updater-e2e.mjs`).

## What was left out

- No `site/`. The old plugin repository's `apps/` (the iPhone app), `docs/ios`, `docs/ui-redo`, `docs/attention-router`, `marketplace.json`, `.github`, `.bb`, `README.md` and `LICENSE` were filtered out of the plugin history.
- The marketplace is `marketplace.json` at the root. It started as a copy of the old repository's `marketplace.json`, without its history; each entry's `subdir` is `plugins/packages/<dir>` and its `ref` is `stable`. `plugins/packages/bb-studio/src/setup.test.ts` checks the bundled add-on list (`src/setup-addons.ts`) against it. Until the public flip, the old public `patleeman/bb-studio` still serves installs from its own `packages/<dir>`.
- The iPhone app was imported separately, with its `apps/ios` history only, under `ios/` (`scripts/filter-ios.sh`, `docs/REIMPORT.md`). `docs/ios` stayed behind.
- `plugins/package.json`: `check` runs `check:marketplace`, `check:contracts` and `check:native-payloads` among others. `gen:contracts`, `check:contracts` and `check:native-payloads` require `ios/`: they read and write `../ios`, and the native RPC inventory takes the repository's plugin ids from the root `marketplace.json`. `check:marketplace` reads the root `marketplace.json` and the packages under `plugins/packages`. `check:docs` (it wants `plugins/README.md`) and `check:icons` fail today and are not in CI.

## CI and the stable branch

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`: in `plugins/`, typecheck, tests, the stock-bb compatibility check (`check:compat`: every plugin's `engines` against the current stable bb release and its plugin SDK), `check:marketplace`, `check:contracts` and `check:native-payloads`; the `main:desktop` invariant; and the site build. `ios.yml` runs the iPhone app's unit and transcript tests on a macOS runner when `ios/` changes. `pages.yml` builds `site/` (`node site/scripts/build.mjs`) and deploys `site/dist` to GitHub Pages when `site/` changes; the Pages source is "GitHub Actions". Neither needs a secret; `promote-stable` uses the workflow's own token. Actions are off on the private repository, so these run only in the public one.

`stable` is a **branch**, never a tag; no `stable` tag may exist. Only `promote-stable` moves it, after every check passed on a push to `main`. Each `stable` commit has the previous `stable` and the `main` commit as parents (no force-push), and its tree is that `main` tree plus `packages/bb-studio`, `packages/bb-studio-mobile` and `packages/bb-studio-visual-chat`: real copies of `plugins/packages/<dir>`, not symlinks. bb keeps a plugin's stored `subdir` on update and never re-reads `marketplace.json`, so installs made from the old public repository (subdir `packages/<dir>`) keep updating from those copies; without them they stop updating with "ENOENT realpath …/packages/bb-studio" (they keep running). bb shares one commit cache between plugins of the same commit and replaces symlinks there, which is why they are copies. `main` never carries `packages/`; the root `marketplace.json` points only at `plugins/packages/*`.

## Public history

`scripts/publish/make-public-history.mjs` builds the public repository locally from this one, at any time, from the then-latest `main` and `desktop`. Nothing is pushed.

```sh
git fetch upstream main && git fetch origin
node scripts/publish/make-public-history.mjs --out ~/workingdir/bb-studio-public --force
```

- **`main`**: one root commit with the tree of `main` minus `desktop/`, then the import merge that `scripts/import-desktop.mjs` would make, with the rewritten `desktop` tip as its second parent. So `import-desktop.mjs --check` holds, and later imports work unchanged.
- **`desktop`**: `git filter-repo --refs desktop ^upstream/main` rewrites only Studio's commits above the upstream base. Upstream's signed commits keep their hashes, so `sync.mjs` and `check-core-diff.mjs` work as before. The rewrite drops `Fork-Source:` trailers (they name commits of the private history), maps the old work address to the personal one, and applies the replace list to blobs and messages.
- **`stable`**: the `main` tip plus the `packages/` copies (see above).
- **Strip and replace lists, the author mapping and the checks** are in the script, and the script itself is left out of the public tree (it names what it removes). It fails when a blocker pattern (tailnet host, home paths, the old demo names, the work address, key shapes) is left in any Studio blob or commit message. A few edits apply to the public tree only (the README's clone URL, the push target in `AGENTS.md`, `docs/MONOREPO.md` and the `pre-push` hook); the script fails when one no longer matches.
- **Tags**: `--tag v1.0.0` copies a `v*` tag onto the new `main` tip when the tag is on `main`.
- Then run the checks in `~/workingdir/.bb-studio-plan/public-audit-final.md`: the sync dry run (`sync.mjs --onto <base> --checks none` must say "tree is identical"), `import-desktop.mjs --check`, the plugin tests, the site build, gitleaks over all refs and the OCR pass over images.

## Sources of the first import (12 Nov 2026)

`docs/REIMPORT.md` records the exact source commits and the commands to import newer ones.
