# BB Studio

BB Studio is a desktop app built on [bb](https://github.com/get-bb/bb), with the Studio plugins. Its history before the move to this repository is kept in a private archive.

## Layout

| Path | What | History |
|---|---|---|
| `desktop/` | The desktop app: a fork of bb with a thin set of seams, a rebrand and an app identity | A tree snapshot of the `desktop` branch, one merge commit per import |
| `plugins/` | The Studio plugins (`packages/bb-studio`, `bb-studio-visual-chat`, `bb-studio-mobile`, `bb-studio-agents`), contracts, scripts and docs | Starts at this repository's first commit |
| `ios/` | The BB Studio iOS app (XcodeGen `project.yml`; `Shared/Generated` comes from `plugins/`' `gen:contracts`) | Starts at this repository's first commit |
| `scripts/` | `import-desktop.mjs`, `filter-plugins.sh`, `filter-ios.sh`, `git-hooks/pre-push` | |
| `docs/` | `MONOREPO.md`, `REIMPORT.md` | |

## Branches

- `main`: the monorepo. Never rewritten.
- `desktop`: the fork stack with bb-root-relative paths. It descends from `get-bb/bb` `main` and is rewritten by each upstream sync. `main:desktop` always equals `desktop^{tree}`.

## Worktrees

```sh
git clone git@github.com:patleeman/bb-studio.git bb-studio-app
cd bb-studio-app
git config core.hooksPath "$PWD/scripts/git-hooks"
git remote add upstream git@github.com:get-bb/bb.git
git remote set-url --push upstream DISABLED
git config remote.upstream.fetch '+refs/heads/main:refs/remotes/upstream/main'
git config remote.upstream.tagOpt --no-tags
git worktree add ../bb-studio-app-desktop desktop
```

- `bb-studio-app` (branch `main`): plugins, tooling, docs.
- `bb-studio-app-desktop` (branch `desktop`): the desktop app. Build, sync and core edits happen here.

## Scripts

- `node scripts/import-desktop.mjs` (on `main`): bring the `desktop` branch's tree in as `desktop/`. `--check` only tests the invariant.
- `node scripts/fork/sync.mjs --fetch` (in the desktop worktree): replay the fork onto `upstream/main`; moves only `desktop-candidate`.
- `node scripts/fork/build-plugins.mjs` (in the desktop worktree): build the plugin bundles with this checkout's CLI.

## Build

```sh
cd ../bb-studio-app-desktop
pnpm install
node scripts/fork/build-plugins.mjs
pnpm build
(cd apps/desktop && pnpm run package)
```

```sh
cd plugins
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test
```

## License

MIT. See `LICENSE` and `NOTICE`. `desktop/` is derived from bb, Copyright (c) 2026 Michael Yong, MIT (`desktop/LICENSE`).
