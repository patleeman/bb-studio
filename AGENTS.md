# BB Studio monorepo

This repository holds BB Studio. Read [docs/MONOREPO.md](docs/MONOREPO.md) for the layout and the flows.

- `desktop/` is the desktop app: a fork of bb (`get-bb/bb`). On `main` it is a generated snapshot of the `desktop` branch.
- `plugins/` is the Studio plugins. It is its own pnpm workspace with its own lockfile and its own `plugins/AGENTS.md`.
- `scripts/` and `docs/` at the root are the monorepo's own tooling and notes.

## Rules

1. **Never edit `desktop/` on `main`.** `scripts/import-desktop.mjs` generates it from the `desktop` branch, and the next import overwrites any edit. Change the desktop app in the desktop worktree (`~/workingdir/bb-studio-app-desktop`, branch `desktop`), following `AGENTS.md` and `AGENTS.fork.md` there: commit below the generated commits, regenerate, then run `node scripts/import-desktop.mjs` here.
2. **The invariant:** `git rev-parse main:desktop` equals `git rev-parse 'desktop^{tree}'`. `node scripts/import-desktop.mjs --check` tests it.
3. **Push only to `origin` (`patleeman/bb-studio`):** `main`, `desktop` (with `--force-with-lease`), and `v*` tags. `stable` is pushed by hand once, when the repository is created; after that only CI moves it. Never push to `get-bb/bb`, `patleeman/bb` or the private archive `patleeman/bb-studio-app`. Open no pull requests or issues upstream. Prepare nothing for upstream. `scripts/git-hooks/pre-push` enforces the targets; do not bypass it with `--no-verify`.
4. **`main` is never rewritten.** No force-push, no rebase of pushed commits. `desktop` is rewritten by each upstream sync; every past stack stays reachable as the second parent of an import commit on `main`.
5. **Keep personal data out of the tree.** No absolute home paths, hostnames or tailnet names, real thread or page ids, or real people's names in code, fixtures, docs or commit messages. The public history is built from this repository by `scripts/publish/make-public-history.mjs` (docs/MONOREPO.md, "Public history").
6. **No root pnpm workspace.** `desktop/` and `plugins/` each keep their own workspace and lockfile. Do not add a root `package.json` or `pnpm-workspace.yaml`.
7. **Never commit** secrets, `auth.json`, `.env` files, keys, databases, anything from `~/.bb-studio`, sync reports (`.bb-studio-fork-sync/`), `MERGE_REVIEW.md`, `REBASE_REVIEW.md`, or screenshots of real windows. Read `git status` before staging; do not use `git add -A` blind.
8. **Screenshots, captures and review evidence stay out of git.** Put them in `~/workingdir/.bb-studio-plan/`. Commit only intentional product images, under an `assets/`, `public/`, `brand/`, `icons/`, `textures/` or `fonts/` folder or an `.xcassets` catalog. The `pre-commit` hook in `scripts/git-hooks` refuses any other new image or video file.
9. **Commit messages** end with the `Co-Authored-By` line the session gives. The three generated commits on `desktop` keep the exact subject, body and trailers that `sync.mjs` writes.

## Where to work

| Change | Where | Then |
|---|---|---|
| Studio plugin code | `plugins/packages/<name>` on `main` | `cd plugins && pnpm typecheck && pnpm test`; build bundles with `node scripts/fork/build-plugins.mjs` in the desktop worktree |
| Desktop app (fork) code | the desktop worktree, branch `desktop` | `check-core-diff.mjs`, regenerate, `node scripts/import-desktop.mjs` on `main` |
| Upstream sync | the desktop worktree, `node scripts/fork/sync.mjs --fetch` | promote `desktop-candidate`, import, push (see docs/MONOREPO.md) |
| Monorepo tooling, license, notices | root of `main` | commit on `main` |

`LICENSE` and `NOTICE` at the root carry the MIT terms and the credits for bb and for third-party work. Keep `NOTICE` in step with `plugins/packages/bb-studio/docs/theme-credits.md` when a theme adds an outside source. `desktop/LICENSE` is upstream's file and stays byte-identical.
