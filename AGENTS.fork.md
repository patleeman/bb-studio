# Fork rules (BB Studio)

This repository is a private fork of bb (`get-bb/bb`) that ships as BB Studio. These rules come first; where they differ from `AGENTS.md`, follow these.

The fork is kept in sync with upstream by an agent, every day. Everything below exists to keep that sync small and easy to resolve.

## The rules

1. **Core keeps only thin, generic extension points.** A core edit (a change to a file that exists upstream) may add a hook, a slot, a registry call or a one-line switch. It may not hold feature logic.
2. **Features live in plugins.** Put behavior in the Studio plugin, or in a fork-owned file or plugin. Before any core edit, ask: can this be (a) a small generic hook, slot or registry in core with the behavior in a plugin, or (b) entirely plugin-side? Do that instead.
3. **Fork-owned code goes in fork-owned files.** New files never conflict. Name them so they are easy to spot: `*.fork.ts`, `fork-*.ts`, `Fork*.tsx`, `plugins/fork-*`. Fork additions to the SDK go in `packages/plugin-sdk/src/app-contract.fork.ts`, `internal/fork-slots.ts` and `testing/app.fork.tsx`; fork slots also in `apps/app/src/lib/fork-slots.ts`; Plugin Guide symbols in `plugins/plugin-api-docs/src/surfaces.fork.ts`; authoring docs in `references/fork-api.md` and `references/fork-api-host.md` (each under the 500-line skill limit); API audit notes in `docs/api_to_audit.fork.md`.
4. **Every core edit is in the ledger.** `scripts/fork/core-edits.json` lists each edited upstream file with its seam, its intent (what the edit must keep doing, in one or two sentences) and a line budget. `STUDIO_FORK.md` describes each seam. `node scripts/fork/check-core-diff.mjs` fails when a file is not listed or is over budget. Run it before you commit.
5. **No formatter churn on upstream lines.** Run `oxfmt` only on fork-owned files. Never run it on an upstream file the fork edits, and never re-indent or re-wrap lines you did not mean to change.
6. **Generated changes are scripted.** Removing plugins, the app identity and the rebrand are produced by `scripts/fork/strip-plugins.mjs`, `identity.mjs` and `rebrand.mjs`. Their output is committed at the tip with a `Fork-Generated:` trailer. Never edit that output by hand and never rebase those commits: drop them and run the scripts again. A build or test run can rewrite the tracked file `apps/web/src/routeTree.gen.ts`; restore it (`git checkout -- apps/web/src/routeTree.gen.ts`) before committing, and never stage with `git add -A` without reading `git status` first.
7. **Tests the fork breaks on purpose are skipped by list.** Add them to `scripts/fork/skipped-tests.json`. Do not edit the test source.
8. **Push only to `origin`, the BB Studio repository (`scripts/git-hooks/pre-push` on `main` names it). Nothing goes upstream.** The pushed refs are `main`, `desktop` (with `--force-with-lease`) and `v*` tags. Never push to `get-bb/bb` or `patleeman/bb`; no pull requests or issues upstream; nothing is prepared for upstream.
9. **`desktop/` on `main` is generated.** `scripts/import-desktop.mjs` on `main` writes it from the tree of the `desktop` branch; never edit it there. Work on the fork in the worktree that has `desktop` checked out (`~/workingdir/bb-studio-app-desktop`), then import.

## UI text

UI text names things and states facts: titles, counts, status, dates, actions, errors. No explanatory taglines, asides, or "shared by / lives in / so you can" quips. If a concept needs explaining, it belongs in docs, not on screen.

## Screenshots and evidence

Never commit screenshots, captures or review evidence; they go in `~/workingdir/.bb-studio-plan/`. Only intentional product images are committed, under an `assets/`, `public/`, `brand/`, `icons/`, `textures/` or `fonts/` folder or an `.xcassets` catalog. The pre-commit hook in bb-studio-app's `scripts/git-hooks` refuses any other new image.

## Building the Studio plugin bundles

Build plugin bundles only with `node scripts/fork/build-plugins.mjs [plugin dir ...]`. It rebuilds this checkout's CLI first and then builds each plugin with it, in a clean environment. A bundle built with an older CLI silently loses every SDK hook added since (the launcher once listed no apps for this reason). With no arguments it builds the plugins named in `~/.bb-studio-import.json`, or, without that file, every package in the monorepo's `plugins/packages`.

## Installing a build

Iterate without signing; notarize only when asked, or once at the end of a day's batch.

- A change that touches only the Studio plugins (CSS, themes, plugin UI) ships as a plugin bundle: build it with `node scripts/fork/build-plugins.mjs`, then quit and reopen BB Studio. No app rebuild, no signing.
- A fork or core change needs a local app build (`pnpm build`, then `pnpm run package` in `apps/desktop`). Install it as built, with the Developer ID signature when `CSC_NAME` is set or ad-hoc (`codesign -s - --force --deep`) otherwise. A locally built app is not quarantined, so Gatekeeper does not block it. Do not wait on Apple before installing or taking screenshots.
- Notarize and staple (`xcrun notarytool submit … --keychain-profile bbstudio-notary --wait`, then `xcrun stapler staple`) only on request or for the day's last build. If the keychain profile cannot be read, the Mac is probably locked: retry later, do not ask for it to be recreated.
- If an unsigned or ad-hoc build loses keychain or permission access (microphone, accessibility, notifications), say which one.

## Stack order

Tooling and notes, then seams, then features, then the generated commits at the tip. New work goes below the generated commits, as a new commit or folded into the commit for its area.

## Syncing

`node scripts/fork/sync.mjs --fetch` replays the fork onto `upstream/main` in a throwaway worktree, regenerates, runs the checks and moves the local branch `desktop-candidate`. It never touches `desktop`. `scripts/fork/sync-agent.md` is the brief for the agent that runs it. `STUDIO_FORK.md` has the details. After a clean sync: `git reset --hard desktop-candidate` on `desktop` (clean tree), `node scripts/import-desktop.mjs` on `main`, then `git push origin main && git push --force-with-lease origin desktop`.

## Resolving a conflict

Trial replays and syncs run with git rerere off (`git -c rerere.enabled=false`); never let a recorded resolution replay unseen. Put a fork import at the very top of an upstream file, above upstream's first import, so it touches one upstream line, not two.


Read the file's entry in `scripts/fork/core-edits.json` first. The intent says what the fork needs from that file. Take upstream's version of the surrounding code, then put the fork's hook back so the intent still holds. If the hook no longer fits, move more of the behavior into the fork-owned file rather than growing the core edit. Run `check-core-diff.mjs` and the tests for that area before continuing.
